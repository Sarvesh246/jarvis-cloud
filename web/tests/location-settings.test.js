import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../src/components/Settings.jsx', import.meta.url), 'utf8');
const hook = source.slice(source.indexOf('function useLocate('), source.indexOf('const LOCATION_NOTE'));
function fixture() {
  let problem = '', cleanup, forgotten = 0;
  const writes = [], requests = [], attempt = { current: 0 };
  const useLocate = runInNewContext(`${hook}\nuseLocate`, {
    useState: () => [problem, value => { problem = value; }],
    useRef: () => attempt,
    useEffect: fn => { cleanup = fn(); },
    locationSupport: () => true,
    forgetPlace: () => { forgotten++; },
    locate: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
  });
  const ui = useLocate({}, patch => writes.push(patch.location));
  return { ui, writes, requests, problem: () => problem, unmount: () => cleanup(), forgotten: () => forgotten };
}
test('location consent survives position timeout so a granted browser can retry on send', async () => {
  const f = fixture();
  const pending = f.ui.toggle(true);
  assert.deepEqual(f.writes, [true], 'consent is saved before browser acquisition');
  f.requests[0].reject({ code: 3 }); await pending;
  assert.deepEqual(f.writes, [true]);
  assert.match(f.problem(), /try again/);
});
test('browser denial disables sharing, but obsolete denial cannot undo a later choice', async () => {
  const f = fixture();
  const first = f.ui.toggle(true);
  f.requests[0].reject({ code: 1 }); await first;
  assert.deepEqual(f.writes, [true, false]);
  const second = f.ui.toggle(true);
  await f.ui.toggle(false);
  f.requests[1].reject({ code: 1 }); await second;
  assert.deepEqual(f.writes, [true, false, true, false]);
  assert.equal(f.forgotten(), 1);
  assert.equal(f.problem(), '');
});
test('a late browser failure after settings unmount cannot change consent or report an error', async () => {
  const f = fixture(), pending = f.ui.toggle(true);
  f.unmount(); f.requests[0].reject({ code: 1 }); await pending;
  assert.deepEqual(f.writes, [true]); assert.equal(f.problem(), '');
});
