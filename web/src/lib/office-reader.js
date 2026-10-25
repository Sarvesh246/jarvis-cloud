import { unzipSync } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const MAX_XML = 4_000_000, MAX_EXPANDED = 16_000_000, MAX_TEXT = 158_000;
const RELATIONSHIP_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
]);
const local = value => value.split(':').at(-1).replace(/^@_/, '');
function tree(xml) {
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw Error('This document contains unsupported or malformed XML.');
  const parser = new XMLParser({ preserveOrder:true, ignoreAttributes:false, parseTagValue:false,
    trimValues:false, processEntities:true, ignoreDeclaration:true });
  let nodes = 0;
  const convert = (entries, depth=0, namespaces={}) => {
    if (depth > 64) throw Error('The document structure is too deeply nested.');
    return entries.flatMap(entry => Object.entries(entry).filter(([key])=>key!==':@').map(([key,value])=> {
      if (++nodes > 200000) throw Error('The document has too many elements.');
      const attributes=Object.entries(entry[':@']||{});
      const declarations=attributes.filter(([key])=>key.startsWith('@_xmlns:')).map(([key,value])=>[key.slice(8),value]);
      const scope=declarations.length?{...namespaces,...Object.fromEntries(declarations)}:namespaces;
      // A slide has both a numeric id and a namespaced relationship id.
      // Keep the latter independent of attribute order and prefix spelling.
      const relationshipId=attributes.find(([key])=> {
        const match=/^@_([^:]+):id$/.exec(key);
        return match && RELATIONSHIP_NAMESPACES.has(scope[match[1]]);
      })?.[1];
      return {name:local(key), text:key==='#text'?String(value):'',
        attrs:Object.fromEntries(attributes.map(([k,v])=>[local(k),String(v)])), relationshipId,
        children:Array.isArray(value)?convert(value,depth+1,scope):[]};
    }));
  };
  return convert(parser.parse(xml));
}
const all = (nodes, name) => nodes.flatMap(node => [...(node.name===name?[node]:[]),...all(node.children,name)]);
const text = nodes => nodes.map(node=>node.text+text(node.children)).join('');
const child = (node,name) => node.children.find(item=>item.name===name);
const quote = value => JSON.stringify(String(value));

function paragraphs(nodes) {
  let output='';
  for (const node of nodes) {
    if (node.name==='tbl') {
      output += all(node.children,'tr').map(row=>all(row.children,'tc').map(cell=>paragraphs(cell.children).trim()).join('\t')).join('\n')+'\n';
    } else if (node.name==='p') {
      const inline = entries => entries.map(item=> item.name==='t'?text(item.children):
        item.name==='tab'?'\t':item.name==='br'?'\n':inline(item.children)).join('');
      output += inline(node.children)+'\n';
    } else output += paragraphs(node.children);
  }
  return output;
}

function presentationSlides(files, read) {
  const manifest='ppt/presentation.xml', rels='ppt/_rels/presentation.xml.rels';
  // Preserve support for older, minimal archives with no presentation metadata.
  if (!files[manifest] && !files[rels]) return Object.keys(files)
    .filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name))
    .map(name=>({name,number:name.match(/slide(\d+)/)[1]}))
    .sort((a,b)=>a.number-b.number);
  const presentation=read(manifest).find(node=>node.name==='presentation');
  const relationships=read(rels).find(node=>node.name==='Relationships');
  const lists=presentation?.children.filter(node=>node.name==='sldIdLst');
  if (!relationships || lists?.length!==1) throw Error('The presentation slide list is missing or invalid.');
  const byId=new Map();
  for (const relation of relationships.children.filter(node=>node.name==='Relationship')) {
    const id=relation.attrs.Id;
    if (!id || byId.has(id)) throw Error('The presentation has invalid or duplicate slide relationships.');
    byId.set(id,relation.attrs);
  }
  const seen=new Set();
  return lists[0].children.filter(node=>node.name==='sldId').map((slide,index)=> {
    const relation=byId.get(slide.relationshipId);
    if (!relation || ![...RELATIONSHIP_NAMESPACES].some(namespace=>relation.Type===`${namespace}/slide`) ||
        (relation.TargetMode && relation.TargetMode!=='Internal'))
      throw Error('A presentation slide has a missing or unsupported source.');
    let name;
    try {
      const target=relation.Target;
      if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)|[\\?#\u0000-\u0020]/i.test(target)) throw Error();
      // Resolve package paths only; this URL is never fetched.
      const url=new URL(target,'https://office.invalid/ppt/presentation.xml');
      name=decodeURIComponent(url.pathname).slice(1);
      if (!/^ppt\/slides\/[^/\\]+\.xml$/.test(name)) throw Error();
    } catch { throw Error('A presentation slide source is invalid.'); }
    if (!files[name] || seen.has(name)) throw Error('A presentation slide source is missing or repeated.');
    seen.add(name);
    return {name,number:index+1};
  });
}

