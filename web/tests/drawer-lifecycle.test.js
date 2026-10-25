import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/lib/use-drawer.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export function', 'function');

function fixture(open = false) {
  let cursor = 0, pending = [], serial = 0, buzzes = 0;
  const slots = [], listeners = new Map(), timers = new Map(), writes = [];
  const target = name => ({
    addEventListener(type, fn) { listeners.set(`${name}:${type}`, fn); },
    removeEventListener(type) { listeners.delete(`${name}:${type}`); },
  });
  const style = new Map();
  const shell = { ...target('shell'), dataset: {}, clientWidth: 390,
    getBoundingClientRect: () => ({ left: 0 }), querySelector: () => ({ offsetWidth: 334 }),
    style: { setProperty: (k, v) => style.set(k, v), removeProperty: k => style.delete(k) } };
  const cover = { closest: selector => selector === '.drawer-cover' ? cover : null };
  const plain = { closest: () => null };
  const window = target('window');
  const hook = runInNewContext(`${source}\nuseDrawer`, {
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useEffect(effect, deps) {
      const at = cursor++, old = slots[at];
      if (!old || deps.some((v, i) => v !== old.deps[i])) pending.push(() => {
        old?.cleanup?.(); slots[at] = { deps, effect, cleanup: effect() };
      });
    },
    addEventListener: window.addEventListener, removeEventListener: window.removeEventListener,
    setTimeout(fn, delay) { timers.set(++serial, { fn, delay }); return serial; },
    clearTimeout(id) { timers.delete(id); }, buzz() { buzzes++; },
  });
  const props = { phone: true, open, shell, setOpen: value => writes.push(value) };
  function commit() { const work = pending; pending = []; work.forEach(fn => fn()); }
  function render(update = {}, effects = true) { Object.assign(props, update); cursor = 0; hook(props); if (effects) commit(); }
  function fire(name, values = {}) {
    const event = { target: props.open ? cover : plain, pointerType: 'mouse', pointerId: 1, button: 0,
      clientX: 10, clientY: 10, cancelable: true, type: name.split(':')[1],
      preventDefault() { this.prevented = true; }, stopPropagation() {}, ...values };
    listeners.get(name)?.(event); return event;
  }
  const touch = (id = 7, x = 10, y = 10) => ({ identifier: id, clientX: x, clientY: y });
  render();
  return { shell, style, timers, writes, render, commit, fire, touch, cover, plain, listeners,
    get buzzes() { return buzzes; },
    start(t = touch()) { fire('shell:touchstart', { touches: [t], changedTouches: [t] }); },
    move(t = touch(7, open ? -200 : 200)) { fire('shell:touchmove', { touches: [t], changedTouches: [t] }); },
    finish(t = touch()) { fire('shell:touchend', { touches: [], changedTouches: [t] }); },
    flush(delay) { for (const [id, timer] of [...timers]) if (delay === undefined || timer.delay === delay) { timers.delete(id); timer.fn(); } },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    strictReplay() { slots.forEach(slot => { if (slot?.effect) { slot.cleanup?.(); slot.cleanup = slot.effect(); } }); },
  };
}

test('touch cancellation rolls back opening and closing without a state write or haptic', () => {
  for (const open of [false, true]) {
    const f = fixture(open); f.start(); f.move();
    f.fire('shell:touchcancel', { touches: [], changedTouches: [f.touch()] }); f.finish();
    assert.deepEqual(f.writes, []); assert.equal(f.buzzes, 0);
    assert.equal(f.shell.dataset.dragging, undefined); assert.equal(f.style.has('--p'), false);
  }
});

test('a second finger cannot move or finish the owned drawer gesture', () => {
  const f = fixture(); f.start(); f.move();
  const preview = f.style.get('--p');
  f.fire('shell:touchmove', { touches: [f.touch(8, 330), f.touch(7, 200)] });
  assert.equal(f.style.get('--p'), preview);
  f.fire('shell:touchend', { touches: [f.touch(7, 200)], changedTouches: [f.touch(8, 330)] });
  assert.deepEqual(f.writes, []); f.finish(); assert.deepEqual(f.writes, [true]);
});

test('mouse pointer ownership excludes unrelated pointers and touch pointer events', () => {
  const f = fixture(); f.fire('shell:pointerdown');
  f.fire('window:pointermove', { pointerId: 2, clientX: 300 });
  assert.equal(f.style.has('--p'), false);
  f.fire('shell:pointerdown', { pointerId: 2, clientX: 20 });
  f.fire('window:pointermove', { clientX: 200 });
  f.fire('window:pointerup', { pointerId: 2 }); assert.deepEqual(f.writes, []);
  f.fire('window:pointerup'); assert.deepEqual(f.writes, [true]);
});

