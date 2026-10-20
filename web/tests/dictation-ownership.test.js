import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the actual composer hook with explicit render/effect boundaries.
const composer = readFileSync(new URL('../src/components/Composer.jsx', import.meta.url), 'utf8');
const source = composer.slice(composer.indexOf('function useDictation('), composer.indexOf('/* While dictating,'));
function fixture(desktop = true) {
  let cursor = 0, pending = [], chat = 'first', draft = 'Original draft';
  const slots = [], takes = [], timers = new Map(), writes = [];
  class Recognition {
    constructor() { takes.push(this); this.aborted = 0; }
    start() {}
    stop() { if (desktop) this.onprocessing?.(); }
    abort() { this.aborted++; this.onend?.(); }
    result(text) { this.onresult({ results: [[{ transcript: text }]] }); }
  }
  const hook = runInNewContext(`${source}\nuseDictation`, {
    Recognition, DESKTOP: desktop, navigator: { language: 'en-US' }, FINISH_WAIT: 1500,
    useRef(value) { const at = cursor++; return slots[at] ??= { current: value }; },
    useState(value) { const at = cursor++; if (!(at in slots)) slots[at] = value; return [slots[at], v => { slots[at] = v; }]; },
    useEffect(effect, deps) {
      const at = cursor++, prior = slots[at];
      if (!prior || deps.some((value, i) => value !== prior.deps[i])) {
        pending.push(() => { prior?.cleanup?.(); slots[at] = { deps, cleanup: effect() }; });
      }
    },
    setTimeout(fn) { const id = timers.size + 1; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  function render() {
    cursor = 0;
    const state = hook(draft, value => { draft = value; writes.push({ chat, value }); }, chat);
    const effects = pending; pending = []; effects.forEach(effect => effect());
    return state;
  }
  return { render, takes, timers, writes,
    switchChat(id, text = '') { chat = id; draft = text; render(); return render(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
    get draft() { return draft; },
  };
}

for (const desktop of [true, false]) {
  const platform = desktop ? 'desktop' : 'browser';
  test(`${platform} dictation never writes delayed words into a different conversation`, () => {
    const f = fixture(desktop);
    f.render().toggle();
    f.render();
    const old = f.takes[0];
    const state = f.switchChat('second', 'Second draft');
    old.result('Old words');
    assert.equal(f.draft, 'Second draft');
    assert.equal(old.aborted, 1);
    assert.equal(state.listening, false);
    assert.equal(state.processing, false);
    assert.deepEqual(f.writes, []);
    f.render().toggle();
    f.render();
    f.takes[1].result('New words');
    assert.equal(f.draft, 'Second draft New words');
  });
}

test('switching during desktop transcription discards its result and clears processing', () => {
  const f = fixture();
  f.render().toggle();
  f.render().toggle();
  assert.equal(f.render().processing, true);
  const state = f.switchChat('second', 'Second draft');
  f.takes[0].result('Late transcript');
  assert.equal(f.draft, 'Second draft');
  assert.equal(state.processing, false);
  assert.equal(f.takes[0].aborted, 1);
});

test('conversation change clears queued browser restart and unmount rejects late callbacks', () => {
  const f = fixture(false);
  f.render().toggle();
  f.render().toggle();
  f.render().toggle();
  assert.equal(f.timers.size, 1);
  f.switchChat('second', 'Second draft');
  assert.equal(f.timers.size, 0);
  f.render().toggle();
  f.render();
  const take = f.takes.at(-1);
  f.unmount();
  take.result('After unmount');
  assert.deepEqual(f.writes, []);
});

test('ordinary rerenders keep a take alive and retain its established transcript prefix', () => {
  const f = fixture(false);
  f.render().toggle();
  f.render();
  f.render();
  f.takes[0].result('Words');
  assert.equal(f.draft, 'Original draft Words');
  f.render();
  f.takes[0].result('Words with more');
  assert.equal(f.draft, 'Original draft Words with more');
  assert.equal(f.takes[0].aborted, 0);
  assert.equal(f.takes.length, 1);
});

test('cancelling a queued browser take also discards the finishing take', () => {
  const f = fixture(false);
  f.render().toggle();
  f.render().toggle();
  f.render().toggle();
  f.render().cancel();
  f.takes[0].result('Cancelled words');
  assert.equal(f.draft, 'Original draft');
  assert.equal(f.takes[0].aborted, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(f.render().listening, false);
});

test('composer supplies active conversation ownership to the dictation hook', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /<Composer\s[\s\S]*?conversationId=\{activeId\}/);
  assert.match(composer, /useDictation\(draft, onChange, conversationId\)/);
});
