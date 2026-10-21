import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listVoices, onVoices, speak, speakable, speechSupport, stopSpeaking } from '../src/lib/speech.js';

function platform(t, overrides = {}) {
  const spoken = [], cancelled = [], listeners = new Set();
  const voices = [
    { voiceURI: 'local', name: 'Local', localService: true, lang: 'fr-FR' },
    { voiceURI: 'english', name: 'English', localService: false, lang: 'en-US' },
    { voiceURI: 'other', name: 'Other', localService: false, lang: 'de-DE' },
  ];
  const engine = {
    getVoices: () => voices,
    cancel: () => cancelled.push(true),
    speak: utterance => spoken.push(utterance),
    addEventListener: (event, callback) => { assert.equal(event, 'voiceschanged'); listeners.add(callback); },
    removeEventListener: (event, callback) => { assert.equal(event, 'voiceschanged'); listeners.delete(callback); },
    ...overrides,
  };
  const values = { speechSynthesis: engine, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }, navigator: { language: 'en-US' } };
  for (const [key, value] of Object.entries(values)) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (old) Object.defineProperty(globalThis, key, old); else delete globalThis[key]; });
  }
  return { engine, voices, spoken, cancelled, listeners };
}

test('read-aloud preserves established prose, labels, inline code and length limit', () => {
  assert.equal(speakable('# Hello **reader**\n\nSee [café](https://example.com) and `x = 2`.\n| A | B |\n|---|---|\n| 1 | 2 |'), 'Hello reader See café and x = 2 .');
  assert.equal(speakable('漢字 '.repeat(3000)).length, 4000);
  assert.equal(speakable(''), '');
});

test('read-aloud omits tilde, indented and longer fenced blocks without losing following prose', () => {
  for (const marker of ['~~~', '~~~~', '```', '````', '`````']) {
    const inner = marker.length > 3 ? '\n```\nsecret nested code\n```' : '';
    const source = `Before.\r\n  ${marker}js\r\nsecret code${inner}\r\n  ${marker}\r\nAfter café 漢字.`;
    assert.equal(speakable(source), 'Before. After café 漢字.', marker);
    assert.equal(speakable(`Before.\n${marker}js\nsecret unfinished code`), 'Before.', marker);
  }
});

test('inline triple-backtick examples do not swallow the rest of a spoken answer', () => {
  assert.equal(speakable('Use ``` as a fence marker. Keep reading.'), 'Use as a fence marker. Keep reading.');
  assert.equal(speakable('A\n```js\nx()\n```\nB\n~~~txt\ny()\n~~~\nC'), 'A B C');
});

test('quoted and list-contained code stays out of read-aloud', () => {
  for (const marker of ['```', '~~~', '````']) {
    for (const [opening, body, closing] of [['> ', '> ', '> '], ['> > ', '> > ', '> > '], ['- ', '  ', '  '], ['1. ', '   ', '   ']]) {
      assert.equal(speakable(`Before.\n${opening}${marker}js\n${body}secret code\n${closing}${marker}\nAfter.`), 'Before. After.');
    }
  }
  for (const indent of ['    ', '\t']) {
    assert.equal(speakable(`Before.\n${indent}\u0060\u0060\u0060js\n${indent}secret code\n${indent}\u0060\u0060\u0060\nAfter.`), 'Before. After.');
  }
});

test('unavailable speech is a harmless optional feature', t => {
  platform(t);
  delete globalThis.speechSynthesis;
  assert.equal(speechSupport(), false);
  assert.deepEqual(listVoices(), []);
  assert.equal(speak('Hello'), false);
  assert.doesNotThrow(stopSpeaking);
  assert.doesNotThrow(onVoices(() => {}));
});

test('normal speech keeps voice selection, rate, cancellation and listener cleanup', t => {
  const p = platform(t);
  assert.deepEqual(listVoices(), p.voices.slice(0, 2));
  const callback = () => {};
  const unsubscribe = onVoices(callback);
  assert.equal(p.listeners.has(callback), true);
  unsubscribe();
  assert.equal(p.listeners.size, 0);
  assert.equal(speak('**café 漢字**', { voice: 'local', rate: 1.25 }), true);
  assert.equal(p.cancelled.length, 1);
  assert.equal(p.spoken[0].text, 'café 漢字');
  assert.equal(p.spoken[0].voice, p.voices[0]);
  assert.equal(p.spoken[0].rate, 1.25);
  assert.equal(speak('```js\nsecret()\n```'), false);
  assert.equal(p.cancelled.length, 1, 'empty speech leaves existing playback alone');
  assert.equal(speak('Default voice', { voice: 'missing' }), true);
  assert.equal(p.spoken[1].voice, undefined);
  stopSpeaking();
  assert.equal(p.cancelled.length, 3);
});

test('voice enumeration and subscription failures cannot crash Settings', t => {
  const p = platform(t, { getVoices() { throw new Error('Engine unavailable'); }, addEventListener() { throw new Error('Listener unavailable'); } });
  assert.deepEqual(listVoices(), []);
  const unsubscribe = onVoices(() => {});
  assert.equal(typeof unsubscribe, 'function');
  assert.doesNotThrow(unsubscribe);
  p.engine.addEventListener = () => {};
  p.engine.removeEventListener = () => { throw new Error('Engine gone'); };
  assert.doesNotThrow(onVoices(() => {}));
  assert.doesNotThrow(() => onVoices(() => {})());
});

test('speech construction, voice lookup, cancel and playback errors settle as false and recover', t => {
  const p = platform(t);
  function unavailable() { throw new Error('Engine unavailable'); }
  const constructor = globalThis.SpeechSynthesisUtterance;
  for (const key of ['constructor', 'getVoices', 'cancel', 'speak']) {
    const original = p.engine[key];
    if (key === 'constructor') Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: unavailable });
    else p.engine[key] = unavailable;
    assert.equal(speak('Hello', { voice: 'local' }), false, key);
    if (key === 'constructor') Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: constructor });
    else p.engine[key] = original;
    assert.equal(speak('Recovered', { voice: 'local' }), true, key);
  }
  p.engine.cancel = unavailable;
  assert.doesNotThrow(stopSpeaking);
});

test('failed read-aloud does not interrupt the real successful-reply completion branch', t => {
  platform(t, { speak() { throw new Error('Audio device unavailable'); } });
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const branch = app.slice(app.indexOf('      if (succeeded) {'), app.indexOf('      // A reply picked up on opening the app'));
  assert.ok(branch.includes('speak(received'));
  const complete = new Function('speak', 'prefsRef', 'received', 'announce', 'document', 'here', 'setSettling', 'settleTimer', 'setTimeout', 'inQuietHours', 'tellReady', 'title', 'showToast', 'selectChat', 'chatId', 'const succeeded = true; ' + branch);
  const events = [];
  for (const foreground of [true, false]) {
    const doc = { hidden: !foreground, title: '' };
    const timer = { current: null };
    complete(speak, { current: { readAloud: true, notify: true } }, 'The answer.', value => events.push(value), doc, () => foreground,
      value => events.push(value), timer, () => 123, () => false, () => events.push('notification'), 'Example',
      toast => events.push(toast.text), () => {}, 'chat');
    if (foreground) assert.equal(timer.current, 123);
    else assert.equal(doc.title, 'Reply ready · Vaelo');
  }
  assert.deepEqual(events, ['Vaelo replied.', true, 'Vaelo replied.', 'notification', 'Vaelo finished replying in “Example”.']);
});
