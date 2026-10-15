import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { X, Plus, Trash, DownloadSimple, UploadSimple, ArrowClockwise, ArrowLeft, ArrowRight, Play, ChatCircle, ListChecks, FolderOpen } from '@phosphor-icons/react';
import { CAPABILITIES } from '../../shared/capabilities.js';
import { schemaValue, inferredSchema, fieldTitle, validateInput, readWorkCache, writeWorkCache, requestWork, importWork, draftMatches, prepareInput, valueForType } from '../lib/workroom.js';
import './workroom.css';
import { TOOL_GROUPS, resultOverview } from '../lib/workroom-view.js';

const TYPES = ['string', 'number', 'boolean', 'object', 'array'];
const SCOPES = ['personal', 'work', 'client'];
const TYPE_NAMES = {string:'Text',number:'Number',boolean:'Yes or no',object:'Group of details',array:'List'};

function ValueType({ value, onChange, label }) {
  return <label className="work-type">{label}<select value={inferredSchema(value).type} onChange={e => onChange(valueForType(e.target.value))}>
    {TYPES.map(type => <option key={type} value={type}>{TYPE_NAMES[type]}</option>)}
  </select></label>;
}

function FreeFields({ value, onChange, depth }) {
  const [keyName, setKeyName] = useState('');
  const [problem, setProblem] = useState('');
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  function add() {
    const key = keyName.trim();
    if (!key || ['__proto__','constructor','prototype'].includes(key) || Object.hasOwn(object, key)) { setProblem('Use a new field name.'); return; }
    onChange({ ...object, [key]: '' }); setKeyName(''); setProblem('');
  }
  return <>
    {Object.entries(object).map(([key, item]) => <div className="work-record-row" key={key}>
      <div className="work-row-tools"><span>{key}</span><ValueType value={item} label={`Type for ${key}`} onChange={next => onChange({ ...object, [key]: next })} />
        <button type="button" className="icon-button" aria-label={`Remove field ${key}`} onClick={() => { const next = { ...object }; delete next[key]; onChange(next); }}><Trash size={18} weight="light" /></button></div>
      <SchemaField schema={{ ...inferredSchema(item), title: fieldTitle(key) }} value={item} onChange={next => onChange({ ...object, [key]: next })} depth={depth + 1} />
    </div>)}
    <div className="work-add-field"><label>New field name<input value={keyName} onChange={e => setKeyName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} /></label>
      <button type="button" onClick={add}><Plus size={17} weight="light" />Add field</button></div>
    {problem && <p className="work-problem" role="alert">{problem}</p>}
  </>;
}

