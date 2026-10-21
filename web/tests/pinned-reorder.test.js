import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { reorderAt } from '../src/lib/rich-ui.js';

const source = readFileSync(new URL('../src/lib/use-pinned-reorder.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export function', 'function');

function fixture() {
  let cursor = 0, effects = [], ui, serial = 0;
  const slots = [], timers = new Map(), frames = new Map(), saved = [], writes = [], listeners = new Map();
  const target = name => ({
    addEventListener(type, fn) { listeners.set(`${name}:${type}`, fn); },
    removeEventListener(type) { listeners.delete(`${name}:${type}`); },
  });
  const rows = new Map();
  for (const [i, id] of ['a', 'b', 'c', 'd'].entries()) {
    const captures = new Set();
    const row = { dataset: { pinRow: id }, offsetTop: i * 50, getBoundingClientRect: () => ({ top: i * 50, height: 50 }), closest: () => row };
    const element = { isConnected: true, failCapture: false, focused: 0,
      closest(selector) { return selector === '[data-pin-row]' ? row : element; },
      setPointerCapture(id) { if (this.failCapture) throw new Error('Pointer is no longer active'); captures.add(id); },
      hasPointerCapture(id) { return captures.has(id); }, releasePointerCapture(id) { captures.delete(id); },
      focus() { this.focused++; }, captures };
    rows.set(id, { row, element });
  }
  const root = { ...target('root'), querySelectorAll: () => [], querySelector: () => null, contains: row => [...rows.values()].some(r => r.row === row) };
  const document = { ...target('document'), documentElement: { dataset: { motion: 'reduce' } }, elementFromPoint: () => rows.get('c').row };
  const window = target('window');
  const changed = (slot, deps) => !slot || deps.some((v, i) => v !== slot.deps[i]);
  const useEffect = (effect, deps) => { const at = cursor++, previous = slots[at]; if (changed(previous, deps)) effects.push(() => { previous?.cleanup?.(); slots[at] = { deps, effect, cleanup: effect() }; }); };
  const hook = runInNewContext(`${source}\nusePinnedReorder`, {
    reorderAt, document, window, matchMedia: () => ({ matches: true }),
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useState(value) { const at = cursor++; if (!(at in slots)) slots[at] = value; return [slots[at], value => { slots[at] = value; writes.push(value); }]; },
    useEffect, useLayoutEffect: useEffect,
    setTimeout(fn) { timers.set(++serial, fn); return serial; }, clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { frames.set(++serial, fn); return serial; }, cancelAnimationFrame(id) { frames.delete(id); },
  });
  const props = { aside: { current: root }, ids: ['a', 'b', 'c'], chats: ['a', 'b', 'c'].map(id => ({ id, title: id.toUpperCase() })), owner: 'account-a', disabled: false,
    setOrder(ids) { props.ids = [...ids]; }, saveOrder(ids) { saved.push([...ids]); props.ids = [...ids]; } };
  function render(update = {}) { Object.assign(props, update); cursor = 0; ui = hook(props); const pending = effects; effects = []; pending.forEach(fn => fn()); return ui; }
  const event = (id = 1, extra = {}) => ({ pointerId: id, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0, target: rows.get('a').element, preventDefault() {}, stopPropagation() {}, ...extra });
  const call = (name, extra = {}, id = 1) => ui.handlers[name](event(id, extra));
  render();
  return { props, saved, rows, writes, timers, frames, render, call,
    startTouch(id = 1) { call('onPointerDownCapture', { pointerType: 'touch' }, id); },
    activate() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); },
    move(id = 1) { call('onPointerMoveCapture', { clientX: 20, clientY: 140 }, id); },
    fire(name, value = {}) { listeners.get(name)?.(value); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    strictReplay() { slots.forEach(slot => { if (slot?.effect) { slot.cleanup?.(); slot.cleanup = slot.effect(); } }); },
    flushFrames() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
  };
}

test('mouse reorder saves once, suppresses its click, and ordinary clicks still work', () => {
  const f = fixture(); f.call('onPointerDownCapture'); f.move(); f.render();
  assert.deepEqual(f.props.ids, ['b', 'c', 'a']);
  f.call('onPointerUpCapture'); f.call('onPointerUpCapture');
  assert.deepEqual(f.saved, [['b', 'c', 'a']]);
  let blocked = 0;
  f.call('onClickCapture', { preventDefault() { blocked++; } });
  f.call('onClickCapture', { preventDefault() { blocked++; } }); assert.equal(blocked, 1);
  f.flushFrames(); assert.equal(f.rows.get('a').element.focused, 1);
});

test('an unrelated second pointer cannot replace or cancel the owned drag', () => {
  const f = fixture(); f.call('onPointerDownCapture'); f.move(); f.render();
  f.call('onPointerDownCapture', { target: f.rows.get('b').element }, 2);
  f.call('onPointerCancelCapture', {}, 2); f.call('onPointerUpCapture');
  assert.deepEqual(f.saved, [['b', 'c', 'a']]);
});

