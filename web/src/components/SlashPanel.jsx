import React, { useEffect, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { SLASH_COMMANDS, contextSnapshot } from '../lib/slash-commands.js';
import { CONTEXT_POLICY } from '../../shared/context-policy.js';
import { parseReminder, reminderCalendar } from '../lib/reminders.js';
import { UsageMeter } from './EverydayUI.jsx';
import { ROLES, STYLES } from './Composer.jsx';
import { download } from './blocks/Blocks.jsx';

const titles = { help: 'Commands', usage: 'Your cloud usage', context: 'Conversation context', status: 'Vaelo status', search: 'Find a conversation',
  rename: 'Rename conversation', theme: 'Appearance', presentation: 'Reply presentation', profile: 'About you', files: 'Pending attachments',
  branch: 'Branch conversation', export: 'Export conversation', copy: 'Copy conversation', plan: 'Current plan', memory: 'Account memory',
  remember: 'Remember a note', forget: 'Forget a note', remind: 'Create a reminder', schedule: 'Your reminders', connect: 'Account connections',
  model: 'Model routing', tools: 'Response tools', shortcuts: 'Personal shortcuts', archive: 'Archived conversations' };
const MEMORY = '/api/chats?resource=memory', COMMANDS = '/api/chats?resource=commands';
const n = value => Number(value || 0).toLocaleString();
export function SlashPanel({ panel, onClose, request, session, chat, chats, attachments, onRemoveFile, prefs, onPrefs,
  options, onOptions, cloud, online, onRun, onSelect, onBranch, onArchive, onDraft }) {
  const ref = useRef(null);
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [quickReminder] = useState(() => parseReminder(panel.args));
  const [query, setQuery] = useState(panel.args || ''), [text, setText] = useState(panel.name === 'remember' ? panel.args : panel.name === 'remind' ? quickReminder?.text || '' : ''), [name, setName] = useState('');
  const [range, setRange] = useState(['today', 'month', 'all'].includes(panel.args) ? panel.args : 'month');
  const [date, setDate] = useState(() => quickReminder ? new Date(quickReminder.at - new Date(quickReminder.at).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''), [repeat, setRepeat] = useState('once');
  const life = useRef(true), locked = useRef(false);
  const account = ['usage', 'memory', 'remember', 'forget', 'remind', 'schedule', 'connect', 'shortcuts'].includes(panel.name);
  const signedIn = Boolean(session?.user && !session.user.guest);
  const path = ['memory', 'remember', 'forget'].includes(panel.name) ? MEMORY : ['remind', 'schedule', 'shortcuts'].includes(panel.name) ? COMMANDS + (panel.name === 'shortcuts' ? '&view=shortcuts' : '&view=reminders')
    : panel.name === 'connect' ? '/api/session?resource=devices' : panel.name === 'usage' ? `/api/session?resource=usage&account=me&range=${range}` : null;
  useEffect(() => {
    life.current = true; const el = ref.current; el.showModal();
    return () => { life.current = false; el.close(); };
  }, []);
  useEffect(() => {
    if (!path || !signedIn) return;
    let current = true; setLoading(true); setData(null); setError('');
    request(path).then(value => { if (current) setData(value); }).catch(e => { if (current) setError(e.message || 'Could not load this panel.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [path, session?.user?.sub]);
  async function mutate(body, endpoint = path) {
    if (locked.current) return false;
    locked.current = true; setSaving(true); setError('');
    try { const result = await request(endpoint, body); if (!life.current) return false;
      setData(endpoint === '/api/session?resource=devices' ? await request(endpoint) : result); return true;
    } catch (e) { if (life.current) setError(e.message || 'Could not save. Try again.'); return false; }
    finally { locked.current = false; if (life.current) setSaving(false); }
  }
  const snap = contextSnapshot(chat, attachments, CONTEXT_POLICY);
  const chatTokens = (chat?.messages || []).reduce((sum, message) => sum + (Number(message.usage?.prompt_tokens || 0) + Number(message.usage?.completion_tokens || 0)), 0);
  const nextMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));
  const context = <section className="slash-context"><div className="slash-context-title"><span className="slash-ring" style={{ '--context-fill': `${snap.percent * 3.6}deg` }} aria-hidden="true"><span>~{snap.percent.toFixed(0)}%</span></span>
    <div><strong>Estimated context usage</strong><p>~{n(snap.tokens)} / {n(snap.limit)} tokens</p></div></div>
    <p className="slash-hint">{snap.source === 'provider' ? 'Based on the latest provider-reported input and output, plus newer text. Tool-round accounting can overstate current context; pending images and workspace changes may add more.' : 'Approximate text estimate with a 2,048-token system-prompt allowance. Hidden prompts, images and workspace content can change actual usage.'} Uses Vaelo’s base context budget; some routes support a larger window.</p>
    <p className="slash-hint">{snap.messages} messages · {snap.files} pending files{snap.omitted > 0 ? ` · ${snap.omitted} messages summarized` : ''}. Cumulative token consumption is separate.</p></section>;
  const dispatch = (command, args = '') => { onClose(); onRun({ name: command, args, command: SLASH_COMMANDS.find(item => item.name === command) }); };
  let body;
  if (panel.name === 'usage') body = <><label>Period (UTC)<select value={range} onChange={e => setRange(e.target.value)}><option value="today">Today</option><option value="month">This month</option><option value="all">All recorded time</option></select></label>
    {data && <><UsageMeter usage={{ prompt_tokens: data.input, completion_tokens: data.output, total_tokens: data.total }} />{context}
      <dl className="slash-stats"><div><dt>Cloud tokens consumed</dt><dd>{n(data.total)}</dd></div><div><dt>Cached input (included above)</dt><dd>{n(data.cached)}</dd></div><div><dt>Requests / attempts</dt><dd>{n(data.attempts)}</dd></div><div><dt>Incomplete token reports</dt><dd>{n(data.unreported)}</dd></div></dl>
      <p>{n(data.input)} input · {n(data.output)} output · {n(chatTokens)} reported tokens in this chat</p>
      {range === 'month' && <p className="slash-hint">Next monthly reporting period: {nextMonth.toLocaleString()} ({Math.ceil((nextMonth - Date.now()) / 86400000)} days). All-time totals are retained.</p>}
      <p className="slash-hint">Only this signed-in account’s cloud usage, across devices. Local FreeLLMAPI usage is excluded. {data.since ? `Account tracking began ${new Date(data.since).toLocaleString()}.` : 'No attributed usage recorded yet.'} Earlier unattributed service totals cannot be assigned to your account.</p>
      {data.unreported > 0 && <p className="slash-error">Recorded totals are a lower bound because some attempts did not report tokens.</p>}
      <p className="slash-hint">Checked {new Date(data.checkedAt).toLocaleString()}. These counters do not represent provider credits or remaining quota.</p></>}{!data && context}</>;
  else if (panel.name === 'context') body = <>{context}<div className="slash-stack">{attachments.map(file => <p key={file.id}>{file.name} · {n(file.chars)} characters</p>)}
    {chat?.workContext && <p>Workspace: {chat.workContext.title}</p>}<p className="slash-hint">Last request left out {chat?.messages.findLast(m => m.context)?.context?.dropped || 0} earlier messages to fit the request limits.</p></div>
    <button onClick={() => dispatch('compact')}>Summarize earlier context with /compact</button></>;
  else if (panel.name === 'help') body = <><input autoFocus aria-label="Find a command" placeholder="Find a command…" value={query} onChange={e => setQuery(e.target.value)} />
    <p className="slash-hint">Type / in the message box. Use ↑ ↓ to choose, Tab or Enter to select, and Escape to dismiss. Commands with arguments stay in the composer for review. AI commands send a request when submitted.</p>
    {SLASH_COMMANDS.filter(item => `${item.name} ${item.description}`.includes(query.toLowerCase().replace(/^\//, ''))).map(item => <button key={item.name} disabled={item.account && !signedIn} onClick={() => {
      if (item.args) { onDraft(`/${item.name} `); onClose(); } else dispatch(item.name);
    }}><strong>/{item.name}</strong> {item.args}<small className="slash-hint"> · {item.ai ? 'AI request' : 'App action'}{item.account ? ' · signed-in account' : ''}</small><br />{item.description}</button>)}</>;
  else if (panel.name === 'search' || panel.name === 'archive') {
    const matches = chats.filter(item => (panel.name !== 'archive' || item.archived) && `${item.title} ${item.messages.map(m => typeof m.content === 'string' ? m.content : '').join(' ')}`.toLowerCase().includes(query.toLowerCase()));
    body = <><input autoFocus aria-label="Search conversations" placeholder="Search titles and messages…" value={query} onChange={e => setQuery(e.target.value)} />
      {matches.map(item => <div className="slash-row" key={item.id}><button onClick={() => { onSelect(item.id); onClose(); }}>{item.title}{item.archived ? ' · archived' : ''}</button>{item.archived && <button onClick={() => onArchive(item.id, false)}>Restore</button>}</div>)}
      {!matches.length && <p>No matching conversations.</p>}<p className="slash-hint">Searches conversations available on this device, including archived chats.</p></>;
  } else if (panel.name === 'rename') body = <form onSubmit={e => { e.preventDefault(); if (text.trim()) dispatch('rename', text.trim()); }}><label>Conversation title<input autoFocus maxLength={100} placeholder={chat?.title} value={text} onChange={e => setText(e.target.value)} /></label><button className="slash-primary" disabled={!text.trim()}>Save title</button></form>;
  else if (panel.name === 'theme' || panel.name === 'presentation') {
    const key = panel.name; const values = key === 'theme' ? ['light', 'dark', 'system'] : ['adaptive', 'minimal'];
    body = <div className="slash-stack">{values.map(value => <button key={value} aria-pressed={prefs[key] === value} onClick={() => onPrefs({ [key]: value })}>{value}{prefs[key] === value ? ' · selected' : ''}</button>)}</div>;
  } else if (panel.name === 'profile') body = <><label>What should Vaelo call you?<input maxLength={40} value={prefs.callMe} onChange={e => onPrefs({ callMe: e.target.value })} /></label><label>What should Vaelo know about you?<textarea maxLength={600} value={prefs.about} onChange={e => onPrefs({ about: e.target.value })} /></label><p className="slash-hint">Saved on this device and included with your messages.</p></>;
  else if (panel.name === 'files') body = <>{attachments.map(file => <div className="slash-row" key={file.id}><span>{file.name}<small>{file.state} · {n(file.chars)} characters</small></span><button onClick={() => onRemoveFile(file.id)}>Remove</button></div>)}{!attachments.length && <p>No pending attachments. Use /attach to choose files.</p>}</>;
  else if (panel.name === 'branch') body = <><p>Choose the last message to include in the new conversation.</p>{chat?.messages.map((message, i) => <button key={message.id} disabled={message.running} onClick={() => { onBranch(message.id); onClose(); }}><strong>{i + 1}. {message.role === 'user' ? 'You' : 'Vaelo'}</strong><br />{String(message.text || message.content || 'Empty message').slice(0, 180)}</button>)}{!chat?.messages.length && <p>Send a message before branching.</p>}</>;
  else if (panel.name === 'export' || panel.name === 'copy') body = <div className="slash-actions">{(panel.name === 'export' ? ['md', 'json', 'txt'] : ['last', 'chat']).map(value => <button key={value} onClick={() => dispatch(panel.name, value)}>{value}</button>)}</div>;
  else if (panel.name === 'plan') {
    const plan = chat?.messages.findLast(message => message.plan?.items?.length)?.plan;
    body = plan ? <div>{plan.items.map(item => <p className="slash-row" key={item.id}><span>{item.content}</span><small>{item.status.replaceAll('_', ' ')}</small></p>)}</div> : <p>No task plan in this conversation yet. Vaelo creates one when a task needs multiple steps.</p>;
  } else if (['memory', 'remember', 'forget'].includes(panel.name)) body = <>{panel.name !== 'forget' && <form onSubmit={async e => { e.preventDefault(); if (await mutate({ action: 'add', text })) setText(''); }}><label>Save an account note<textarea autoFocus={panel.name === 'remember'} maxLength={600} value={text} onChange={e => setText(e.target.value)} placeholder="A lasting preference or fact you want Vaelo to remember" /></label><button disabled={saving || !data || !text.trim()}>Save note</button></form>}
    {panel.name === 'forget' && <input autoFocus aria-label="Find a note to forget" placeholder="Find a note…" value={query} onChange={e => setQuery(e.target.value)} />}
    {data && <><label>Account memory<select value={data.enabled ? 'on' : 'off'} disabled={saving} onChange={e => mutate({ action: 'enable', enabled: e.target.value === 'on' })}><option value="on">On</option><option value="off">Off</option></select></label>
      {data.items.filter(item => panel.name !== 'forget' || item.text.toLowerCase().includes(query.toLowerCase())).map(item => <div className="slash-row" key={item.id}><span>{item.text}</span><button disabled={saving} onClick={() => mutate({ action: 'remove', id: item.id })}>Forget</button></div>)}
      {!data.items.length && <p>No saved notes.</p>}</>}</>;
  else if (panel.name === 'shortcuts') body = <><form onSubmit={async e => { e.preventDefault(); if (await mutate({ action: 'shortcut-save', name, prompt: text })) { setName(''); setText(''); } }}><label>Shortcut name<input value={name} onChange={e => setName(e.target.value)} maxLength={32} placeholder="weekly-review" pattern="[a-z][a-z0-9-]{0,31}" required /></label><label>Prompt<textarea value={text} onChange={e => setText(e.target.value)} maxLength={8000} required /></label><button disabled={saving || !data}>Save shortcut</button></form>
    <p className="slash-hint">Run with /shortcuts name. Selecting a saved prompt places it in the composer for review.</p>{data?.shortcuts.map(item => <div className="slash-row" key={item.name}><button onClick={() => { onDraft(item.prompt); onClose(); }}>{item.name}</button><button disabled={saving} onClick={() => mutate({ action: 'shortcut-remove', name: item.name })}>Delete</button></div>)}</>;
  else if (panel.name === 'remind' || panel.name === 'schedule') body = <><p className="slash-hint">Reminders sync to your account. Vaelo checks for due reminders while a signed-in app is open and delivers overdue reminders when reopened. For alerts while Vaelo is closed, export to your calendar. These are reminders, not background AI jobs. Daily and weekly repeats use fixed 24-hour / 7-day intervals.</p>
    <form onSubmit={async e => { e.preventDefault(); const reminder = { text, at: new Date(date).getTime(), repeat };
      if (await mutate({ action: 'reminder-add', ...reminder })) { setText(''); setDate(''); } }}>
      <label>Remind me to<input value={text} maxLength={500} onChange={e => setText(e.target.value)} placeholder="Review the proposal" required /></label>
      <label>When (your local time)<input type="datetime-local" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label>Repeat<select value={repeat} onChange={e => setRepeat(e.target.value)}><option value="once">Once</option><option value="daily">Every 24 hours</option><option value="weekly">Every 7 days</option></select></label>
      <button disabled={saving || !data || !text.trim() || !date}>Create reminder</button></form>
      {data?.reminders.map(item => <div className="slash-row" key={item.id}><span>{item.text}<small>{new Date(item.at).toLocaleString()} · {item.done ? 'delivered' : item.repeat}</small></span><div className="slash-actions"><button onClick={() => download('vaelo-reminder.ics', reminderCalendar(item), 'text/calendar')}>Calendar</button><button disabled={saving} onClick={() => mutate({ action: 'reminder-remove', id: item.id })}>Delete</button></div></div>)}</>;
  else if (panel.name === 'connect') body = <><p>Signed in as {session?.user?.name} ({session?.user?.email}).</p><p className="slash-hint">Google is used for sign-in. Vaelo does not currently expose third-party app connectors. The devices below have access to your Vaelo account.</p>
    {data?.devices.map(device => <div className="slash-row" key={device.id}><span>{device.label}<small>{device.current ? 'This device' : `Last seen ${new Date(device.seen).toLocaleString()}`}</small></span>{!device.current && <button disabled={saving} onClick={() => mutate({ action: 'revoke', id: device.id })}>Sign out device</button>}</div>)}{data && !data.available && <p>Device management is not configured on this server.</p>}</>;
  else if (panel.name === 'tools') body = <><label>Research with sources<select disabled={!signedIn} value={options.research ? 'on' : 'off'} onChange={e => onOptions({ research: e.target.value === 'on' })}><option value="off">Off</option><option value="on">On</option></select></label><label>Response style<select value={options.style} onChange={e => onOptions({ style: e.target.value })}>{STYLES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Role<select value={options.role} onChange={e => onOptions({ role: e.target.value })}><option value="none">Just Vaelo</option>{ROLES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></>;
  else if (panel.name === 'model') body = <><p><strong>Automatic routing</strong></p><p>Vaelo selects a provider and model for each request, with fallback when needed. Manual provider selection is not exposed by the cloud API.</p><p className="slash-hint">Use /tools to control research, response style and role. Use /usage to inspect recorded token consumption.</p></>;
  else body = <dl className="slash-stats"><div><dt>Connection</dt><dd>{online ? cloud : 'Offline'}</dd></div><div><dt>Session</dt><dd>{signedIn ? 'Signed in' : 'Guest'}</dd></div><div><dt>Mode</dt><dd>{options.research ? 'Research' : options.style}</dd></div><div><dt>Conversation</dt><dd>{chat?.temporary ? 'Temporary' : 'Saved'}</dd></div></dl>;
  return <dialog className="slash-dialog" ref={ref} aria-labelledby="slash-panel-title" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === ref.current) { const rect = ref.current.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose(); } }}>
    <div className="slash-dialog-head"><h2 id="slash-panel-title">{titles[panel.name] || panel.name}</h2><button type="button" className="icon-button" aria-label="Close command panel" onClick={onClose}><X size={20} /></button></div>
    <div className="slash-dialog-body">{account && !signedIn ? <p>Sign in to use account-specific {panel.name}.</p> : body}
      {loading && <p role="status">Loading…</p>}{error && <div role="alert"><p className="slash-error">{error}</p><button onClick={() => { setError(''); setLoading(true); request(path).then(setData).catch(e => setError(e.message)).finally(() => setLoading(false)); }}>Try again</button></div>}</div>
  </dialog>;
}
