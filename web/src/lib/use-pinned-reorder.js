import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { reorderAt } from './rich-ui.js';

const still = () => document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;

export function usePinnedReorder({ aside, ids, setOrder, saveOrder, chats, disabled, owner }) {
  const gesture = useRef(null), currentIds = useRef(ids), positions = useRef(new Map()), suppressClick = useRef(false);
  const latest = useRef(null), lifetime = useRef({ live: true, clickTimer: null, focusFrame: null });
  const [drag, setDrag] = useState(null), [announcement, announce] = useState('');
  currentIds.current = ids;
  latest.current = { ids, setOrder, saveOrder, disabled, owner };

  function release(item) {
    // Capture may already have been lost when a row is removed or a pointer ends.
    try { if (item.element.hasPointerCapture?.(item.pointerId)) item.element.releasePointerCapture(item.pointerId); } catch {}
  }

  function valid(item) {
    const state = latest.current;
    return lifetime.current.live && !state.disabled && item.owner === state.owner && item.element.isConnected &&
      item.original.length === state.ids.length && item.original.every(id => state.ids.includes(id));
  }

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
    const state = latest.current, usable = valid(item);
    if (item.active) {
      if (cancelled || !usable) {
        // Discard the preview, retaining any pins added/removed while dragging.
        if (item.owner === state.owner) {
          const restored = [...item.original.filter(id => state.ids.includes(id)), ...state.ids.filter(id => !item.original.includes(id))];
          currentIds.current = restored;
          state.setOrder(restored);
        }
      } else state.saveOrder(currentIds.current);
      const position = (cancelled ? item.original : currentIds.current).indexOf(item.id) + 1;
      announce(cancelled || !usable ? 'Reordering canceled.' : `Moved ${item.title} to position ${position} of ${state.ids.length}.`);
      suppressClick.current = true;
      clearTimeout(lifetime.current.clickTimer);
      lifetime.current.clickTimer = setTimeout(() => { suppressClick.current = false; }, 350);
      cancelAnimationFrame(lifetime.current.focusFrame);
      if (usable) lifetime.current.focusFrame = requestAnimationFrame(() => {
        if (valid(item)) item.element.focus({preventScroll:true});
      });
    }
    release(item);
    setDrag(null);
  }

  useLayoutEffect(() => {
    const item = gesture.current;
    if (!item) return;
    if (!valid(item)) { finish(true); return; }
    // Moving a keyed row in the DOM can release its capture. Reclaim it after
    // React has committed the new order, before the following pointer event.
    if (item.active && !item.element.hasPointerCapture?.(item.pointerId)) {
      try { item.element.setPointerCapture(item.pointerId); }
      catch { finish(true); }
    }
  }, [disabled, owner, ids.join('|')]);

  useEffect(() => {
    lifetime.current.live = true;
    const root = aside.current;
    function touchMove(event) { if (gesture.current?.active) { event.preventDefault(); event.stopPropagation(); } }
    function escape(event) { if (event.key === 'Escape' && gesture.current?.active) { event.preventDefault(); event.stopPropagation(); finish(true); } }
    function blur() { finish(true); }
    function up(event) { if (gesture.current?.pointerId === event.pointerId) finish(); }
    function cancel(event) { if (gesture.current?.pointerId === event.pointerId) finish(true); }
    root?.addEventListener('touchmove', touchMove, {passive:false,capture:true});
    document.addEventListener('keydown', escape, true);
    window.addEventListener('blur', blur);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      lifetime.current.live = false;
      const item = gesture.current;
      gesture.current = null;
      clearTimeout(item?.timer);
      if (item) release(item);
      clearTimeout(lifetime.current.clickTimer);
      cancelAnimationFrame(lifetime.current.focusFrame);
      suppressClick.current = false;
      root?.removeEventListener('touchmove', touchMove, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [aside]);

  function activate(item) {
    if (gesture.current !== item) return false;
    if (!valid(item)) { finish(true); return false; }
    try { item.element.setPointerCapture(item.pointerId); }
    catch { finish(true); return false; }
    item.active = true;
    setDrag({id:item.id,title:item.title,x:item.x,y:item.y});
    announce(`Moving ${item.title}. Drag to a new position; Escape cancels.`);
    return true;
  }
  const handlers = {
    onPointerDownCapture(event) {
      if (!lifetime.current.live || gesture.current || disabled || event.button !== 0 || ids.length < 2) return;
      const element = event.target.closest('.rail-link, [data-pin-id]');
      const row = element?.closest('[data-pin-row]');
      if (!row) return;
      const id = row.dataset.pinRow;
      if (!ids.includes(id)) return;
      const item = {id,owner,title:chats.find(chat => chat.id === id)?.title || 'Conversation',element,pointerId:event.pointerId,pointerType:event.pointerType,x:event.clientX,y:event.clientY,original:[...ids],active:false};
      gesture.current = item;
      if (event.pointerType === 'touch') item.timer = setTimeout(() => activate(item), 320);
    },
    onPointerMoveCapture(event) {
      const item = gesture.current;
      if (!item || event.pointerId !== item.pointerId) return;
      if (!valid(item)) { finish(true); return; }
      const distance = Math.hypot(event.clientX - item.x, event.clientY - item.y);
      if (!item.active) {
        if (item.pointerType === 'touch') { if (distance > 8) { clearTimeout(item.timer); gesture.current = null; } return; }
        if (distance < 6) return;
        if (!activate(item)) return;
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
    onPointerCancelCapture(event) { if (gesture.current?.pointerId === event.pointerId) finish(true); },
    onLostPointerCapture(event) { if (gesture.current?.pointerId === event.pointerId) finish(true); },
    onContextMenuCapture(event) { if (gesture.current?.active) event.preventDefault(); },
    onClickCapture(event) { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } },
  };
  return {handlers,drag,announcement};
}