test('pending touch release outside the rail cancels long-press activation', () => {
  const f = fixture(); f.startTouch();
  f.fire('window:pointerup', { pointerId: 1 }); f.activate();
  assert.equal(f.render().drag, null); assert.equal(f.rows.get('a').element.captures.size, 0);
});

test('lost capture cancels a preview without saving and permits another drag', () => {
  const f = fixture(); f.call('onPointerDownCapture'); f.move(); f.render();
  f.call('onLostPointerCapture', {}, 1);
  assert.deepEqual(f.props.ids, ['a', 'b', 'c']); assert.equal(f.saved.length, 0);
  f.render(); f.call('onPointerDownCapture'); f.move(); f.call('onPointerUpCapture');
  assert.deepEqual(f.saved, [['b', 'c', 'a']]);
});

test('committed DOM row moves reclaim capture, while failed recapture cancels safely', () => {
  for (const fails of [false, true]) {
    const f = fixture(); f.call('onPointerDownCapture'); f.move();
    f.rows.get('a').element.captures.clear(); f.rows.get('a').element.failCapture = fails;
    f.render();
    assert.equal(f.rows.get('a').element.captures.has(1), !fails);
    if (fails) { assert.deepEqual(f.props.ids, ['a', 'b', 'c']); assert.equal(f.render().drag, null); }
    else { f.call('onPointerUpCapture'); assert.deepEqual(f.saved, [['b', 'c', 'a']]); }
  }
});

test('pointer capture failure is contained and the following attempt can succeed', () => {
  const f = fixture(); f.rows.get('a').element.failCapture = true;
  f.call('onPointerDownCapture'); assert.doesNotThrow(() => f.move());
  assert.equal(f.render().drag, null); assert.deepEqual(f.props.ids, ['a', 'b', 'c']);
  f.rows.get('a').element.failCapture = false;
  f.call('onPointerDownCapture'); f.move(); f.call('onPointerUpCapture'); assert.equal(f.saved.length, 1);
});

test('disabling a hidden or filtered rail cancels pending and active gestures', () => {
  for (const active of [false, true]) {
    const f = fixture(); f.startTouch(); if (active) { f.activate(); f.move(); }
    f.render({ disabled: true }); f.activate(); f.call('onPointerUpCapture');
    assert.equal(f.render().drag, null); assert.equal(f.saved.length, 0);
    assert.deepEqual(f.props.ids, ['a', 'b', 'c']);
  }
});

test('changed pin membership cancels preview without resurrecting removed pins', () => {
  const f = fixture(); f.call('onPointerDownCapture'); f.move();
  f.render({ ids: ['b', 'c', 'd'] }); f.call('onPointerUpCapture');
  assert.equal(f.saved.length, 0); assert.deepEqual(f.props.ids, ['b', 'c', 'd']);
  assert.equal(f.render().drag, null);
});

test('account change invalidates the old gesture without applying its order', () => {
  const f = fixture(); f.call('onPointerDownCapture'); f.move();
  f.render({ owner: 'account-b', ids: ['c', 'a', 'b'] }); f.call('onPointerUpCapture');
  assert.deepEqual(f.props.ids, ['c', 'a', 'b']); assert.equal(f.saved.length, 0);
  assert.equal(f.render().drag, null);
});

test('unmount releases capture and cancels timers and scheduled focus without state writes', () => {
  for (const finished of [false, true]) {
    const f = fixture(); f.startTouch(); f.activate(); f.move(); if (finished) f.call('onPointerUpCapture');
    const before = f.writes.length; f.unmount(); f.activate(); f.flushFrames();
    assert.equal(f.writes.length, before); assert.equal(f.timers.size, 0); assert.equal(f.frames.size, 0);
    assert.equal(f.rows.get('a').element.captures.size, 0); assert.equal(f.rows.get('a').element.focused, 0);
  }
});

test('Escape and blur restore the start order, including after StrictMode replay', () => {
  for (const action of ['escape', 'blur']) {
    const f = fixture(); f.strictReplay(); f.call('onPointerDownCapture'); f.move(); f.render();
    if (action === 'blur') f.fire('window:blur');
    else f.fire('document:keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert.deepEqual(f.props.ids, ['a', 'b', 'c']); assert.equal(f.saved.length, 0);
    assert.equal(f.render().announcement, 'Reordering canceled.');
  }
});

test('touch movement before the hold threshold remains scrolling and clicks are untouched', () => {
  const f = fixture(); f.startTouch(); f.move(); f.activate();
  f.call('onPointerUpCapture'); assert.equal(f.saved.length, 0); assert.equal(f.render().drag, null);
  let blocked = false; f.call('onClickCapture', { preventDefault() { blocked = true; } }); assert.equal(blocked, false);
});