function SchemaField({ schema = {}, value, onChange, required = false, depth = 0 }) {
  const id = useId();
  const rowKeys = useRef([]), nextKey = useRef(0);
  const title = schema.title || 'Value';
  const fields = Object.entries(schema.properties || {});
  const requiredFields = fields.filter(([key]) => schema.required?.includes(key));
  const optionalFields = fields.filter(([key]) => !schema.required?.includes(key));
  const renderFields = entries => entries.map(([key,child]) => <SchemaField key={key} schema={{...child,title:child.title || fieldTitle(key)}}
    required={schema.required?.includes(key)} value={value?.[key] ?? schemaValue(child)} onChange={next=>onChange({...value,[key]:next})} depth={depth+1} />);
  if (depth > 12) return <p className="work-problem">This record is too deeply nested to edit here. Remove the parent item and simplify it.</p>;
  if (schema.type === 'object') return <fieldset className="work-fields"><legend>{title}{required ? ' · required' : ''}</legend>
    {schema.description && <p className="work-help">{schema.description}</p>}
    {schema.properties ? <>{renderFields(requiredFields)}{optionalFields.length>0 && <details className="work-extra-fields"><summary>Extra details <span>Optional</span></summary>{renderFields(optionalFields)}</details>}</>
      : <FreeFields value={value} onChange={onChange} depth={depth} />}
  </fieldset>;
  if (schema.type === 'array') {
    const items = Array.isArray(value) ? value : [];
    rowKeys.current.length = Math.min(rowKeys.current.length, items.length);
    while(rowKeys.current.length < items.length) rowKeys.current.push(`${id}-row-${nextKey.current++}`);
    return <fieldset className="work-fields"><legend>{title}{required ? ' · required' : ''}</legend>
      {schema.description && <p className="work-help">{schema.description}</p>}
      {!items.length && <p className="work-help">Add the information you want to check.</p>}
      {items.map((item, index) => <div className="work-record-row" key={rowKeys.current[index]}>
        <div className="work-row-tools"><span>{title} {index + 1}</span>
          {!schema.items?.type && <ValueType value={item} label={`Type for item ${index + 1}`} onChange={next => onChange(items.map((v, i) => i === index ? next : v))} />}
          <button type="button" className="icon-button" aria-label={`Remove ${title} item ${index + 1}`} onClick={() => {rowKeys.current.splice(index,1);onChange(items.filter((_, i) => i !== index));}}><Trash size={18} weight="light" /></button></div>
        <SchemaField schema={{ ...(schema.items?.type ? schema.items : inferredSchema(item)), title: schema.items?.title || `Item ${index + 1}` }} value={item} onChange={next => onChange(items.map((v, i) => i === index ? next : v))} depth={depth + 1} />
      </div>)}
      <button type="button" className="work-text-button" onClick={() => onChange([...items, schemaValue(schema.items || { type: 'string' })])}><Plus size={17} weight="light" />Add {schema.items?.title?.toLowerCase() || 'item'}</button>
    </fieldset>;
  }
  const common = { id, 'aria-required': required || undefined, 'aria-describedby': schema.description ? `${id}-help` : undefined };
  return <div className="work-field"><label htmlFor={id}>{title}{required && <span className="work-required">Required</span>}</label>
    {schema.enum ? <select {...common} value={value ?? ''} onChange={e => onChange(schema.enum.find(option => String(option) === e.target.value) ?? '')}><option value="">Choose…</option>{schema.enum.map(option => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select>
      : schema.type === 'boolean' ? <select {...common} value={value === true ? 'true' : value === false ? 'false' : ''} onChange={e => onChange(e.target.value === '' ? '' : e.target.value === 'true')}><option value="">Choose yes or no…</option><option value="true">Yes</option><option value="false">No</option></select>
        : ['number','integer'].includes(schema.type) ? <input {...common} type="number" step={schema.type === 'integer' ? '1' : 'any'} min={schema.minimum} max={schema.maximum} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
          : <textarea {...common} rows={2} value={value ?? ''} onChange={e => onChange(e.target.value)} />}
    {schema.description && <p id={`${id}-help`} className="work-help">{schema.description}</p>}
  </div>;
}

function Readable({ value, depth = 0 }) {
  if (value === null || value === undefined) return <span className="work-help">Not provided</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if (typeof value !== 'object') return <span className="work-value">{String(value) || 'Empty'}</span>;
  if (depth >= 9) return <p className="work-help">Further details are available in the export.</p>;
  if (Array.isArray(value)) return value.length ? <ol className="work-results-list">{value.slice(0, 80).map((item,i) => <li key={i}><Readable value={item} depth={depth + 1} /></li>)}{value.length > 80 && <li>Remaining items are available in the export.</li>}</ol> : <span className="work-help">No items</span>;
  return <dl className="work-result-fields">{Object.entries(value).slice(0,80).map(([key,item]) => <div key={key}><dt>{fieldTitle(key)}</dt><dd><Readable value={item} depth={depth + 1} /></dd></div>)}</dl>;
}

function download(records, title = 'vaelo-work') {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'vaelo-work/v1', records }, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${title.replace(/[^a-z0-9_-]/gi,'-').slice(0,70)}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Workroom({ open, onClose, session, onDiscuss, initialProposal = null, onRecordChange }) {
  const dialog = useRef(null), file = useRef(null), account = useRef(null), fetchSequence = useRef(0);
  const scrollArea = useRef(null), taskHeading = useRef(null), resultHeading = useRef(null);
  const sub = session?.user?.sub || null; account.current = sub;
  const [records, setRecords] = useState([]), [draft, setDraft] = useState(null), [base, setBase] = useState(null);
  const [query, setQuery] = useState(''), [view, setView] = useState('tools'), [busy, setBusy] = useState(''), [problem, setProblem] = useState('');
  const [status, setStatus] = useState(''), [cached, setCached] = useState(false), [conflict, setConflict] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine), [imports, setImports] = useState([]), [pending, setPending] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [missing, setMissing] = useState([]);
  const [group, setGroup] = useState('all');
  const [panel, setPanel] = useState('details');
  const capability = CAPABILITIES.find(c => c.id === draft?.capabilityId);
  const saved = records.find(record => record.id === draft?.id);
  const dirty = Boolean(draft && !draftMatches(saved, draft));
  const offline = !online || session?.offline;
  const mutationBusy = Boolean(busy);
  const grouped = useMemo(() => {
    const groups = new Map();
    for (const item of CAPABILITIES.filter(c => (group==='all'||c.group===group) && `${c.id} ${c.title} ${c.description} ${TOOL_GROUPS[c.group]}`.toLowerCase().includes(query.toLowerCase()))) groups.set(item.group, [...(groups.get(item.group) || []), item]);
    return [...groups];
  }, [query, group]);
  const overview = saved?.output ? resultOverview(saved.output) : null;

  useEffect(() => {
    if (!open) return;
    scrollArea.current?.scrollTo({top:0});
    (panel==='result' ? resultHeading.current : taskHeading.current)?.focus({preventScroll:true});
  }, [open, draft?.id, panel]);

  useEffect(() => { const yes=()=>setOnline(true), no=()=>setOnline(false); window.addEventListener('online',yes); window.addEventListener('offline',no); return ()=>{window.removeEventListener('online',yes);window.removeEventListener('offline',no);}; }, []);
  useEffect(() => {
    setRecords(readWorkCache(sub)); setDraft(null); setBase(null); setProblem(''); setStatus(''); setCached(true); setConflict(false); setImports([]); setPending(null); setBusy('');setQuery('');setGroup('all');setPanel('details');
  }, [sub]);
  useEffect(() => { const el=dialog.current; if(open && !el.open) el.showModal(); else if(!open && el.open) el.close(); }, [open]);

  async function refresh() {
    if (!sub || offline) return;
    const owner=sub, sequence=++fetchSequence.current;
    setBusy('loading'); if(!conflict) setProblem('');
    try {
      const data=await requestWork(null, {csrf:session?.csrf});
      if (account.current !== owner || sequence !== fetchSequence.current) return;
      setRecords(data.records || []); writeWorkCache(owner,data.records || []); setCached(false);
    } catch(error) { if(account.current===owner) setProblem(error.status === 401 ? 'Sign in again to load your saved work.' : 'Could not refresh. Cached records remain available; your draft is kept.'); }
    finally { if(account.current===owner && sequence===fetchSequence.current) setBusy(''); }
  }
  useEffect(() => { if(open && sub && !offline) refresh(); /* Refresh never replaces an open draft. */ }, [open, sub, offline]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if(!open || !initialProposal || !sub) return;
    const type=CAPABILITIES.find(c=>c.id===Number(initialProposal.capabilityId));
    if(!type) {setProblem('This proposal uses an unsupported tool.');return;}
    const loadProposal=()=>{
      setDraft({id:crypto.randomUUID(),capabilityId:type.id,title:initialProposal.title || type.title,input:initialProposal.input || schemaValue(type.inputSchema),scope:SCOPES.includes(initialProposal.scope)?initialProposal.scope:'personal'});
      setBase(null);setPanel('details');setConflict(false);setView('saved');setStatus('Vaelo prepared these details. Review them before checking.');
    };
    if(dirty)setPending(()=>loadProposal);else loadProposal();
  }, [open, initialProposal, sub]);

  function edit(next) { setDraft(next); setStatus(''); setProblem(''); }
  function navigate(action) { if(mutationBusy) return; if(dirty) setPending(()=>action); else action(); }
  function choose(record) { setDraft(structuredClone(record)); setBase(record.revision); setPanel(record.output?'result':'details'); setConflict(false); setProblem(''); setStatus(''); setConfirmDelete(false); setMissing([]); }
  function create(type) { setDraft({id:crypto.randomUUID(),capabilityId:type.id,title:type.title,input:schemaValue(type.inputSchema),scope:'personal'});setBase(null);setPanel('details');setConflict(false);setProblem('');setStatus('');setMissing([]); }
  function remember(record) {
    const next=record.deleted ? records.filter(r=>r.id!==record.id) : [record,...records.filter(r=>r.id!==record.id)];
    setRecords(next);writeWorkCache(sub,next);onRecordChange?.(record);return next;
  }
  async function mutate(action, separate = false) {
    if(!draft || !sub || offline || mutationBusy) return;
    if(['save','check','discuss'].includes(action)&&!draft.title.trim()) {setProblem('Give this task a name before saving.');return;}
    if(action==='check') {
      const errors=validateInput(capability.inputSchema,prepareInput(capability.inputSchema,draft.input)); if(errors.length) {setPanel('details');setProblem('');setMissing(errors);return;}
    }
    if(action==='run') {
      if(dirty || !saved || !base) {setProblem('Save your current changes before running.');return;}
      const errors=validateInput(capability.inputSchema,prepareInput(capability.inputSchema,draft.input)); if(errors.length) {setPanel('details');setProblem('');setMissing(errors);return;}
    }
    const owner=sub;
    setBusy(action);setProblem('');setMissing([]);setStatus('');
    const id=separate?crypto.randomUUID():draft.id;
    try {
      const saveFirst=['save','check','discuss'].includes(action);
      const needsSave=saveFirst && (dirty || !base || separate || action==='save');
      let record=saved;
      if(needsSave) {
        const data=await requestWork({action:'save',record:{id,capabilityId:draft.capabilityId,title:draft.title.trim(),input:prepareInput(capability.inputSchema,draft.input),scope:draft.scope},base:separate?null:base},{csrf:session?.csrf});
        if(account.current!==owner)return;
        record=data.record;remember(record);choose(record);
      }
      if(action==='check'||action==='run') {
        const data=await requestWork({action:'run',id:record.id,base:record.revision},{csrf:session?.csrf});
        record=data.record;
      } else if(action==='delete') record=(await requestWork({action,id,base},{csrf:session?.csrf})).record;
      if(account.current!==owner) return;
      remember(record);setCached(false);setConflict(false);
      if(action==='delete') {setDraft(null);setBase(null);setConfirmDelete(false);setStatus('Saved record deleted.');return;}
      choose(record);
      if(action==='discuss'){onDiscuss?.(record);return;}
      if(action==='check'||action==='run')setPanel('result');
      setStatus(action==='run'||action==='check'?'Your check is finished.':separate?'Saved as a separate task.':'Draft saved. You can come back to it later.');
    } catch(error) {
      if(account.current!==owner) return;
      if(error.status===409) {setConflict(true);setProblem('This saved record changed on another device. Your edits are kept. Refresh the list to review the latest version, then reload it or save your edits as a separate record.');}
      else setProblem(error.status===401?'Sign in again before saving or running. Your edits are kept.':error.message || 'Could not save. Your edits are kept.');
    } finally {if(account.current===owner)setBusy('');}
  }
  async function importFile(event) {
    const selected=event.target.files?.[0];event.target.value='';if(!selected)return;
    try { if(selected.size>2_000_000)throw new Error('Choose a file smaller than 2 MB.'); const items=importWork(await selected.text(),CAPABILITIES);setImports(items);setStatus(`${items.length} imported ${items.length===1?'record is':'records are'} ready to preview. Nothing has been saved.`); }
    catch(error){setProblem(error instanceof SyntaxError?'This file is not a readable work export.':error.message);}
  }

  function leaveTask() {
    navigate(()=>{setDraft(null);setBase(null);setProblem('');setConfirmDelete(false);setQuery('');});
  }
  const matchingRecords=records.filter(r=>`${r.title} ${r.scope}`.toLowerCase().includes(query.toLowerCase()));
  return <dialog ref={dialog} className="workroom" aria-labelledby="workroom-title" aria-describedby="workroom-description"
    onClose={onClose} onCancel={e=>{e.preventDefault();onClose();}}>
    <header className="workroom-head">
      <div><h2 id="workroom-title">Workroom</h2><p id="workroom-description">A little help with the things you need to get done.</p></div>
      <button className="icon-button" aria-label="Close workroom" onClick={onClose}><X size={22} weight="light" /></button>
    </header>
    <div className="workroom-notices" aria-live="polite">
      {!sub?<p>Sign in to save your tasks.</p>:offline?<p>You’re offline. Read saved tasks or prepare changes; reconnect to save and check them.</p>:cached&&<p>Showing your saved copy while we check for updates.</p>}
      {busy&&<p>{busy==='loading'?'Loading your tasks…':['check','run'].includes(busy)?'Saving and checking your task…':busy==='delete'?'Deleting your task…':'Saving your task…'}</p>}
      {status&&busy!=='loading'&&<p>{status}</p>}
    </div>
    {draft&&missing.length>0&&<div className="work-error" role="alert"><p>Fill in these details first, then try again:</p>
      <ul className="work-missing">{missing.slice(0,8).map((item,i)=><li key={i}>{item.replace(/^Inputs( · |: )/,'')}</li>)}{missing.length>8&&<li>…and {missing.length-8} more</li>}</ul></div>}
    {problem&&<div className="work-error" role="alert"><p>{problem}</p>{conflict?<div className="work-inline-actions">
      <button disabled={mutationBusy||offline} onClick={refresh}>Get latest saved tasks</button>
      <button disabled={mutationBusy||offline} onClick={()=>mutate('save',true)}>Save my copy</button>
      {saved&&saved.revision!==base&&<button disabled={mutationBusy} onClick={()=>choose(saved)}>Use saved copy and discard my changes</button>}
    </div>:<button disabled={mutationBusy||offline} onClick={refresh}>Refresh saved tasks</button>}</div>}
    {pending&&<div className="work-error" role="alert"><p>You have unsaved changes. Keep working, or discard them to leave this task.</p><div className="work-inline-actions">
      <button onClick={()=>setPending(null)}>Keep editing</button><button onClick={()=>{const go=pending;setPending(null);go();}}>Discard changes</button>
    </div></div>}
    <input ref={file} type="file" accept="application/json,.json" hidden onChange={importFile} />
    <div ref={scrollArea} className="workroom-scroll" key={draft ? `task-${draft.id}` : 'browse'}>
      {!draft ? <>
        <div className="work-home-nav">
          <div className="work-tabs" role="group" aria-label="Choose a view">
            <button aria-pressed={view==='tools'} onClick={()=>{setView('tools');setQuery('');}}>Start a task</button>
            <button aria-pressed={view==='saved'} onClick={()=>{setView('saved');setQuery('');}}>My saved tasks <span>{records.length}</span></button>
          </div>
          <details className="work-file-menu"><summary>Files &amp; backup</summary><div>
            <button onClick={()=>file.current?.click()} disabled={mutationBusy}><UploadSimple size={17} />Import a file</button>
            <button onClick={()=>download(records)} disabled={!records.length}><DownloadSimple size={17} />Export saved tasks</button>
            <button onClick={refresh} disabled={!sub||offline||mutationBusy}><ArrowClockwise size={17} />Refresh tasks</button>
          </div></details>
        </div>
        {imports.length>0&&<section className="work-imports" aria-label="Import preview"><h3>Tasks ready to import</h3><p>Open a task to review it. Nothing is saved until you choose to save.</p>
          <div className="work-inline-actions">{imports.map((item,i)=><button key={i} onClick={()=>navigate(()=>{create(CAPABILITIES.find(c=>c.id===item.capabilityId));setDraft({...item,id:crypto.randomUUID()});setImports(imports.filter((_,j)=>j!==i));})}>{item.title || `Task ${i+1}`}</button>)}<button onClick={()=>setImports([])}>Dismiss</button></div>
        </section>}
        <section className="work-browser" aria-label={view==='tools'?'Choose a tool':'My saved tasks'}>
          <div className="work-browser-head"><div><h3>{view==='tools'?'What would you like help with?':'Pick up where you left off.'}</h3>
            <p>{view==='tools'?'Choose one task. We’ll walk through the details together.':'Your saved details and results stay together here.'}</p></div>
            <label className="work-search"><span className="sr-only">{view==='tools'?'Find a tool':'Find a saved task'}</span>
              <input type="search" aria-label={view==='tools'?'Find a tool':'Find a saved task'} value={query} onChange={e=>setQuery(e.target.value)} placeholder={view==='tools'?'Find a tool…':'Find a saved task…'} /></label>
          </div>
          {view==='tools'?<>
            <div className="work-categories" role="group" aria-label="Filter tools by topic">
              <button aria-pressed={group==='all'} onClick={()=>setGroup('all')}>All tools</button>
              {Object.entries(TOOL_GROUPS).map(([key,label])=><button key={key} aria-pressed={group===key} onClick={()=>setGroup(key)}>{label}</button>)}
            </div>
            {grouped.map(([name,items])=><section className="work-tool-group" key={name}>
              {group==='all'&&<h4>{TOOL_GROUPS[name] || name}</h4>}<div className="work-tool-grid">{items.map(item=><button className="work-tool-card" key={item.id} onClick={()=>navigate(()=>create(item))}>
                <span><strong>{item.title}</strong><span>{item.description}</span></span><ArrowRight size={18} weight="light" aria-hidden="true" />
              </button>)}</div>
            </section>)}
            {!grouped.length&&<p className="work-empty">No tools match that search. Try a shorter word or another topic.</p>}
          </>:matchingRecords.length?<div className="work-saved-list">{matchingRecords.map(record=><button className="work-saved-card" key={record.id} onClick={()=>navigate(()=>choose(record))}>
            <FolderOpen size={23} weight="light" aria-hidden="true" /><span><strong>{record.title}</strong><span>{fieldTitle(record.scope || 'personal')} · {record.output?'Result saved':'Draft'}{record.updated?` · ${new Date(record.updated).toLocaleDateString()}`:''}</span></span><ArrowRight size={18} aria-hidden="true" />
          </button>)}</div>:<div className="work-empty"><FolderOpen size={35} weight="light" /><h4>{records.length?'No tasks match that search.':'Your tasks will live here.'}</h4>
            <p>{records.length?'Try a different word.':'Start a task, add your details, and save it to come back later.'}</p><button className="work-primary" onClick={()=>{setView('tools');setQuery('');}}>Start a task <Plus size={17} /></button></div>}
        </section>
      </> : <section className="work-task" aria-label="Your task">
        <button className="work-back" disabled={mutationBusy} onClick={leaveTask}><ArrowLeft size={17} />{view==='saved'?'Back to saved tasks':'Back to tools'}</button>
        <header className="work-detail-head"><p>{TOOL_GROUPS[capability?.group] || capability?.group}</p><h3 ref={taskHeading} tabIndex={-1}>{capability?.title || 'Your task'}</h3><p>{capability?.description}</p></header>
        {saved?.output&&<div className="work-panel-tabs" role="group" aria-label="Task view"><button aria-pressed={panel==='details'} onClick={()=>setPanel('details')}>Details</button><button aria-pressed={panel==='result'} onClick={()=>setPanel('result')}>Result</button></div>}
        {panel==='result'&&saved?.output?<section className="work-output" aria-label="Your result">
          <div className="work-result-heading"><ListChecks size={25} weight="light" aria-hidden="true" /><h4 ref={resultHeading} tabIndex={-1}>{overview.title}</h4></div>
          {dirty&&<p className="work-help">This result uses your last saved details. Save and check again to include your edits.</p>}
          {overview.facts.length>0&&<ul className="work-findings">{overview.facts.map((fact,i)=><li key={i}>{fact}</li>)}</ul>}
          <p className="work-help">{saved.output.result?.mode==='native-document-readback'?'This check read your saved Vaelo document. Edits that have not synced are left out.':'This result uses the details you added. It does not change anything in other apps.'}</p>
          <details className="work-result-details"><summary>See the full result</summary><Readable value={saved.output.result} /></details>
          {saved.output.limitations?.length>0&&<details className="work-result-details"><summary>What this check can and cannot tell you</summary><Readable value={saved.output.limitations} /></details>}
          <div className="work-action-bar"><button className="work-primary" disabled={dirty||mutationBusy||offline||conflict} onClick={()=>mutate('discuss')}><ChatCircle size={18} />Ask Vaelo about this</button><button disabled={mutationBusy} onClick={()=>setPanel('details')}>Edit details</button><button disabled={dirty||mutationBusy||offline||conflict} onClick={()=>mutate('run')}>Check again</button></div>
        </section>:<>
          <form onSubmit={e=>{e.preventDefault();mutate('check');}}>
            <fieldset disabled={mutationBusy} className="work-editor"><SchemaField key={`${draft.id}:${draft.capabilityId}`} schema={{...capability?.inputSchema,title:'Add your details'}} value={draft.input} onChange={input=>edit({...draft,input})} /></fieldset>
            <details className="work-task-options"><summary>Task name &amp; folder <span>{fieldTitle(draft.scope)}</span></summary><div className="work-field"><label htmlFor="work-title">Task name</label><input id="work-title" maxLength={160} value={draft.title} onChange={e=>edit({...draft,title:e.target.value})} disabled={mutationBusy} /></div>
              <div className="work-field"><label htmlFor="work-scope">Keep this under</label><select id="work-scope" value={draft.scope} onChange={e=>edit({...draft,scope:e.target.value})} disabled={mutationBusy}>{SCOPES.map(scope=><option key={scope} value={scope}>{fieldTitle(scope)}</option>)}</select><p className="work-help">Vaelo uses this task in a conversation only when you choose to discuss it.</p></div>
            </details>
            <div className="work-action-bar"><button className="work-primary" type="submit" disabled={!sub||offline||mutationBusy||conflict}><Play size={17} />{busy==='check'?'Checking…':'Save & check'}</button>
              <button type="button" title="Saves what you have so far and opens a conversation about it" disabled={!sub||offline||mutationBusy||conflict} onClick={()=>mutate('discuss')}><ChatCircle size={17} />Ask Vaelo for help</button>
              <span className="work-save-state">{dirty?<button type="button" className="work-text-button" disabled={!sub||offline||mutationBusy||conflict} onClick={()=>mutate('save')}>Save draft</button>:'Saved'}</span>
            </div>
          </form>
        </>}
        {base&&<details className="work-task-options work-manage"><summary>Export or delete this task</summary><div className="work-inline-actions"><button onClick={()=>download([draft],draft.title)}><DownloadSimple size={17} />Export task</button>
          {!confirmDelete&&<button disabled={mutationBusy||offline||conflict} onClick={()=>setConfirmDelete(true)}><Trash size={17} />Delete task</button>}</div>
          {confirmDelete&&<div className="work-delete"><p>Delete this task and its saved result? This cannot be undone here.</p><button disabled={mutationBusy||offline} onClick={()=>mutate('delete')}>Yes, delete task</button><button onClick={()=>setConfirmDelete(false)}>Keep task</button></div>}
        </details>}
      </section>}
    </div>
  </dialog>;
}