export function extractOffice(bytes, extension) {
  let expanded=0, entries=0;
  const names=new Set();
  const files=unzipSync(bytes,{filter:file=> {
    if (++entries>2048 || names.has(file.name)) throw Error('The document archive has duplicate or too many entries.');
    names.add(file.name);
    if (/\\|(?:^|\/)\.\.(?:\/|$)|^\//.test(file.name)) throw Error('The document archive has invalid paths.');
    const selected = /^(?:word\/(?:document|footnotes|endnotes|header\d+|footer\d+)\.xml|xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)|ppt\/(?:presentation\.xml|_rels\/presentation\.xml\.rels|slides\/[^/]+\.xml))$/.test(file.name);
    if (selected && (file.originalSize>MAX_XML || (expanded+=file.originalSize)>MAX_EXPANDED))
      throw Error('The expanded document exceeds its reading limit.');
    return selected;
  }});
  const read = name => {
    if (!files[name]) throw Error('A required document part is missing.');
    if (files[name].length>MAX_XML) throw Error('A document part is too large.');
    return tree(new TextDecoder('utf-8',{fatal:true}).decode(files[name]));
  };
  const sections=[];
  let readable=false;
  if (extension==='docx') {
    const main=read('word/document.xml');
    if(!all(main,'document').length) throw Error('The Word document body is missing.');
    for (const name of Object.keys(files).filter(n=>n.startsWith('word/')).sort((a,b)=>Number(b==='word/document.xml')-Number(a==='word/document.xml')||a.localeCompare(b))) {
      const body=paragraphs(name==='word/document.xml'?main:read(name));
      readable ||= Boolean(body.trim());
      sections.push(`[${name}]\n${body}`);
    }
  } else if (extension==='pptx') {
    for (const {name,number} of presentationSlides(files,read)) {
      const body=all(read(name),'p').map(p=>all(p.children,'t').map(t=>text(t.children)).join('')).join('\n');
      readable ||= Boolean(body.trim());
      sections.push(`[Slide ${number}]\n${body}`);
    }
  } else if (extension==='xlsx') {
    const workbook=read('xl/workbook.xml');
    const relationships=all(read('xl/_rels/workbook.xml.rels'),'Relationship');
    const strings=files['xl/sharedStrings.xml']?all(read('xl/sharedStrings.xml'),'si').map(si=>all(si.children,'t').map(t=>text(t.children)).join('')):[];
    for (const sheet of all(workbook,'sheet')) {
      const relation=relationships.find(r=>r.attrs.Id===sheet.attrs.id);
      if (!relation || relation.attrs.TargetMode==='External') throw Error('A sheet has an unsupported external source.');
      const target=relation.attrs.Target?.replace(/^\//,'');
      const name=target?.startsWith('xl/')?target:`xl/${target}`;
      if (!/^xl\/worksheets\/[^/]+\.xml$/.test(name)) throw Error('A sheet source is invalid.');
      const rows=all(read(name),'row').map(row=>all(row.children,'c').map(cell=> {
        const cached=text(child(cell,'v')?.children||[]);
        if(cell.attrs.t==='s'&&!/^\d{1,8}$/.test(cached)) throw Error('A shared spreadsheet value is invalid.');
        let value=cell.attrs.t==='s'?strings[Number(cached)]:cell.attrs.t==='inlineStr'?all(cell.children,'t').map(t=>text(t.children)).join(''):cached;
        if (value===undefined) throw Error('A shared spreadsheet value is missing.');
        const formula=child(cell,'f');
        // Preserve the original value and formula. No formulas are executed,
        // and numeric Excel dates are not silently interpreted as plain counts.
        readable ||= Boolean(value||formula);
        return `${cell.attrs.r||'?'}=${quote(value)}${cell.attrs.t==='b'?' [boolean]':''}${cell.attrs.s?` [style ${cell.attrs.s}]`:''}${formula?` [formula ${quote('='+text(formula.children))}; ${child(cell,'v')?'cached value, not calculated here':'cached value unavailable'}]`:''}`;
      }).join('\t')).join('\n');
      sections.push(`[Sheet ${quote(sheet.attrs.name)}]\n${rows}`);
    }
    if (files['xl/styles.xml']) {
      const styles=read('xl/styles.xml');
      const formats=all(styles,'numFmt').map(item=>`${item.attrs.numFmtId}: ${quote(item.attrs.formatCode)}`).join('\n');
      const indexed=all(styles,'cellXfs').flatMap(item=>item.children.filter(c=>c.name==='xf')).map((item,i)=>`${i}: number format ${item.attrs.numFmtId||'0'}`).join('\n');
      sections.push(`[Spreadsheet number formats; preserve serial values unless a date format is established]\n${formats}\nCell styles:\n${indexed}\nDate system: ${all(workbook,'workbookPr')[0]?.attrs.date1904==='1'?'1904':'1900 (includes Excel leap-day compatibility)'}`);
    }
  } else throw Error('This document format is unsupported.');
  const body='[Office text extraction only. Embedded images, charts, macros and external data are not included or executed.]\n'+sections.join('\n\n').trim();
  if (!readable || !sections.length) throw Error('No readable document text was found.');
  if (body.length>MAX_TEXT) throw Error('Too much extracted text for one message. Split the document into smaller files.');
  return {body, note:'Text extracted locally. Embedded images, charts, macros and external links were not executed or interpreted.'};
}
