import { spotlight } from './blocks/RichUI.jsx';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { X, Plus, Trash, DownloadSimple, UploadSimple, ArrowClockwise, ArrowLeft, ArrowRight, ChatCircle, Calculator, FolderOpen, FileText, ClipboardText, Sparkle, Check as Tick } from '@phosphor-icons/react';
import { WORKSPACES, AUDIENCES, getWorkspace } from '../../shared/workspaces.js';
import { getCheck, CHECKS, missingAnswers } from '../../shared/checks.js';
import { parseMoney, parseDate, formatMoney, formatDate } from '../../shared/plain.js';
import { WORK_LIMITS, CUSTOM_WORKSPACE, workspaceFor, checkFor, contextPlan } from '../../shared/work-records.js';
import { readWorkCache, writeWorkCache, requestWork, importWork, draftMatches, blankDraft, saveBody, exportWork, readDocumentCache, writeDocumentCache,
  documentSize, answersFor } from '../lib/workroom.js';
import { readAttachment } from '../lib/attachments.js';
import { AUDIENCE_NAMES, matchWorkspaces, resultOverview } from '../lib/workroom-view.js';
import './workroom.css';
import { DESKTOP, saveDesktopFile } from '../lib/desktop.js';
import { usePhone } from '../lib/use-phone.js';

const SCOPES = [['personal', 'Personal'], ['work', 'Work'], ['client', 'A client']];
const SCOPE_NAME = Object.fromEntries(SCOPES);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lookups = { getWorkspace, getCheck };