test('pointer cancellation and window blur roll back an active drag and allow retry', () => {
  for (const name of ['window:pointercancel', 'window:blur']) {
    const f = fixture(); f.fire('shell:pointerdown'); f.fire('window:pointermove', { clientX: 200 });
    f.fire(name); f.fire('window:pointerup');
    assert.deepEqual(f.writes, []); assert.equal(f.style.has('--p'), false);
    f.start(); f.move(); f.finish(); assert.deepEqual(f.writes, [true]);
  }
});

test('external drawer state changes cannot be overwritten by an old drag', () => {
  const f = fixture(); f.start(); f.move(); f.render({ open: true }); f.finish();
  assert.deepEqual(f.writes, []); assert.equal(f.style.has('--p'), false);
});

test('closing the drawer during its release animation clears the obsolete open override', () => {
  const f = fixture(); f.start(); f.move(); f.finish(); f.render({ open: true });
  assert.equal(f.style.get('--p'), '1'); f.render({ open: false });
  assert.equal(f.style.has('--p'), false); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.writes, [true]);
});

test('rendered drawer, breakpoint and shell changes revoke old events before passive cleanup', () => {
  for (const update of [{ open: true }, { phone: false }, { shell: null }]) {
    const f = fixture(); f.start(); f.move(); f.render(update, false); f.finish();
    assert.deepEqual(f.writes, []); assert.equal(f.style.has('--p'), false);
    f.commit(); f.unmount();
  }
});

test('unrelated cancellation and touch pointer events do not interrupt a real touch', () => {
  const f = fixture(); f.start(); f.move();
  f.fire('shell:touchcancel', { touches: [f.touch()], changedTouches: [f.touch(9)] });
  f.fire('window:pointercancel', { pointerType: 'touch', pointerId: 7 });
  f.fire('window:pointerup', { pointerType: 'mouse' }); f.finish();
  assert.deepEqual(f.writes, [true]);
});

test('mouse opening and cover closing preserve threshold and release behavior', () => {
  for (const open of [false, true]) {
    const f = fixture(open); f.fire('shell:pointerdown');
    f.fire('window:pointermove', { clientX: open ? -190 : 210 }); f.fire('window:pointerup');
    assert.deepEqual(f.writes, [!open]); f.render({ open: !open });
    assert.equal(f.fire('shell:click', { target: f.cover }).prevented, true);
    f.flush(); assert.equal(f.style.has('--p'), false); f.unmount();
    assert.equal(f.listeners.size, 0);
  }
});

test('unmount, desktop switch and StrictMode cleanup remove all timers and drag styles', () => {
  for (const mode of ['unmount', 'desktop', 'strict']) {
    const f = fixture(); f.start(); f.move(); f.finish();
    if (mode === 'unmount') f.unmount();
    if (mode === 'desktop') f.render({ phone: false });
    if (mode === 'strict') f.strictReplay();
    assert.equal(f.timers.size, 0); assert.equal(f.style.has('--p'), false);
    assert.equal(f.shell.dataset.dragging, undefined); f.flush(); assert.deepEqual(f.writes, [true]);
    if (mode === 'strict') { f.start(); f.move(); f.finish(); assert.deepEqual(f.writes, [true, true]); }
  }
});

test('a fresh touch cancels the previous release timers before starting its own settle', () => {
  const f = fixture(); f.start(); f.move(); f.finish();
  const oldCallbacks = [...f.timers.values()].map(t => t.fn);
  f.render({ open: true }); f.start(); f.move(f.touch(7, -100));
  const preview = f.style.get('--p'); oldCallbacks.forEach(fn => fn());
  assert.equal(f.style.get('--p'), preview); f.finish(); assert.deepEqual(f.writes, [true, false]);
});

test('ordinary taps, vertical scrolling, covered inputs and secondary buttons stay untouched', () => {
  const f = fixture(); f.start(); f.finish();
  f.start(); f.move(f.touch(7, 12, 100)); f.finish();
  f.fire('shell:pointerdown', { button: 2 }); f.fire('window:pointermove', { clientX: 200 }); f.fire('window:pointerup');
  f.fire('shell:touchstart', { touches: [f.touch()], target: { closest: () => ({}) } }); f.move(); f.finish();
  assert.deepEqual(f.writes, []); assert.equal(f.style.has('--p'), false);
  assert.equal(f.fire('shell:click', { target: f.cover }).prevented, undefined);
});

test('normal touch/mouse releases retain thresholds, haptics and temporary cover click suppression', () => {
  for (const open of [false, true]) for (const delta of [50, 200]) {
    const f = fixture(open); f.start(); f.move(f.touch(7, 10 + (open ? -delta : delta))); f.finish();
    const expected = delta === 200 ? !open : open;
    assert.deepEqual(f.writes, expected === open ? [] : [expected]);
    assert.equal(f.buzzes, expected === open ? 0 : 1);
    assert.equal(f.fire('shell:click', { target: f.cover }).prevented, true);
    f.flush(350); assert.equal(f.fire('shell:click', { target: f.cover }).prevented, undefined);
    f.flush(); assert.equal(f.style.has('--p'), false);
  }
});
