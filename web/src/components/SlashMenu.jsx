import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Lightning, SlidersHorizontal } from '@phosphor-icons/react';
import { slashMatches } from '../lib/slash-commands.js';
import './slash-commands.css';

// Portal avoids clipping by the chat scroller and the composer’s rounded box.
// Position against visualViewport so the phone keyboard cannot hide the menu.
export function SlashMenu({ draft, input, onPick, commands, dismissed, onDismiss }) {
  const matches = slashMatches(draft, commands);
  const open = matches !== null && !dismissed;
  const [selected, setSelected] = useState(0);
  const [position, setPosition] = useState(null);
  const menu = useRef(null);
  const index = Math.min(selected, Math.max(0, (matches?.length || 0) - 1));
  useEffect(() => setSelected(0), [draft]);
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = input.current?.closest('.composer');
    if (!anchor) return;
    function place() {
      const rect = anchor.getBoundingClientRect();
      const view = window.visualViewport;
      const top = view?.offsetTop || 0, bottom = top + (view?.height || innerHeight);
      const above = rect.top - top - 12, below = bottom - rect.bottom - 12;
      const up = above >= 220 || above > below;
      const height = Math.max(100, Math.min(360, (up ? above : below) - 8));
      setPosition({ left: Math.max(12, rect.left), width: Math.min(rect.width, innerWidth - 24), maxHeight: height,
        ...(up ? { bottom: innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }) });
    }
    place();
    const observer = new ResizeObserver(place); observer.observe(anchor);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place); window.visualViewport?.addEventListener('scroll', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place); };
  }, [open, input, draft]);
  useEffect(() => { if (open) menu.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' }); }, [index, open]);
  useEffect(() => {
    const el = input.current;
    if (!open || !el) return;
    el.setAttribute('aria-expanded', 'true'); el.setAttribute('aria-controls', 'slash-list');
    if (matches.length) el.setAttribute('aria-activedescendant', `slash-${matches[index].name}`);
    else el.removeAttribute('aria-activedescendant');
    function keys(event) {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onDismiss(); }
      else if (['ArrowDown', 'ArrowUp'].includes(event.key) && matches.length) {
        event.preventDefault(); event.stopImmediatePropagation();
        setSelected((index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
      } else if ((event.key === 'Tab' && !event.shiftKey || event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) && matches.length) {
        event.preventDefault(); event.stopImmediatePropagation(); onPick(matches[index]);
      }
    }
    function away(event) { if (!menu.current?.contains(event.target) && !el.closest('.composer')?.contains(event.target)) onDismiss(); }
    el.addEventListener('keydown', keys); window.addEventListener('pointerdown', away);
    return () => { el.removeEventListener('keydown', keys); window.removeEventListener('pointerdown', away);
      el.setAttribute('aria-expanded', 'false'); el.removeAttribute('aria-controls'); el.removeAttribute('aria-activedescendant'); };
  }, [open, index, draft, input, onPick, onDismiss, commands]);
  if (!open || !position) return null;
  return createPortal(<div className="slash-menu" style={position} ref={menu}>
    <div className="slash-menu-heading"><span>Commands</span><small>↑ ↓ choose · Tab complete · Esc close</small></div>
    <div className="slash-results" role="listbox" id="slash-list" aria-label="Slash commands">
      {matches.map((item, at) => <button type="button" role="option" id={`slash-${item.name}`} key={item.name}
        aria-selected={at === index} tabIndex={-1} onPointerMove={event => { if (event.pointerType === 'mouse') setSelected(at); }}
        onMouseDown={event => event.preventDefault()} onClick={() => onPick(item)}>
        <span className="slash-symbol">{item.ai ? <Lightning size={18} /> : <SlidersHorizontal size={18} />}</span>
        <span className="slash-label"><strong>/{item.name} <small>{item.args}</small></strong><span>{item.description}</span></span>
        <ArrowUpRight size={16} className="slash-enter" aria-hidden="true" />
      </button>)}
      {!matches.length && <p className="slash-empty">No matching commands. Try /help.</p>}
    </div>
    <div className="slash-menu-footer">Choose a command · AI actions are marked with a lightning bolt</div>
  </div>, document.body);
}
