import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { reorderAt } from './rich-ui.js';

const still = () => document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;

export function usePinnedReorder({ aside, ids, setOrder, saveOrder, chats, disabled }) {
  const gesture = useRef(null), currentIds = useRef(ids), positions = useRef(new Map()), suppressClick = useRef(false);
  const [drag, setDrag] = useState(null), [announcement, announce] = useState('');
  currentIds.current = ids;

  useLayoutEffect(() => {
    for (const row of aside.current?.querySelectorAll('[data-pin-row]') || []) {
      const top = row.offsetTop, before = positions.current.get(row.dataset.pinRow);
      positions.current.set(row.dataset.pinRow, top);
      if (before !== undefined && before !== top && !still()) {
        row.getAnimations().forEach(animation => animation.cancel());
        row.animate([{transform:`translateY(${before - top}px)`},{transform:'translateY(0)'}], {duration:220,easing:'cubic-bezier(.2,.8,.25,1)'});
      }
    }
  }, [ids.join('|'), aside]);

  function finish(cancelled = false) {
    const item = gesture.current;
    if (!item) return;
    clearTimeout(item.timer);
    gesture.current = null;
    if (item.active) {
      if (cancelled) setOrder(item.original);
      else saveOrder(currentIds.current);
      const position = (cancelled ? item.original : currentIds.current).indexOf(item.id) + 1;
      announce(cancelled ? 'Reordering cancelled.' : `Moved ${item.title} to position ${position} of ${ids.length}.`);
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 350);
      requestAnimationFrame(() => item.element.isConnected && item.element.focus({preventScroll:true}));
    }
    if (item.element.hasPointerCapture?.(item.pointerId)) item.element.releasePointerCapture(item.pointerId);
    setDrag(null);
  }

  useEffect(() => {
    const root = aside.current;
    function touchMove(event) { if (gesture.current?.active) { event.preventDefault(); event.stopPropagation(); } }
    function escape(event) { if (event.key === 'Escape' && gesture.current?.active) { event.preventDefault(); event.stopPropagation(); finish(true); } }
    function blur() { finish(true); }
    root?.addEventListener('touchmove', touchMove, {passive:false,capture:true});
    document.addEventListener('keydown', escape, true);
    window.addEventListener('blur', blur);
    return () => { clearTimeout(gesture.current?.timer); root?.removeEventListener('touchmove', touchMove, true); document.removeEventListener('keydown', escape, true); window.removeEventListener('blur', blur); };
  }, [aside]);

  function activate(item) {
    if (gesture.current !== item) return;
    item.active = true;
    item.element.setPointerCapture(item.pointerId);
    setDrag({id:item.id,title:item.title,x:item.x,y:item.y});
    announce(`Moving ${item.title}. Drag to a new position; Escape cancels.`);
  }
  const handlers = {
    onPointerDownCapture(event) {
      if (disabled || event.button !== 0 || ids.length < 2) return;
      const element = event.target.closest('.rail-link, [data-pin-id]');
      const row = element?.closest('[data-pin-row]');
      if (!row) return;
      const id = row.dataset.pinRow;
      const item = {id,title:chats.find(chat => chat.id === id)?.title || 'Conversation',element,pointerId:event.pointerId,pointerType:event.pointerType,x:event.clientX,y:event.clientY,original:[...ids],active:false};
      gesture.current = item;
      if (event.pointerType === 'touch') item.timer = setTimeout(() => activate(item), 320);
    },
    onPointerMoveCapture(event) {
      const item = gesture.current;
      if (!item || event.pointerId !== item.pointerId) return;
      const distance = Math.hypot(event.clientX - item.x, event.clientY - item.y);
      if (!item.active) {
        if (item.pointerType === 'touch') { if (distance > 8) { clearTimeout(item.timer); gesture.current = null; } return; }
        if (distance < 6) return;
        activate(item);
      }
      event.preventDefault(); event.stopPropagation();
      setDrag({id:item.id,title:item.title,x:event.clientX,y:event.clientY});
      const row = document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-pin-row]');
      if (row && aside.current?.contains(row)) {
        const rect = row.getBoundingClientRect();
        const next = reorderAt(currentIds.current,item.id,row.dataset.pinRow,event.clientY > rect.top + rect.height / 2);
        if (next !== currentIds.current) { currentIds.current = next; setOrder(next); }
      }
      const list = aside.current?.querySelector('.rail-list');
      if (list) { const rect = list.getBoundingClientRect(); if (event.clientY < rect.top + 30) list.scrollTop -= 12; else if (event.clientY > rect.bottom - 30) list.scrollTop += 12; }
    },
    onPointerUpCapture(event) { if (gesture.current?.pointerId === event.pointerId) finish(); },
    onPointerCancelCapture() { finish(true); },
    onContextMenuCapture(event) { if (gesture.current?.active) event.preventDefault(); },
    onClickCapture(event) { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } },
  };
  return {handlers,drag,announcement};
}
