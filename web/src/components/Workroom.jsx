import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { X, Plus, Trash, DownloadSimple, UploadSimple, ArrowClockwise, Play, ChatCircle } from '@phosphor-icons/react';
import { CAPABILITIES } from '../../shared/capabilities.js';
import { schemaValue, inferredSchema, fieldTitle, validateInput, readWorkCache, writeWorkCache, requestWork, importWork, draftMatches, prepareInput, valueForType } from '../lib/workroom.js';
import './workroom.css';

const TYPES = ['string', 'number', 'boolean', 'object', 'array'];
const SCOPES = ['personal', 'work', 'client'];

function ValueType({ value, onChange, label }) {
  return <label className="work-type">{label}<select value={inferredSchema(value).type} onChange={e => onChange(valueForType(e.target.value))}>
    {TYPES.map(type => <option key={type} value={type}>{type === 'string' ? 'Text' : fieldTitle(type)}</option>)}
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
  if (depth > 12) return <p className="work-problem">This record is too deeply nested to edit here. Remove the parent item and simplify it.</p>;
  if (schema.type === 'object') return <fieldset className="work-fields"><legend>{title}{required ? ' · required' : ''}</legend>
    {schema.description && <p className="work-help">{schema.description}</p>}
    {schema.properties ? Object.entries(schema.properties).map(([key, child]) => <SchemaField key={key} schema={{ ...child, title: child.title || fieldTitle(key) }}
      required={schema.required?.includes(key)} value={value?.[key] ?? schemaValue(child)} onChange={next => onChange({ ...(value || {}), [key]: next })} depth={depth + 1} />)
      : <FreeFields value={value} onChange={onChange} depth={depth} />}
  </fieldset>;
  if (schema.type === 'array') {
    const items = Array.isArray(value) ? value : [];
    rowKeys.current.length = Math.min(rowKeys.current.length, items.length);
    while(rowKeys.current.length < items.length) rowKeys.current.push(`${id}-row-${nextKey.current++}`);
    return <fieldset className="work-fields"><legend>{title}{required ? ' · required' : ''}</legend>
      {schema.description && <p className="work-help">{schema.description}</p>}
      {!items.length && <p className="work-help">No items yet. Add the records you want Vaelo to use.</p>}
      {items.map((item, index) => <div className="work-record-row" key={rowKeys.current[index]}>
        <div className="work-row-tools"><span>{title} {index + 1}</span>
          {!schema.items?.type && <ValueType value={item} label={`Type for item ${index + 1}`} onChange={next => onChange(items.map((v, i) => i === index ? next : v))} />}
          <button type="button" className="icon-button" aria-label={`Remove ${title} item ${index + 1}`} onClick={() => {rowKeys.current.splice(index,1);onChange(items.filter((_, i) => i !== index));}}><Trash size={18} weight="light" /></button></div>
        <SchemaField schema={{ ...(schema.items?.type ? schema.items : inferredSchema(item)), title: schema.items?.title || `Item ${index + 1}` }} value={item} onChange={next => onChange(items.map((v, i) => i === index ? next : v))} depth={depth + 1} />
      </div>)}
      <button type="button" className="work-text-button" onClick={() => onChange([...items, schemaValue(schema.items || { type: 'string' })])}><Plus size={17} weight="light" />Add item</button>
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
  const sub = session?.user?.sub || null; account.current = sub;
  const [records, setRecords] = useState([]), [draft, setDraft] = useState(null), [base, setBase] = useState(null);
  const [query, setQuery] = useState(''), [view, setView] = useState('saved'), [busy, setBusy] = useState(''), [problem, setProblem] = useState('');
  const [status, setStatus] = useState(''), [cached, setCached] = useState(false), [conflict, setConflict] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine), [imports, setImports] = useState([]), [pending, setPending] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const capability = CAPABILITIES.find(c => c.id === draft?.capabilityId);
  const saved = records.find(record => record.id === draft?.id);
  const dirty = Boolean(draft && !draftMatches(saved, draft));
  const offline = !online || session?.offline;
  const mutationBusy = Boolean(busy);
  const grouped = useMemo(() => {
    const groups = new Map();
    for (const item of CAPABILITIES.filter(c => `${c.id} ${c.title} ${c.description} ${c.group}`.toLowerCase().includes(query.toLowerCase()))) groups.set(item.group, [...(groups.get(item.group) || []), item]);
    return [...groups];
  }, [query]);

  useEffect(() => { const yes=()=>setOnline(true), no=()=>setOnline(false); window.addEventListener('online',yes); window.addEventListener('offline',no); return ()=>{window.removeEventListener('online',yes);window.removeEventListener('offline',no);}; }, []);
  useEffect(() => {
    setRecords(readWorkCache(sub)); setDraft(null); setBase(null); setProblem(''); setStatus(''); setCached(true); setConflict(false); setImports([]); setPending(null); setBusy('');
  }, [sub]);
  useEffect(() => { const el=dialog.current; if(open && !el.open) el.showModal(); else if(!open && el.open) el.close(); }, [open]);

  async function refresh() {
    if (!sub || offline) return;
    const owner=sub, sequence=++fetchSequence.current;
    setBusy('loading'); if(!conflict) setProblem('');
    try {
      const data=await requestWork(null, {csrf:session?.csrf});
      if (account.current !== owner || sequence !== fetchSequence.current) return;
      setRecords(data.records || []); writeWorkCache(owner,data.records || []); setCached(false); setStatus('Saved work is up to date.');
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
      setBase(null);setConflict(false);setView('saved');setStatus('Proposal opened for your review. Save it before running or discussing it.');
    };
    if(dirty)setPending(()=>loadProposal);else loadProposal();
  }, [open, initialProposal, sub]);

  function edit(next) { setDraft(next); setStatus(''); setProblem(''); }
  function navigate(action) { if(mutationBusy) return; if(dirty) setPending(()=>action); else action(); }
  function choose(record) { setDraft(structuredClone(record)); setBase(record.revision); setConflict(false); setProblem(''); setStatus(''); setConfirmDelete(false); }
  function create(type) { setDraft({id:crypto.randomUUID(),capabilityId:type.id,title:type.title,input:schemaValue(type.inputSchema),scope:'personal'});setBase(null);setConflict(false);setProblem('');setStatus(''); }
  function remember(record) {
    const next=record.deleted ? records.filter(r=>r.id!==record.id) : [record,...records.filter(r=>r.id!==record.id)];
    setRecords(next);writeWorkCache(sub,next);onRecordChange?.(record);return next;
  }
  async function mutate(action, separate = false) {
    if(!draft || !sub || offline || mutationBusy) return;
    if(action==='save'&&!draft.title.trim()) {setProblem('Give this work a title before saving.');return;}
    if(action==='run') {
      if(dirty || !saved || !base) {setProblem('Save your current changes before running.');return;}
      const errors=validateInput(capability.inputSchema,prepareInput(capability.inputSchema,draft.input)); if(errors.length) {setProblem(errors.slice(0,6).join('\n'));return;}
    }
    const owner=sub;
    setBusy(action);setProblem('');setStatus('');
    const id=separate?crypto.randomUUID():draft.id;
    try {
      const body=action==='save'?{action,record:{id,capabilityId:draft.capabilityId,title:draft.title.trim(),input:prepareInput(capability.inputSchema,draft.input),scope:draft.scope},base:separate?null:base}:{action,id,base};
      const data=await requestWork(body,{csrf:session?.csrf});
      if(account.current!==owner) return;
      remember(data.record);setCached(false);setConflict(false);
      if(action==='delete') {setDraft(null);setBase(null);setConfirmDelete(false);setStatus('Saved record deleted.');return;}
      choose(data.record);
      setStatus(action==='run'?'Run finished. Read its result and limitations below.':separate?'Saved as a separate record.':'Saved. Your inputs are ready to review or run.');
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

  return <dialog ref={dialog} className="workroom" aria-labelledby="workroom-title" aria-describedby="workroom-description" onClose={onClose} onCancel={e=>{e.preventDefault();onClose();}}>
    <header className="workroom-head"><div><p className="label">Vaelo · Work</p><h2 id="workroom-title">A place to follow through.</h2><p id="workroom-description">Keep the inputs, check the result, and bring the work back to your conversation.</p></div><button className="icon-button" aria-label="Close workroom" onClick={onClose}><X size={22} weight="light" /></button></header>
    <div className="workroom-toolbar"><div className="work-tabs" aria-label="Work views"><button aria-pressed={view==='saved'} onClick={()=>setView('saved')}>Saved work <span>{records.length}</span></button><button aria-pressed={view==='tools'} onClick={()=>setView('tools')}>Tools <span>{CAPABILITIES.length}</span></button></div>
      <div className="work-file-actions"><button onClick={()=>file.current?.click()} disabled={mutationBusy}><UploadSimple size={18} weight="light" />Import</button><button onClick={()=>download(records)} disabled={!records.length}><DownloadSimple size={18} weight="light" />Export</button><button onClick={refresh} disabled={!sub||offline||mutationBusy} aria-label="Refresh saved work"><ArrowClockwise size={18} weight="light" /></button><input ref={file} type="file" accept="application/json,.json" hidden onChange={importFile} /></div>
    </div>
    <div className="workroom-notices" aria-live="polite">{!sub?<p>Sign in to keep your work with your account.</p>:offline?<p>You’re offline. You can read cached work and prepare edits. Reconnect before saving or running.</p>:cached&&<p>Showing this account’s cached records until a refresh succeeds.</p>}{busy&&<p>{busy==='loading'?'Loading saved work…':busy==='run'?'Running the saved version…':busy==='delete'?'Deleting saved record…':'Saving your work…'}</p>}{status&&<p>{status}</p>}</div>
    {problem&&<div className="work-error" role="alert"><p>{problem}</p>{conflict?<div className="work-inline-actions"><button disabled={mutationBusy||offline} onClick={refresh}>Refresh saved versions</button><button disabled={mutationBusy||offline} onClick={()=>mutate('save',true)}>Save my edits separately</button>{saved&&saved.revision!==base&&<button disabled={mutationBusy} onClick={()=>choose(saved)}>Reload saved version and discard edits</button>}</div>:<button disabled={mutationBusy||offline} onClick={refresh}>Refresh saved work</button>}</div>}
    {pending&&<div className="work-error" role="alert"><p>You have unsaved edits. Save them first, or discard them to open another record.</p><div className="work-inline-actions"><button onClick={()=>setPending(null)}>Keep editing</button><button onClick={()=>{const go=pending;setPending(null);go();}}>Discard edits and continue</button></div></div>}
    {imports.length>0&&<section className="work-imports" aria-label="Import preview"><h3>Review imported work</h3><p>Open one record at a time. Review its fields and save it as new work.</p><div className="work-inline-actions">{imports.map((item,i)=><button key={i} onClick={()=>navigate(()=>{create(CAPABILITIES.find(c=>c.id===item.capabilityId));setDraft({...item,id:crypto.randomUUID()});setImports(imports.filter((_,j)=>j!==i));})}>{item.title || `Record ${i+1}`}</button>)}<button onClick={()=>setImports([])}>Dismiss import</button></div></section>}
    <div className="workroom-layout"><aside className="workroom-index" aria-label={view==='tools'?'Available tools':'Saved work'}>
      <label className="work-search">{view==='tools'?'Find a tool':'Find saved work'}<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={view==='tools'?'Search tasks or names':'Search your records'} /></label>
      {view==='tools'?grouped.map(([group,items])=><section key={group}><h3>{group}</h3>{items.map(item=><button className="work-index-item" key={item.id} aria-current={capability?.id===item.id?'true':undefined} onClick={()=>navigate(()=>create(item))}><span>{item.title}</span><small>{item.description}</small></button>)}</section>):<>
        {!records.length&&<div className="work-empty"><h3>Start with a task.</h3><p>Choose a tool, add your own information, and save a record you can return to.</p><button onClick={()=>setView('tools')}>Browse tools</button></div>}
        {records.filter(r=>`${r.title} ${r.scope}`.toLowerCase().includes(query.toLowerCase())).map(record=><button key={record.id} className="work-index-item" aria-current={draft?.id===record.id?'true':undefined} onClick={()=>navigate(()=>choose(record))}><span>{record.title}</span><small>{SCOPES.includes(record.scope)?fieldTitle(record.scope):'Personal'} · {record.output?fieldTitle(record.output.status || 'result available'):'Draft'}</small></button>)}
      </>}
      {((view==='tools'&&!grouped.length)||(view==='saved'&&records.length>0&&!records.some(r=>`${r.title} ${r.scope}`.toLowerCase().includes(query.toLowerCase()))))&&<p className="work-help">No matches. Try another search.</p>}
    </aside>
    <section className="workroom-detail" aria-label="Work record">
      {!draft?<div className="work-intro"><span className="label">Yours to review</span><h3>Useful work starts with clear inputs.</h3><p>Choose one of 36 tools for checking actions, organizing evidence, reviewing decisions, or preparing a handoff.</p><p className="work-help">Each run checks only the information you provide. Its result tells you what was established and what still needs attention.</p><button onClick={()=>setView('tools')}>Choose a tool</button></div>:<>
        <header className="work-detail-head"><p className="label">{capability?.group}</p><h3>{capability?.title || 'Work record'}</h3><p>{capability?.description}</p></header>
        <form onSubmit={e=>{e.preventDefault();mutate('save');}}>
          <fieldset disabled={mutationBusy} className="work-editor"><div className="work-field"><label htmlFor="work-title">Title</label><input id="work-title" required maxLength={160} value={draft.title} onChange={e=>edit({...draft,title:e.target.value})} /></div>
            <div className="work-field"><label htmlFor="work-scope">Context</label><select id="work-scope" value={draft.scope} onChange={e=>edit({...draft,scope:e.target.value})}>{SCOPES.map(scope=><option key={scope} value={scope}>{fieldTitle(scope)}</option>)}</select><p className="work-help">Choose which context this record belongs to. It is included in chat only when you choose Discuss.</p></div>
            <SchemaField key={`${draft.id}:${draft.capabilityId}`} schema={{...capability?.inputSchema,title:'Your inputs'}} value={draft.input} onChange={input=>edit({...draft,input})} />
          </fieldset>
          <div className="work-record-actions"><button className="work-primary" type="submit" disabled={offline||!sub||mutationBusy||conflict}>{busy==='save'?'Saving…':base?'Save changes':'Save work'}</button><button type="button" disabled={offline||mutationBusy||dirty||!base||conflict} onClick={()=>mutate('run')}><Play size={17} weight="light" />Run saved version</button><button type="button" disabled={dirty||!saved||mutationBusy||conflict} onClick={()=>onDiscuss?.(saved)}><ChatCircle size={17} weight="light" />Discuss</button><button type="button" onClick={()=>download([draft],draft.title)}><DownloadSimple size={17} weight="light" />Export this record</button></div>
          <p className="work-help">{dirty?'You have unsaved edits. Save before running or discussing.':base?'This is a saved version. Runs do not schedule ongoing automation.':'New record. Nothing has been saved yet.'}</p>
          {base&&<div className="work-delete">{confirmDelete?<><p>Delete this saved record? Its saved inputs and result will be removed. Any unsaved edits here will be discarded.</p><div className="work-inline-actions"><button type="button" disabled={mutationBusy||offline} onClick={()=>mutate('delete')}>Delete this record</button><button type="button" onClick={()=>setConfirmDelete(false)}>Keep record</button></div></>:<button type="button" className="work-text-button" disabled={mutationBusy||offline||conflict} onClick={()=>setConfirmDelete(true)}><Trash size={17} weight="light" />Delete saved record</button>}</div>}
        </form>
        {saved?.output&&<section className="work-output" aria-label="Saved run result"><header><p className="label">Result · {fieldTitle(saved.output.status || 'available')}{dirty?' · from the last saved version':''}</p><h3>{saved.output.summary || 'Run result'}</h3></header><Readable value={saved.output.result} />{saved.output.limitations?.length>0&&<div className="work-limitations"><h4>What this result can establish</h4><Readable value={saved.output.limitations} /></div>}</section>}
      </>}
    </section></div>
  </dialog>;
}