async function download(data, title = 'vaelo-backup') {
  const name = `${title.replace(/[^a-z0-9_-]/gi,'-').slice(0,70)}.json`;
  if (DESKTOP) return saveDesktopFile(name, JSON.stringify(data, null, 2));
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${title.replace(/[^a-z0-9_-]/gi,'-').slice(0,70)}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/* One question of a check, answered in everyday words. Money and dates say
   back what Vaelo understood, so a typo shows up before anything runs. */
function CheckField({ field, value, onChange }) {
  const id = useId();
  const typed = value.trim();
  let heard = null;
  if (typed && field.kind === 'money') { const found = parseMoney(typed); heard = found ? { ok: true, text: `Got it: ${formatMoney(found.amount, found.symbol)}` } : { ok: false, text: 'Vaelo can’t see an amount yet. Try something like “$40”.' }; }
  if (typed && field.kind === 'date') { const found = parseDate(typed); heard = found ? { ok: true, text: `Got it: ${formatDate(found)}` } : { ok: false, text: 'Vaelo can’t read that date yet. Try “30 Oct” or “next Friday”.' }; }
  const box = field.kind === 'lines' || field.kind === 'paste';
  const [touched, setTouched] = useState(false);
  const invalid = touched && field.required && !String(value || '').trim();
  const common = { id, value, onBlur: () => setTouched(true), 'aria-invalid': invalid || undefined, onChange: e => onChange(e.target.value), 'aria-describedby': `${id}-hint${heard ? ` ${id}-heard` : ''}`, 'aria-required': field.required || undefined };
  return <div className="work-field">
    <label htmlFor={id}>{field.label}{!field.required && <span className="work-required">Optional</span>}</label>
    {box ? <textarea {...common} rows={field.kind === 'paste' ? 6 : 4} /> : <input {...common} type="text" autoComplete="off" />}
    {invalid && <p className="work-help" role="alert">This answer is needed to run the check.</p>}
    <p id={`${id}-hint`} className="work-help">{field.hint}</p>
    {heard && <p id={`${id}-heard`} className="work-heard" data-ok={heard.ok || undefined}>{heard.text}</p>}
  </div>;
}

/* One named place for a file: drop it, choose it, or paste the words. */
function DocumentSlot({ slot, docs, disabled, onFiles, onPaste, onRemove, onPreview, preview }) {
  const input = useRef(null), id = useId();
  const [over, setOver] = useState(false), [pasting, setPasting] = useState(false), [name, setName] = useState(''), [text, setText] = useState('');
  const filled = docs.length > 0;
  const extra = slot.id === 'extra';
  function drop(event) {
    event.preventDefault(); setOver(false);
    if (!disabled && event.dataTransfer?.files?.length) onFiles([...event.dataTransfer.files], slot.id);
  }
  return <section className="work-slot" data-filled={filled || undefined} data-over={over || undefined} aria-labelledby={`${id}-label`}
    onDragOver={e => { if (disabled) return; e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
    <div className="work-slot-head">
      <h5 id={`${id}-label`}>{slot.label}</h5>
      <span className="work-slot-need">{filled ? <><Tick size={15} aria-hidden="true" /> Added</> : slot.required ? 'Recommended' : 'Optional'}</span>
    </div>
    {slot.hint && <p className="work-help">{slot.hint}</p>}
    {docs.map(doc => <div className="work-doc" key={doc.id}>
      <FileText size={20} weight="light" aria-hidden="true" />
      <span className="work-doc-name"><strong>{doc.name}</strong><span>{documentSize(doc.chars ?? doc.text?.length ?? 0)}{typeof doc.text === 'string' ? ' · not saved yet' : ''}</span></span>
      <button type="button" className="work-text-button" aria-expanded={preview?.id === doc.id} onClick={() => onPreview(doc)}>{preview?.id === doc.id ? 'Hide preview' : 'Preview'}</button>
      <button type="button" className="icon-button" disabled={disabled} aria-label={`Remove ${doc.name}`} onClick={() => onRemove(doc.id)}><Trash size={18} weight="light" /></button>
      {preview?.id === doc.id && <pre className="work-doc-preview" tabIndex={0}>{preview.text ?? 'You’re offline, so this file can’t be shown right now.'}</pre>}
    </div>)}
    {(!filled || extra) && !pasting && <div className="work-slot-actions">
      <button type="button" disabled={disabled} onClick={() => input.current?.click()}><UploadSimple size={17} weight="light" />{filled ? 'Add another' : 'Add file'}</button>
      <button type="button" disabled={disabled} onClick={() => { setPasting(true); setName(extra ? '' : slot.label); }}><ClipboardText size={17} weight="light" />Paste text</button>
      <span className="work-slot-drop" aria-hidden="true">or drop a file here</span>
    </div>}
    {filled && !extra && !pasting && <button type="button" className="work-text-button" disabled={disabled} onClick={() => input.current?.click()}>Swap for another file</button>}
    {pasting && <div className="work-paste">
      <label>Paste your text<textarea rows={6} value={text} autoFocus onChange={e => setText(e.target.value)} /></label>
      <label>Name<input value={name} maxLength={160} placeholder={slot.label} onChange={e => setName(e.target.value)} /></label>
      <div className="work-inline-actions">
        <button type="button" className="work-primary" disabled={!text.trim()} onClick={() => { onPaste({ name: name.trim() || slot.label, text: text.replace(/\r\n/g, '\n') }, slot.id); setPasting(false); setText(''); }}>Add</button>
        <button type="button" onClick={() => { setPasting(false); setText(''); }}>Cancel</button>
      </div>
    </div>}
    <input ref={input} type="file" hidden multiple={extra} onChange={e => { const files = [...(e.target.files || [])]; e.target.value = ''; if (files.length) onFiles(files, slot.id); }} />
  </section>;
}

export function Workroom({ open, onClose, session, onStart, initialDraft = null, onRecordChange, chats = [], onOpenChat, onAddChat }) {
  const phone = usePhone();
  const dialog = useRef(null), file = useRef(null), account = useRef(null), fetchSequence = useRef(0);
  const scrollArea = useRef(null), taskHeading = useRef(null), resultHeading = useRef(null);
  const sub = session?.user?.sub || null; account.current = sub;
  const [records, setRecords] = useState([]), [draft, setDraft] = useState(null), [base, setBase] = useState(null);
  const [query, setQuery] = useState(''), [view, setView] = useState('catalogue'), [busy, setBusy] = useState(''), [problem, setProblem] = useState('');
  const [status, setStatus] = useState(''), [cached, setCached] = useState(false), [conflict, setConflict] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine), [imports, setImports] = useState([]), [pending, setPending] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false), [missing, setMissing] = useState([]);
  const [audience, setAudience] = useState('all'), [panel, setPanel] = useState('setup'), [preview, setPreview] = useState(null);
  const texts = useRef({});
  const workspace = draft ? workspaceFor(draft) : null;
  const check = draft ? checkFor(draft) : null;
  const saved = records.find(record => record.id === draft?.id);
  const dirty = Boolean(draft && !draftMatches(saved, draft));
  const offline = !online || session?.offline;
  const mutationBusy = Boolean(busy);
  const custom = draft?.workspaceId === CUSTOM_WORKSPACE;
  const project = !phone && draft?.kind === 'project';
  const [addChatId, setAddChatId] = useState('');
  const projectChats = project ? chats.filter(chat => chat.workContext?.id === draft.id).sort((a,b) => (b.updated || 0) - (a.updated || 0)) : [];
  const otherChats = project ? chats.filter(chat => chat.messages.length && chat.workContext?.id !== draft.id) : [];
  const matches = useMemo(() => matchWorkspaces(WORKSPACES, query, audience), [query, audience]);
  const grouped = useMemo(() => AUDIENCES.map(item => [item, matches.filter(w => w.audience === item.id)]).filter(([, items]) => items.length), [matches]);
  const overview = saved?.output ? resultOverview(saved.output) : null;
  const plan = draft && workspace && !workspace.retired ? contextPlan({ brief: custom ? draft.brief || '' : workspace.brief, notes: draft.notes || '', documents: draft.documents || [] }) : null;
  const extraSlot = { id: 'extra', label: custom ? 'Files it should always have' : 'Anything else', hint: custom ? 'Notes, examples or anything Vaelo should read every time.' : 'Any other file that would help.' };
  const answers = check && draft?.check ? answersFor(check, draft.check.input) : null;
  const canCheck = Boolean(check && (!check.needsSource || answers?.source));

  useEffect(() => {
    if (!open) return;
    scrollArea.current?.scrollTo({top:0});
    (panel==='result' ? resultHeading.current : taskHeading.current)?.focus({preventScroll:true});
  }, [open, draft?.id, panel]);
  useEffect(() => { const yes=()=>setOnline(true), no=()=>setOnline(false); window.addEventListener('online',yes); window.addEventListener('offline',no); return ()=>{window.removeEventListener('online',yes);window.removeEventListener('offline',no);}; }, []);
  useEffect(() => {
    setRecords(readWorkCache(sub)); texts.current = readDocumentCache(sub); setDraft(null); setBase(null); setProblem(''); setStatus(''); setCached(true); setConflict(false);
    setImports([]); setPending(null); setBusy(''); setQuery(''); setAudience('all'); setPanel('setup'); setPreview(null);
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
    } catch(error) { if(account.current===owner) setProblem(error.status === 401 ? 'Please sign in again to see your saved work.' : 'Vaelo couldn’t get your latest work. What’s saved on this device is still here.'); }
    finally { if(account.current===owner && sequence===fetchSequence.current) setBusy(''); }
  }
  useEffect(() => { if(open && sub && !offline) refresh(); /* Refresh never replaces an open draft. */ }, [open, sub, offline]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if(!open || !initialDraft?.draft || !sub) return;
    const load=()=>{ setDraft(structuredClone(initialDraft.draft)); setBase(null); setPanel(initialDraft.panel || 'setup'); setConflict(false); setProblem(''); setMissing([]); setPreview(null);
      setStatus(initialDraft.message || 'Have a look, then save it. Nothing is saved yet.'); };
    if(dirty) setPending(()=>load); else load();
  }, [open, initialDraft, sub]); // eslint-disable-line react-hooks/exhaustive-deps

  function edit(next) { setDraft(next); setStatus(''); setProblem(''); }
  function setAnswer(key, value) { edit({ ...draft, check: { id: check.id, input: { ...answers, [key]: value } } }); setMissing([]); }
  function navigate(action) { if(mutationBusy) return; if(dirty) setPending(()=>action); else action(); }
  function choose(record, keepPanel = false) {
    setDraft(structuredClone(record)); setBase(record.revision);
    if (!keepPanel) setPanel(record.output && !record.documents?.length ? 'result' : 'setup');
    setConflict(false); setProblem(''); setStatus(''); setConfirmDelete(false); setMissing([]); setPreview(null);
  }
  function create(item) { setDraft(blankDraft(item, getCheck)); setBase(null); setPanel('setup'); setConflict(false); setProblem(''); setStatus(''); setMissing([]); setPreview(null); }
  function remember(record) {
    const next=record.deleted ? records.filter(r=>r.id!==record.id) : [record,...records.filter(r=>r.id!==record.id)];
    setRecords(next);writeWorkCache(sub,next);onRecordChange?.(record);return next;
  }

  async function addFiles(files, slotId) {
    const room = WORK_LIMITS.documents - draft.documents.filter(d => slotId === 'extra' || d.slot !== slotId).length;
    if (room <= 0) { setProblem(`There’s room for ${WORK_LIMITS.documents} files here. Remove one to add another.`); return; }
    const notes = [], added = [];
    for (const item of files.slice(0, slotId === 'extra' ? room : 1)) {
      const read = await readAttachment(item);
      if (read.kind === 'image') { notes.push(`${read.name} is a picture. Vaelo can’t keep pictures here yet, so type or paste what it says instead.`); continue; }
      if (read.state === 'empty') { notes.push(`${read.name} is empty.`); continue; }
      if (read.state === 'too-large' || read.body?.length > WORK_LIMITS.documentChars) { notes.push(`${read.name} is too long to keep here. Paste just the part you need.`); continue; }
      if (read.state !== 'ready') { notes.push(`Vaelo can’t open ${read.name} here. Open it yourself, copy the words, then use “Paste words”.`); continue; }
      added.push({ id: crypto.randomUUID(), slot: slotId, name: read.name.slice(0, 160), text: read.body, chars: read.body.length });
    }
    if (slotId === 'extra' && files.length > room) notes.push(`Only ${plural(room, 'more file')} could fit.`);
    if (added.length) setDraft(current => ({ ...current, documents: slotId === 'extra' ? [...current.documents, ...added] : [...current.documents.filter(d => d.slot !== slotId), ...added] }));
    setStatus(''); setProblem(notes.join('\n'));
  }
  function addPasted({ name, text }, slotId) {
    if (text.length > WORK_LIMITS.documentChars) { setProblem('That’s too long to keep here. Paste just the part you need.'); return; }
    if (slotId === 'extra' && draft.documents.length >= WORK_LIMITS.documents) { setProblem(`There’s room for ${WORK_LIMITS.documents} files here. Remove one to add another.`); return; }
    const doc = { id: crypto.randomUUID(), slot: slotId, name: name.slice(0, 160), text, chars: text.length };
    edit({ ...draft, documents: slotId === 'extra' ? [...draft.documents, doc] : [...draft.documents.filter(d => d.slot !== slotId), doc] });
  }
  async function loadTexts(record) {
    if (!record?.documents?.length || record.documents.every(d => typeof texts.current[d.sha] === 'string')) return texts.current;
    if (offline || !sub) return texts.current;
    const data = await requestWork(null, { csrf: session?.csrf, query: `?id=${encodeURIComponent(record.id)}&documents=1` });
    texts.current = { ...texts.current, ...Object.fromEntries(Object.entries(data.documents || {}).filter(([, t]) => typeof t === 'string')) };
    writeDocumentCache(sub, texts.current, records);
    return texts.current;
  }
  async function togglePreview(doc) {
    if (preview?.id === doc.id) { setPreview(null); return; }
    const show = text => setPreview({ id: doc.id, text: typeof text === 'string' ? text.slice(0, 6000) + (text.length > 6000 ? '\n\n…' : '') : null });
    if (typeof doc.text === 'string') { show(doc.text); return; }
    try { show((await loadTexts(saved || draft))[doc.sha]); } catch { show(null); }
  }
  async function exportRecords(list, name) {
    try {
      setBusy('export');
      for (const record of list) await loadTexts(record).catch(() => {});
      const data = exportWork(list, texts.current);
      if (!await download(data, name)) return;
      const gaps = data.records.reduce((n, r) => n + r.documents.filter(d => d.missing).length, 0);
      setStatus(gaps ? `Backup saved. ${plural(gaps, 'file')} couldn’t be added while you’re offline.` : 'Backup saved to your downloads.');
    } finally { setBusy(''); }
  }

  async function mutate(action, { separate = false, prompt } = {}) {
    if(!draft || !sub || offline || mutationBusy) return;
    if(!draft.title.trim()) { setPanel('setup'); setProblem(custom ? 'Give it a name first, like “Weekly report”.' : 'Give it a name first.'); return; }
    if(action==='run') {
      const gaps = missingAnswers(check, answers);
      if(gaps.length) { setPanel('check'); setProblem(''); setMissing(gaps); return; }
    }
    const owner=sub;
    setBusy(action);setProblem('');setMissing([]);setStatus('');
    const id=separate?crypto.randomUUID():draft.id;
    try {
      let record=saved;
      if(action!=='delete' && (dirty || !base || separate)) {
        const body = saveBody(draft, check);
        // A separate copy gets fresh identifiers for itself and its files.
        const ids = new Map(body.documents.map(d => [d.id, separate ? crypto.randomUUID() : d.id]));
        const pendingTexts = Object.fromEntries(draft.documents.filter(d => typeof d.text === 'string').map(d => [ids.get(d.id), d.text]));
        const data=await requestWork({action:'save',record:{...body,id,documents:body.documents.map(d=>({...d,id:ids.get(d.id)}))},base:separate?null:base},{csrf:session?.csrf});
        if(account.current!==owner)return;
        record=data.record;
        for (const doc of record.documents || []) if (pendingTexts[doc.id]) texts.current[doc.sha] = pendingTexts[doc.id];
        const next = remember(record); writeDocumentCache(owner, texts.current, next); choose(record, true);
      }
      if(action==='run') record=(await requestWork({action:'run',id:record.id,base:record.revision},{csrf:session?.csrf})).record;
      else if(action==='delete') record=(await requestWork({action,id,base},{csrf:session?.csrf})).record;
      if(account.current!==owner) return;
      remember(record);setCached(false);setConflict(false);
      if(action==='delete') {setDraft(null);setBase(null);setConfirmDelete(false);setStatus('Deleted.');return;}
      choose(record, true);
      if(action==='start'){onStart?.(record, prompt);return;}
      if(action==='run'){setPanel('result');return;}
      setStatus(separate?'Saved as a copy.':'Saved. It’ll be here next time.');
    } catch(error) {
      if(account.current!==owner) return;
      if(error.status===409 && /changed|syncing/i.test(error.message)) {setConflict(true);setProblem('This was changed on another device. Your changes are still here.');}
      else setProblem(error.status===401?'Please sign in again. Your changes are still here.':error.message || 'That didn’t save. Your changes are still here, so try again.');
    } finally {if(account.current===owner)setBusy('');}
  }
  async function importFile(event) {
    const selected=event.target.files?.[0];event.target.value='';if(!selected)return;
    try { if(selected.size>4_000_000)throw new Error('That file is too big. Choose one under 4 MB.'); const items=importWork(await selected.text(),lookups);setImports(items);setProblem('');setStatus(`Found ${plural(items.length,'workspace')}. Open one to look at it. Nothing is saved yet.`); }
    catch(error){setProblem(error instanceof SyntaxError?'That isn’t a Vaelo backup file.':error.message);}
  }
  function leaveTask() { navigate(()=>{setDraft(null);setBase(null);setProblem('');setConfirmDelete(false);setQuery('');setMissing([]);setPreview(null);}); }

  const savedTasks = records.filter(record => record.kind !== 'project');
  const projects = records.filter(record => record.kind === 'project');
  const matchingRecords=(view === 'projects' && !phone ? projects : savedTasks).filter(r=>`${r.title} ${workspaceFor(r)?.title || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const starters = custom ? (draft?.starters || []).filter(Boolean) : workspace?.starters || [];
  const canAct = Boolean(sub) && !offline && !mutationBusy && !conflict;
  const busyText = {loading:'Getting your work…',save:'Saving…',start:'Getting things ready…',run:'Working it out…',delete:'Deleting…',export:'Making your backup…'}[busy];
  const renderSlot = slot => <DocumentSlot key={slot.id} slot={slot} docs={draft.documents.filter(doc=>doc.slot===slot.id)} disabled={mutationBusy} onFiles={addFiles} onPaste={addPasted} preview={preview} onPreview={togglePreview} onRemove={id=>{edit({...draft,documents:draft.documents.filter(doc=>doc.id!==id)});if(preview?.id===id)setPreview(null);}} />;
  const fillPrompt = check ? `Please fill in “${check.title}” for me from my files and notes.` : '';
  const reusableTask = <button className="work-own" onClick={()=>navigate(()=>create({id:CUSTOM_WORKSPACE}))}>
    <Sparkle size={22} weight="light" aria-hidden="true" /><span><strong>Create a reusable task</strong><span>Save your instructions and files for something you do often.</span></span><ArrowRight size={18} aria-hidden="true" />
  </button>;

  return <dialog ref={dialog} className="workroom" aria-labelledby="workroom-title" aria-describedby="workroom-description"
    onClose={onClose} onCancel={e=>{e.preventDefault();onClose();}}>
    <header className="workroom-head">
      <div><h2 id="workroom-title">Workroom</h2><p id="workroom-description">{project ? 'Your project’s conversations, files, and context.' : draft ? 'Your files, instructions and results for this task.' : 'Choose a task. Add your context. Get help.'}</p></div>
      <button className="icon-button" aria-label="Close the Workroom" onClick={onClose}><X size={22} /></button>
    </header>
    <div className="workroom-notices" aria-live="polite">
      {!sub?<p>Sign in to save your work.</p>:offline?<p>You’re offline. You can read what you’ve saved; saving comes back when you’re online.</p>:cached&&!busy&&<p>Showing what’s saved on this device while Vaelo checks for updates.</p>}
      {busyText&&<p>{busyText}</p>}
      {status&&!busy&&<p>{status}</p>}
    </div>
    {draft&&missing.length>0&&<div className="work-error" role="alert"><p>Please answer these first:</p>
      <ul className="work-missing">{missing.map((item,i)=><li key={i}>{item}</li>)}</ul></div>}
    {problem&&<div className="work-error" role="alert"><p>{problem}</p>{conflict&&<div className="work-inline-actions">
      <button disabled={mutationBusy||offline} onClick={refresh}>Show me the newest</button>
      <button disabled={mutationBusy||offline} onClick={()=>mutate('save',{separate:true})}>Keep mine as a copy</button>
      {saved&&saved.revision!==base&&<button disabled={mutationBusy} onClick={()=>choose(saved)}>Use the newest</button>}
    </div>}</div>}
    {pending&&<div className="work-error" role="alert"><p>You have changes that aren’t saved. Keep going, or throw them away?</p><div className="work-inline-actions">
      <button onClick={()=>setPending(null)}>Keep going</button><button onClick={()=>{const go=pending;setPending(null);go();}}>Throw them away</button>
    </div></div>}
    <input ref={file} type="file" accept="application/json,.json" hidden onChange={importFile} />
    <div ref={scrollArea} className="workroom-scroll" key={draft ? `task-${draft.id}` : 'browse'}>
      {!draft ? <>
        <div className="work-home-nav">
          <div className="work-tabs" role="group" aria-label="Choose what to see">
            <button aria-pressed={view==='catalogue'} onClick={()=>{setView('catalogue');setQuery('');}}>Tasks</button>
            <button aria-pressed={view==='saved'} onClick={()=>{setView('saved');setQuery('');}}>Saved work <span>{savedTasks.length}</span></button>
            {!phone && <button aria-pressed={view==='projects'} onClick={()=>{setView('projects');setQuery('');}}>Projects <span>{projects.length}</span></button>}
          </div>
          <details className="work-file-menu"><summary>Backup</summary><div>
            <button onClick={()=>exportRecords(records,'vaelo-backup')} disabled={!records.length||mutationBusy}><DownloadSimple size={17} />Save a backup file</button>
            <button onClick={()=>file.current?.click()} disabled={mutationBusy}><UploadSimple size={17} />Load a backup file</button>
            <button onClick={refresh} disabled={!sub||offline||mutationBusy}><ArrowClockwise size={17} />Refresh</button>
          </div></details>
        </div>
        {imports.length>0&&<section className="work-imports" aria-label="Ready to load"><h3>Ready to load</h3><p>Open one to look at it. Nothing is saved until you save it.</p>
          <div className="work-inline-actions">{imports.map((item,i)=><button key={i} onClick={()=>navigate(()=>{setDraft({...item,id:crypto.randomUUID()});setBase(null);setPanel('setup');setImports(imports.filter((_,j)=>j!==i));})}>{item.title}</button>)}<button onClick={()=>setImports([])}>Never mind</button></div>
        </section>}
        <section className="work-browser" aria-label={view==='catalogue'?'Workspaces':view==='projects'?'Projects':'Saved work'}>
          <div className="work-browser-head"><div><h3>{view==='catalogue'?'What do you need help with?':view==='projects'?'Your projects':'Pick up where you left off.'}</h3>
            <p>{view==='catalogue'?'Choose a starting point, then add the details that matter.':view==='projects'?'A home for each ongoing goal.':'Your files and answers are kept together.'}</p></div>
            <label className="work-search"><span className="sr-only">{view==='catalogue'?'Search workspaces':view==='projects'?'Search projects':'Search saved work'}</span>
              <input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={view==='catalogue'?'Search, like “refund” or “essay”':view==='projects'?'Search your projects':'Search your saved work'} /></label>
          </div>
          {view==='catalogue'?<>
            <div className="work-categories" role="group" aria-label="Show workspaces for">
              <button aria-pressed={audience==='all'} onClick={()=>setAudience('all')}>Everyone</button>
              {AUDIENCES.map(item=><button key={item.id} aria-pressed={audience===item.id} onClick={()=>setAudience(item.id)}>{item.label}</button>)}
            </div>
            {audience==='all'&&!query.trim()&&(phone ? reusableTask : <div className="work-create-options">{reusableTask}<button className="work-own" onClick={()=>navigate(()=>create({id:CUSTOM_WORKSPACE,kind:'project'}))}>
              <FolderOpen size={22} weight="light" aria-hidden="true" /><span><strong>Create a project</strong><span>Keep a project’s conversations, files, and context together.</span></span><ArrowRight size={18} aria-hidden="true" />
            </button></div>)}
            {grouped.map(([group,items])=><section className="work-group" key={group.id} aria-labelledby={`work-group-${group.id}`}>
              <header><h4 id={`work-group-${group.id}`}>{group.label}</h4><p>{group.line}</p></header>
              <ul className="work-entries">{items.map(item=><li key={item.id}><button className="work-entry rich-spotlight" onPointerMove={spotlight} onClick={()=>navigate(()=>create(item))}>
                <span className="work-entry-text"><strong>{item.title}</strong><span>{item.summary}</span>
                  <span className="work-entry-meta">{item.slots.some(s=>s.required)?`You’ll need: ${item.slots.filter(s=>s.required).map(s=>s.label.toLowerCase()).join(', ')}`:'Files are up to you'}{item.check?<> · <em>Can work it out for you</em></>:null}</span></span>
                <ArrowRight size={18} weight="light" aria-hidden="true" />
              </button></li>)}</ul>
            </section>)}
            {!grouped.length&&<p className="work-empty">Nothing matches that. Try a shorter word, or make your own.</p>}
          </>:matchingRecords.length?<div className="work-saved-list">{matchingRecords.map(record=>{const w=workspaceFor(record);const n=record.documents?.length||0;return <button className="work-saved-card" key={record.id} onClick={()=>navigate(()=>choose(record))}>
            <FolderOpen size={23} weight="light" aria-hidden="true" /><span><strong>{record.title}</strong>
              <span>{record.kind==='project'?'Project':w?.retired?'Old tool · read only':w?.custom?'Your own':w?.title}{n?` · ${plural(n,'file')}`:''} · {SCOPE_NAME[record.scope]||'Personal'}{record.output?' · Has an answer':''}{record.updated?` · ${new Date(record.updated).toLocaleDateString(undefined,{day:'numeric',month:'short'})}`:''}</span></span><ArrowRight size={18} aria-hidden="true" />
          </button>;})}</div>:<div className="work-empty"><FolderOpen size={35} weight="light" /><h4>{view==='projects'?(projects.length?'Nothing matches that.':'Your projects will live here.'):records.length?'Nothing matches that.':'Your saved work will live here.'}</h4>
            <p>{view==='projects'?'Keep related conversations and files together. Instructions are optional.':records.length?'Try a different word.':'Pick a workspace, add your files and save it. Next time, everything is ready.'}</p><button className="work-primary" onClick={()=>{if(view==='projects')create({id:CUSTOM_WORKSPACE,kind:'project'});else {setView('catalogue');setQuery('');}}}>{view==='projects'?'Create a project':'See workspaces'} <ArrowRight size={17} /></button></div>}
        </section>
      </> : <section className="work-task" aria-label={workspace?.title || 'Workspace'}>
        <button className="work-back" disabled={mutationBusy} onClick={panel==='setup'||workspace?.retired?leaveTask:()=>setPanel('setup')}><ArrowLeft size={17} />{panel==='setup'||workspace?.retired?(view==='projects'?'Projects':view==='saved'?'Saved':'All tasks'):'Back'}</button>
        {!workspace?.retired && !project && <nav className="work-stepper" aria-label="Workspace stages">
          <button disabled={mutationBusy} aria-current={panel === 'setup' ? 'step' : undefined} onClick={() => setPanel('setup')}>Files & notes</button>
          {check && <button disabled={mutationBusy || !canCheck} aria-current={panel === 'check' ? 'step' : undefined} onClick={() => setPanel('check')}>Run a check</button>}
          {check && <button disabled={!saved?.output || mutationBusy} aria-current={panel === 'result' ? 'step' : undefined} onClick={() => setPanel('result')}>Result</button>}
        </nav>}
        {workspace?.retired ? <section className="work-retired">
          <header className="work-detail-head"><p>Old tool</p><h3 ref={taskHeading} tabIndex={-1}>{draft.title}</h3></header>
          <p>This was made with a tool Vaelo doesn’t have any more. You can save a backup copy of it, or delete it.</p>
          <div className="work-inline-actions"><button disabled={mutationBusy} onClick={()=>exportRecords([saved||draft],draft.title)}><DownloadSimple size={17} />Save a backup copy</button>
            {!confirmDelete?<button disabled={mutationBusy||offline} onClick={()=>setConfirmDelete(true)}><Trash size={17} />Delete</button>
              :<><button disabled={mutationBusy||offline} onClick={()=>mutate('delete')}>Yes, delete it</button><button onClick={()=>setConfirmDelete(false)}>Keep it</button></>}</div>
        </section> : project ? <>
          <header className="work-detail-head"><p>Project</p><h3 ref={taskHeading} tabIndex={-1}>{draft.title || 'Create a project'}</h3><p>A place for an ongoing goal, with its conversations and files together.</p></header>
          <form className="work-setup work-project" onSubmit={event=>{event.preventDefault();mutate('save');}}>
            <div className="work-setup-main">
              <div className="work-field"><label htmlFor="project-name">Project name</label><input id="project-name" maxLength={160} required value={draft.title} placeholder="Like “Kitchen renovation”" disabled={mutationBusy} onChange={event=>edit({...draft,title:event.target.value})} /></div>
              <div className="work-field"><label htmlFor="project-instructions">Instructions (optional)</label><textarea id="project-instructions" rows={3} maxLength={WORK_LIMITS.brief} value={draft.brief || ''} placeholder="What should Vaelo keep in mind for this project?" disabled={mutationBusy} onChange={event=>edit({...draft,brief:event.target.value})} /></div>
              <div className="work-field"><label htmlFor="project-notes">Project context (optional)</label><textarea id="project-notes" rows={3} maxLength={WORK_LIMITS.notes} value={draft.notes || ''} disabled={mutationBusy} onChange={event=>edit({...draft,notes:event.target.value})} /></div>
              <DocumentSlot slot={{id:'extra',label:'Project files',hint:'Reference material shared by conversations in this project.'}} docs={draft.documents} disabled={mutationBusy} onFiles={addFiles} onPaste={addPasted} preview={preview} onPreview={togglePreview} onRemove={id=>edit({...draft,documents:draft.documents.filter(doc=>doc.id!==id)})} />
              {base && <details className="work-more"><summary>Manage project</summary><div className="work-inline-actions"><button type="button" disabled={mutationBusy} onClick={()=>exportRecords([saved],draft.title)}><DownloadSimple size={17} />Save a backup copy</button><button type="button" disabled={!canAct} onClick={()=>setConfirmDelete(true)}><Trash size={17} />Delete project</button></div>
                {confirmDelete && <div className="work-delete"><p>Delete this project and its shared files? Conversations will be kept outside the project. You can’t undo this.</p><button type="button" disabled={!canAct} onClick={()=>mutate('delete')}>Yes, delete it</button><button type="button" onClick={()=>setConfirmDelete(false)}>Keep it</button></div>}
              </details>}
            </div>
            <aside className="work-setup-aside"><section className="project-conversations" aria-label="Project conversations"><h4>Conversations <span>{projectChats.length}</span></h4>
              {projectChats.length ? <ul>{projectChats.map(chat=><li key={chat.id}><button type="button" onClick={()=>navigate(()=>onOpenChat?.(chat.id))}><ChatCircle size={17} /><span>{chat.title}</span><ArrowRight size={15} /></button></li>)}</ul> : <p className="work-help">Start a conversation here to keep it with this project.</p>}
              <button type="button" className="work-primary" disabled={!canAct} onClick={()=>mutate('start')}><Plus size={17} />New conversation</button>
              {base && onAddChat && otherChats.length > 0 && <div className="work-field project-add-chat"><label htmlFor="project-add-chat">Add an existing conversation</label><select id="project-add-chat" value={addChatId} onChange={event=>setAddChatId(event.target.value)}><option value="">Choose a conversation</option>{otherChats.map(chat=><option key={chat.id} value={chat.id}>{chat.title}{chat.workContext?' (moves from saved work)':''}</option>)}</select><button type="button" disabled={!addChatId || !canAct || dirty} onClick={()=>{onAddChat(addChatId,saved);setAddChatId('');}}>Add to project</button>{dirty && <p className="work-help">Save your changes before adding a conversation.</p>}</div>}
            </section></aside>
            <div className="work-action-bar"><button className="work-primary" type="submit" disabled={!canAct || (!dirty && !!base)}>{busy==='save'?'Saving…':base?'Save changes':'Create project'}</button><span className="work-save-state">{base && !dirty ? 'Saved' : 'Name your project; everything else is optional.'}</span></div>
          </form>
        </> : panel==='setup' ? <>
          <header className="work-detail-head">
            <p>{custom?'Your own workspace':AUDIENCE_NAMES[workspace?.audience]}</p>
            <h3 ref={taskHeading} tabIndex={-1}>{custom ? draft.title || 'Make your own' : workspace?.title}</h3>
            {!custom&&<p>{workspace?.summary}</p>}
          </header>
          <form className="work-setup" onSubmit={e=>{e.preventDefault();mutate('start');}}>
            <div className="work-setup-main">
              {custom&&<>
                <div className="work-field"><label htmlFor="work-title">What’s it called?</label><input id="work-title" maxLength={160} value={draft.title} placeholder="Like “Weekly report” or “Spanish homework”" onChange={e=>edit({...draft,title:e.target.value})} disabled={mutationBusy} /></div>
                <div className="work-field"><label htmlFor="work-brief">What should Vaelo do?</label>
                  <textarea id="work-brief" rows={6} maxLength={WORK_LIMITS.brief} value={draft.brief||''} placeholder="Like: “Check my Spanish homework. Point out mistakes, explain why, and let me fix them myself.”" onChange={e=>edit({...draft,brief:e.target.value})} disabled={mutationBusy} />
                  <p className="work-help">Vaelo does this every time you start a chat from here.</p></div>
              </>}
              <section className="work-docs" aria-labelledby="work-docs-title">
                <h4 id="work-docs-title">Files for this task</h4>
                <p className="work-help">Add a document or paste text. You can save this task to reuse the same files later.</p>
                {(workspace?.slots||[]).filter(slot=>slot.required).map(renderSlot)}
                {(workspace?.slots||[]).some(slot=>!slot.required)&&<details className="work-optional-files" open={draft.documents.some(doc=>(workspace?.slots||[]).some(slot=>!slot.required&&slot.id===doc.slot))||undefined}><summary>Additional files <span>Optional</span></summary>{(workspace?.slots||[]).filter(slot=>!slot.required).map(renderSlot)}</details>}
                {custom&&<DocumentSlot slot={extraSlot} docs={draft.documents} disabled={mutationBusy} onFiles={addFiles} onPaste={addPasted} preview={preview} onPreview={togglePreview}
                  onRemove={id=>{edit({...draft,documents:draft.documents.filter(d=>d.id!==id)});if(preview?.id===id)setPreview(null);}} />}
              </section>
                <div className="work-field"><label htmlFor="work-notes">Additional context (optional)</label>
                  <textarea id="work-notes" rows={2} maxLength={WORK_LIMITS.notes} value={draft.notes||''} placeholder="Like: “It’s due on Friday” or “Keep it short.”" onChange={e=>edit({...draft,notes:e.target.value})} disabled={mutationBusy} /></div>
              <details className="work-more" open={draft.documents.some(d=>d.slot==='extra'&&!custom) || undefined}>
                <summary>Task settings</summary>
                {!custom&&<DocumentSlot slot={extraSlot} docs={draft.documents.filter(d=>d.slot==='extra'||!(workspace?.slots||[]).some(s=>s.id===d.slot))} disabled={mutationBusy}
                  onFiles={addFiles} onPaste={addPasted} preview={preview} onPreview={togglePreview}
                  onRemove={id=>{edit({...draft,documents:draft.documents.filter(d=>d.id!==id)});if(preview?.id===id)setPreview(null);}} />}
                {custom&&<fieldset className="work-fields"><legend>Questions you ask a lot</legend>
                  <p className="work-help">They turn into buttons, so you can ask with one tap.</p>
                  {(draft.starters||[]).map((item,i)=><div className="work-starter-edit" key={i}><input aria-label={`Question ${i+1}`} maxLength={WORK_LIMITS.starterChars} value={item} placeholder="Like “Check this week’s homework”" onChange={e=>edit({...draft,starters:draft.starters.map((s,j)=>j===i?e.target.value:s)})} />
                    <button type="button" className="icon-button" aria-label={`Remove question ${i+1}`} onClick={()=>edit({...draft,starters:draft.starters.filter((_,j)=>j!==i)})}><Trash size={18} weight="light" /></button></div>)}
                  {(draft.starters||[]).length<WORK_LIMITS.starters&&<button type="button" className="work-text-button" onClick={()=>edit({...draft,starters:[...(draft.starters||[]),'']})}><Plus size={17} />Add a question</button>}
                </fieldset>}
                {custom&&<div className="work-field"><label htmlFor="work-check">Add a structured check (optional)</label><select id="work-check" value={draft.check?.id||''} onChange={e=>{const c=getCheck(e.target.value);edit({...draft,check:c?{id:c.id,input:answersFor(c)}:null});}}>
                  <option value="">Nothing extra</option>{CHECKS.filter(c=>!c.needsSource).map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></div>}
                {!custom&&<div className="work-field"><label htmlFor="work-title">Name</label><input id="work-title" maxLength={160} value={draft.title} onChange={e=>edit({...draft,title:e.target.value})} disabled={mutationBusy} /></div>}
                <div className="work-field"><label htmlFor="work-scope">Organize under</label><select id="work-scope" value={draft.scope} onChange={e=>edit({...draft,scope:e.target.value})} disabled={mutationBusy}>{SCOPES.map(([value,name])=><option key={value} value={value}>{name}</option>)}</select>
                  <p className="work-help">Only you see this. Vaelo uses it only in chats you start from here.</p></div>
                {!custom&&<div className="work-brief"><h5>Task instructions</h5><p>{workspace.brief}</p></div>}
                {base&&<div className="work-manage"><div className="work-inline-actions"><button type="button" disabled={mutationBusy} onClick={()=>exportRecords([saved||draft],draft.title)}><DownloadSimple size={17} />Save a backup copy</button>
                  {!confirmDelete&&<button type="button" disabled={mutationBusy||offline||conflict} onClick={()=>setConfirmDelete(true)}><Trash size={17} />Delete</button>}</div>
                  {confirmDelete&&<div className="work-delete"><p>Delete this, with its files and answers? You can’t undo this.</p><button type="button" disabled={mutationBusy||offline} onClick={()=>mutate('delete')}>Yes, delete it</button><button type="button" onClick={()=>setConfirmDelete(false)}>Keep it</button></div>}</div>}
              </details>
            </div>
            <aside className="work-setup-aside">
              {starters.length>0&&<section className="work-starters" aria-labelledby="work-starters-title"><h4 id="work-starters-title">Start with a question</h4>
                <div className="work-chips">{starters.map(item=><button type="button" key={item} disabled={!canAct} onClick={()=>mutate('start',{prompt:item})}>{item}</button>)}</div></section>}
              {check&&<section className="work-check-card" aria-labelledby="work-check-title"><Calculator size={22} weight="light" aria-hidden="true" />
                <div><h4 id="work-check-title">{check.title}</h4><p>{check.description}</p>
                  {canCheck ? <div className="work-inline-actions">
                    <button type="button" onClick={()=>setPanel(saved?.output&&!dirty?'result':'check')}>{saved?.output?'View result':'Enter details'}</button>
                    {check.needsSource?null:<button type="button" className="work-text-button" disabled={!canAct} onClick={()=>mutate('start',{prompt:fillPrompt})}>Draft from my files</button>}
                  </div> : <p className="work-help">To check a document, open it in a chat and tap Verify.</p>}</div>
              </section>}
              {plan&&draft.documents.length>0&&<p className="work-context" data-trimmed={plan.trimmed||undefined}>{plan.trimmed
                ? 'Some files are very long, so Vaelo reads the start and end of them. If you need a part from the middle, paste it into the chat.'
                : 'Vaelo reads all of your files every time you ask something.'}</p>}
            </aside>
            <div className="work-action-bar">
              <button className="work-primary" type="submit" disabled={!canAct}><ChatCircle size={18} />{busy==='start'?'Opening your conversation…':'Chat about this'}</button>
              <span className="work-save-state">{dirty||!base?<button type="button" className="work-text-button" disabled={!canAct} onClick={()=>mutate('save')}>Save task</button>:'Saved'}</span>
            </div>
          </form>
        </> : panel==='check' && check ? <form className="work-check" onSubmit={e=>{e.preventDefault();mutate('run');}}>
          <header className="work-detail-head"><p>{workspace?.title}</p><h3 ref={taskHeading} tabIndex={-1}>{check.title}</h3><p>{check.description}</p></header>
          <fieldset disabled={mutationBusy} className="work-editor">
            {check.fields.map(item=><CheckField key={item.id} field={item} value={answers[item.id]||''} onChange={value=>setAnswer(item.id,value)} />)}
          </fieldset>
          <div className="work-action-bar"><button className="work-primary" type="submit" disabled={!canAct}><Calculator size={18} />{busy==='run'?'Checking…':'Run check'}</button>
            {!check.needsSource&&<button type="button" className="work-text-button" disabled={!canAct} onClick={()=>mutate('start',{prompt:fillPrompt})}>Draft these answers in a chat</button>}</div>
        </form> : panel==='result' && saved?.output ? <section className="work-output" aria-label="The answer">
          <p className="work-result-kicker">{check?.title}</p>
          <h3 ref={resultHeading} tabIndex={-1}>{overview.title}</h3>
          {dirty&&<p className="work-help">This answer is from before your latest changes. Tap “Work it out again” to update it.</p>}
          {overview.facts.length>0&&<ul className="work-findings">{overview.facts.map((fact,i)=><li key={i}>{fact}</li>)}</ul>}
          <details className="work-result-details"><summary>What this can and can’t tell you</summary><ul>{(saved.output.limitations||[]).map((item,i)=><li key={i}>{item}</li>)}</ul></details>
          <div className="work-action-bar"><button className="work-primary" disabled={!canAct} onClick={()=>mutate('start',{prompt:`Help me with this: ${overview.title}.`})}><ChatCircle size={18} />Talk it through</button>
            <button disabled={mutationBusy} onClick={()=>setPanel('check')}>Change my answers</button><button disabled={!canAct} onClick={()=>mutate('run')}>Work it out again</button></div>
        </section> : null}
      </section>}
    </div>
  </dialog>;
}
