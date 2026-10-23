import React, { useId, useRef, useState } from 'react';
import { FileText, ArrowRight, ArrowClockwise } from '@phosphor-icons/react';
import { fileFormat, measuredUsage } from '../lib/everyday-ui.js';
import { Mark } from './Mark.jsx';
import './everyday-ui.css';

export function FileBadge({ name, kind }) {
  return <span className="file-badge" data-format={fileFormat(name, kind)} aria-hidden="true"><FileText size={23} weight="light" /><small>{fileFormat(name, kind)}</small></span>;
}
export function EngravedCard() {
  const [flipped, setFlipped] = useState(false);
  return <button type="button" className="engraved-card" aria-label={flipped ? 'Show Vaelo mark' : 'About Vaelo'} aria-pressed={flipped} onClick={() => setFlipped(value => !value)} onPointerMove={event => {
    if (event.pointerType !== 'mouse' || matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce') return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--engraving-light', `${(event.clientX - rect.left) / rect.width * 100}%`);
  }}>
    {flipped ? <span className="engraved-copy"><strong>A place to think clearly.</strong><span>Ask a question, bring your files, or work through a plan.</span><small>Tap to turn back</small></span> : <><svg viewBox="0 0 180 120" aria-hidden="true">{Array.from({length:9},(_,i)=><ellipse key={i} cx="90" cy="60" rx={24+i*6} ry={14+i*4} transform={`rotate(${i*20} 90 60)`} />)}</svg><Mark size={54} /><small>Meet Vaelo</small></>}
  </button>;
}
export function EmptyState({ title, children, action, onAction, error = false }) {
  return <div className="everyday-empty" data-error={error || undefined} role={error ? 'alert' : undefined}>
    <span className="empty-engraving" aria-hidden="true"><Mark size={32} /></span>
    <div><h3>{title}</h3><p>{children}</p>{action && onAction && <button type="button" className="text-button" onClick={onAction}>{action}{error ? <ArrowClockwise size={16} /> : <ArrowRight size={16} />}</button>}</div>
  </div>;
}
export function SkeletonCards({ label = 'Loading saved work' }) {
  return <div className="everyday-skeleton" role="status" aria-busy="true"><span className="sr-only">{label}</span>{[0, 1, 2].map(i => <div key={i} aria-hidden="true"><i /><i /><i /></div>)}</div>;
}
export function Segmented({ label, value, options, onChange, disabled = false }) {
  const ref = useRef(null);
  return <div className="everyday-segment" ref={ref} role="radiogroup" aria-label={label} onKeyDown={event => {
    if (disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const at = Math.max(0, options.findIndex(([id]) => id === value));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
    onChange(options[next][0]); ref.current?.querySelectorAll('button')[next]?.focus();
  }}>{options.map(([id, text], index) => <button key={id} type="button" role="radio" aria-checked={value === id} disabled={disabled} tabIndex={id === value || !options.some(([key]) => key === value) && index === 0 ? 0 : -1} onClick={() => onChange(id)}>{text}</button>)}</div>;
}
export function UsageMeter({ usage }) {
  const values = measuredUsage(usage);
  if (!values) return null;
  return <div className="everyday-meter" aria-label="Reported token usage">
    <div><span>Reported tokens</span><strong>{values.total.toLocaleString()}</strong></div>
    <div className="meter-track" aria-hidden="true"><i style={{ width: `${values.input / values.total * 100}%` }} /><i /></div>
    <p>{values.input.toLocaleString()} input · {values.output.toLocaleString()} output</p>
  </div>;
}
export function ContextMeter({ context }) {
  if (!context) return null;
  const kept = Math.max(0, Number(context.turns) || 0), dropped = Math.max(0, Number(context.dropped) || 0);
  if (!kept && !dropped && !context.files?.length) return null;
  return <div className="context-meter"><span>{kept} earlier messages{context.files?.length ? ` · ${context.files.length} files` : ''}</span>{dropped > 0 && <><progress max={kept + dropped} value={kept} aria-label="Earlier messages retained" /><span>{dropped} left out</span></>}</div>;
}
export function VoiceOrb({ active, heard, time }) {
  return <span className="voice-orb" data-active={active || undefined} data-heard={heard || undefined} aria-hidden="true"><i /><i /><i /><span>{time}</span></span>;
}
export function PasteCard({ file, onUpdate, onRemove, limit }) {
  const [editing, setEditing] = useState(false), [value, setValue] = useState(file.body || '');
  return <details className="paste-card"><summary><FileBadge name={file.name} /><span>{file.name}<small>{file.chars.toLocaleString()} characters · pasted text</small></span></summary>
    {editing ? <><textarea aria-label={`Edit ${file.name}`} value={value} maxLength={limit} onChange={event => setValue(event.target.value)} /><small>{value.length.toLocaleString()} characters</small></> : <pre className="block-plain" tabIndex={0}>{file.body}</pre>}
    <div className="paste-card-actions">{editing ? <><button type="button" className="block-tool" disabled={!value.trim()} onClick={() => { onUpdate(file.id, value); setEditing(false); }}>Save text</button><button type="button" className="block-tool" onClick={() => setEditing(false)}>Cancel</button></> : <button type="button" className="block-tool" onClick={() => { setValue(file.body); setEditing(true); }}>Edit text</button>}<button type="button" className="block-tool" onClick={() => onRemove(file.id)}>Remove</button></div>
  </details>;
}
export function QuestionCard({ data, onAnswer, disabled = false, framed = false }) {
  const id = useId(), [selected, setSelected] = useState('');
  return <section className="question-card" aria-labelledby={framed ? undefined : id} aria-label={framed ? data.title || 'Choose a direction' : undefined}>{!framed && <h3 id={id}>{data.title || 'Choose a direction'}</h3>}
    <div role="group" aria-label="Suggested answers">{data.options.map(option => <button type="button" key={option} disabled={disabled || !onAnswer} aria-pressed={selected === option} onClick={() => { setSelected(option); onAnswer?.(option); }}>{option}<ArrowRight size={16} /></button>)}</div>
    <p>{onAnswer ? 'Choose an answer to add it to your message, or write your own.' : 'Use these choices when writing your answer.'}</p>
  </section>;
}
export function AudioCard({ src, title = 'Audio' }) {
  const [failed, setFailed] = useState(false);
  return <figure className="audio-card"><figcaption>{title}</figcaption><audio controls preload="none" src={src} onError={() => setFailed(true)} aria-label={title} />{failed && <p role="status">This audio could not play here. Try opening the original.</p>}<a href={src} target="_blank" rel="noopener noreferrer">Open original audio</a></figure>;
}
export function VersionTree({ versions, current, onSelect, disabled }) {
  if (!versions || versions.length < 2) return null;
  return <details className="version-tree"><summary>{versions.length} reply versions</summary><ol aria-label="Reply version history">{versions.map((version, i) => <li key={i}><button type="button" aria-current={i === current || undefined} disabled={disabled} onClick={() => onSelect(i)}><span className="version-node" aria-hidden="true" /><span>Version {i + 1}<small>{String(version.content || version.text || '').replace(/[#*`\n]/g, ' ').slice(0, 100) || 'Earlier reply'}</small></span></button></li>)}</ol></details>;
}
export function CapabilityBento({ onPick }) {
  const examples = [
    ['Research with sources', 'Follow an answer back to the material behind it.', 'Help me research a topic. First ask what I want to understand, then find reliable sources and explain what matters.'],
    ['Understand your numbers', 'Compare, chart and explore data you provide.', 'Help me understand a dataset. Ask me to paste or attach it, then show the patterns that matter.'],
    ['Make a plan', 'Turn a goal into steps you can follow.', 'Help me plan a project. Ask about my goal, time and constraints, then build a practical timeline.'],
  ];
  return <div className="capability-bento" aria-label="Ways Vaelo can help">{examples.map(([title, note, prompt], i) => <button type="button" key={title} onClick={() => onPick(prompt, { research: i === 0 })}>
    {i === 0 ? <span className="capability-diagram" aria-hidden="true"><span>Sources</span><ArrowRight size={16} /><span>Answer</span><ArrowRight size={16} /><span>You</span></span> : i === 1 ? <span className="capability-chart" aria-hidden="true">{[35, 52, 40, 72, 90].map((height, j) => <i key={j} style={{ '--bar-height': `${height}%` }} />)}</span> : <span className="capability-diagram" aria-hidden="true"><span>Goal</span><ArrowRight size={16} /><span>Steps</span></span>}
    <strong>{title}</strong><small>{note}</small></button>)}</div>;
}
