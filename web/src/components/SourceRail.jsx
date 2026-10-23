import React, { useEffect, useRef, useState } from 'react';
import { ArrowSquareOut, Check, Copy } from '@phosphor-icons/react';
import { kindLabel } from '../lib/sources.js';
import { copyText } from '../lib/desktop.js';
import './everyday-ui.css';

function SourceEntry({ source, active }) {
  const [copied, setCopied] = useState(false), [problem, setProblem] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <li data-focus={active || undefined} data-id={source.id}>
    <span className="ws-source-index">{source.index}</span><div>
      <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title || source.domain} <ArrowSquareOut size={14} /></a>
      <span className="source-rail-meta">{source.domain} · {kindLabel(source.kind)}</span>
      {source.context && <details open={active || undefined}><summary>Passage from this answer</summary><blockquote>{source.context}</blockquote></details>}
      <button type="button" className="block-tool" onClick={async () => {
        try { await copyText(source.url); setCopied(true); setProblem(''); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1600); }
        catch { setProblem('Copy was unavailable. Open the source to copy its address.'); }
      }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy link'}</button>
      {problem && <p role="status">{problem}</p>}
    </div>
  </li>;
}
export function SourceRail({ sources, focus }) {
  const list = useRef(null);
  useEffect(() => {
    if (!focus) return;
    const entry = [...(list.current?.children || [])].find(node => node.dataset.id === focus);
    entry?.scrollIntoView({ block: 'nearest' }); entry?.querySelector('a')?.focus({ preventScroll: true });
  }, [focus, sources]);
  return <ol className="source-rail" ref={list} aria-label="Sources behind this answer">{sources.map(source => <SourceEntry key={source.id} source={source} active={source.id === focus} />)}</ol>;
}
