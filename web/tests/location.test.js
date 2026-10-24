import test from 'node:test';
import assert from 'node:assert/strict';
import { locate, placeFor, cachedPlace, forgetPlace, cityNames } from '../src/lib/location.js';
import { chatInput } from '../server/chat.js';

test('greetings omit shared-location context without losing the local timezone or disabling later weather', () => {
  const base = { conversationId: '0ef3a063-f0d0-44f7-b9dc-774137b1d86c', place: { lat: 41.88, lon: -87.63, city: 'Chicago', tz: 'America/Chicago' } };
  for (const content of ['hello vaelo', 'hi', 'good morning', 'thanks vaelo']) {
    const input = chatInput({ ...base, messages: [{ role: 'user', content }] });
    assert.equal(input.smalltalk, true, content);
    assert.equal(input.place, undefined, content);
    assert.equal(input.tz, 'America/Chicago');
  }
  for (const content of ['hello vaelo, what is the weather today?', 'good coffee near me', 'what is the weather this week?']) {
    const input = chatInput({ ...base, messages: [{ role: 'user', content }] });
    assert.notEqual(input.smalltalk, true, content);
    assert.deepEqual([input.place.lat, input.place.lon], [41.88, -87.63]);
  }
});

function browser(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalFetch = globalThis.fetch;
  const positions = [], requests = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { geolocation: {
    getCurrentPosition(resolve, reject, options) { positions.push({resolve, reject, options}); },
  } } });
  globalThis.fetch = (url, options) => new Promise(resolve => requests.push({url, options, resolve}));
  forgetPlace();
  t.after(() => {
    forgetPlace(); globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  });
  return { positions, requests, grant(index = 0, latitude = 41.881, longitude = -87.629) {
    positions[index].resolve({ coords: { latitude, longitude } });
  } };
}

test('forgetting a pending position cancels waiters and ignores late browser callbacks', async t => {
  const b = browser(t);
  const waiting = locate();
  const outcome = waiting.then(() => 'resolved', error => error.name);
  forgetPlace();
  b.grant();
  assert.equal(await outcome, 'AbortError');
  assert.equal(cachedPlace({location:true}), null);
  assert.equal(b.requests.length, 0, 'revoked coordinates must not reach the geocoder');
});

test('a fresh position request is independent of a forgotten request and its cleanup', async t => {
  const b = browser(t);
  const old = locate().catch(error => error.name);
  forgetPlace();
  const fresh = locate();
  assert.equal(b.positions.length, 2);
  b.grant(0);
  await old;
  assert.equal(locate(), fresh, 'old completion cannot clear a newer pending request');
  b.grant(1, 48.8566, 2.3522);
  const place = await fresh;
  assert.equal(place.lat, 48.86);
  assert.equal(place.lon, 2.35);
  assert.equal(b.requests.length, 1);
});

test('a delivered position loses ownership if forgotten before its promise resumes', async t => {
  const b = browser(t);
  const waiting = locate();
  const rejected = assert.rejects(waiting, {name:'AbortError'});
  b.grant();
  forgetPlace();
  await rejected;
  assert.equal(cachedPlace({location:true}), null);
  assert.equal(b.requests.length, 0);
});

test('forgetting aborts reverse geocoding and prevents obsolete request results', async t => {
  const b = browser(t);
  const first = locate(); b.grant(); await first;
  const waiting = placeFor({location:true});
  forgetPlace();
  assert.equal(await waiting, null, 'even an already cached result must respect revocation during await');
  assert.equal(b.requests[0].options.signal.aborted, true);
  const fresh = locate(); b.grant(1, 48.8566, 2.3522); await fresh;
  b.requests[0].resolve(Response.json({city:'Chicago'}));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cachedPlace({location:true}).lat, 48.86);
  assert.equal(cachedPlace({location:true}).city, undefined);
  b.requests[1].resolve(Response.json({city:'Paris'}));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cachedPlace({location:true}).city, 'Paris');
});

test('pending reply location resolves promptly to nothing when sharing is revoked', async t => {
  const b = browser(t);
  const waiting = placeFor({location:true});
  let settled = false;
  waiting.then(() => { settled = true; });
  forgetPlace();
  // Deliberately never deliver the browser callback: logical cancellation is immediate.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, true, 'revocation must release the reply without the 10.5-second fallback');
  assert.equal(await waiting, null);
  assert.equal(b.requests.length, 0);
});

test('invalid browser coordinates never enter the cache or a geocoder request', async t => {
  const b = browser(t);
  for (const [lat, lon] of [[NaN, 0], [0, Infinity], [91, 0], [0, -181], ['41', 0], [null, 0]]) {
    const waiting = locate();
    const rejected = assert.rejects(waiting, /coordinates/i);
    b.grant(b.positions.length - 1, lat, lon);
    await rejected;
    assert.equal(cachedPlace({location:true}), null);
  }
  assert.equal(b.requests.length, 0);
  const waiting = locate(); b.grant(b.positions.length - 1, -90, 180);
  assert.equal((await waiting).lat, -90, 'boundary coordinates remain valid after failures');
});

test('normal acquisition deduplicates, rounds, caches, refreshes and recovers after refusal', async t => {
  const b = browser(t);
  assert.equal(await placeFor({location:false}), null);
  const first = locate();
  assert.equal(locate(), first);
  const refused = assert.rejects(first, error => error.code === 1);
  b.positions[0].reject({code:1}); await refused;
  const retry = locate(); b.grant(1); const place = await retry;
  assert.deepEqual([place.lat, place.lon], [41.88, -87.63]);
  assert.equal(await locate(), place);
  assert.equal(b.positions.length, 2);
  assert.equal(b.positions[1].options.enableHighAccuracy, false);
  assert.match(b.requests[0].url, /latitude=41.88&longitude=-87.63/);
  const forced = locate({force:true});
  b.grant(2, 0, 0); assert.equal((await forced).lat, 0);
  assert.equal(await placeFor({location:false}), null);
});

test('the geocoder deadline cancels its request without discarding usable coordinates', async t => {
  const b = browser(t);
  t.mock.timers.enable({apis:['setTimeout']});
  const waiting = locate(); b.grant(); const place = await waiting;
  t.mock.timers.tick(3999);
  assert.equal(b.requests[0].options.signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(b.requests[0].options.signal.aborted, true);
  assert.equal(await placeFor({location:true}), place);
  // Even a provider that resolves after abort cannot add a late city.
  b.requests[0].resolve(Response.json({city:'Late city'}));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cachedPlace({location:true}).city, undefined);
});

test('expired coordinates refresh while provider failure keeps the normal coordinate fallback', async t => {
  const b = browser(t);
  t.mock.timers.enable({apis:['Date'],now:1000});
  const waiting = locate(); b.grant(); const original = await waiting;
  b.requests[0].resolve(new Response('Unavailable',{status:503}));
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.setTime(1000+30*60*1000-1);
  assert.deepEqual(await locate(), original);
  t.mock.timers.setTime(1000+30*60*1000);
  const refresh = placeFor({location:true});
  assert.equal(b.positions.length, 2);
  b.positions[1].reject({code:2});
  assert.deepEqual(await refresh, original);
  const recovered = locate(); b.grant(2,0,0);
  assert.equal((await recovered).lat, 0);
});

test('municipal administrative names take precedence over census subdivisions and nearby localities', () => {
  assert.deepEqual(cityNames({ city: 'South Brazos', locality: 'Bryan', principalSubdivision: 'Texas', countryName: 'United States', localityInfo: { administrative: [
    { name: 'Brazos County', description: 'county in Texas' },
    { name: 'College Station', description: 'city in Brazos County, Texas, United States' },
    { name: 'Bryan', description: 'city and county seat in Texas' },
  ] } }), { city: 'College Station', region: 'Texas', country: 'United States' });
  assert.equal(cityNames({ city: 'Paris' }).city, 'Paris');
});

test('a slow geocoder cannot lose granted coordinates and disabled sharing sends nothing', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalFetch = globalThis.fetch;
  let reverse;
  let positionCalls = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { geolocation: { getCurrentPosition(resolve) {
    positionCalls++;
    setTimeout(() => resolve({ coords: { latitude: 41.881, longitude: -87.629 } }), 3600);
  } } } });
  globalThis.fetch = () => new Promise(resolve => { reverse = resolve; });
  try {
    forgetPlace();
    assert.equal(await placeFor({ location: false }), null);
    assert.equal(positionCalls, 0);
    const place = await placeFor({ location: true });
    assert.equal(place.lat, 41.88);
    assert.equal(place.lon, -87.63);
    assert.equal(await locate(), place);
    assert.equal(cachedPlace({ location: false }), null);
    forgetPlace();
    reverse(Response.json({ city: 'Chicago' }));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(cachedPlace({ location: true }), null, 'a city lookup cannot restore a forgotten location');
  } finally {
    forgetPlace();
    globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});

test('a quick send never waits on the phone for an everyday question', async t => {
  const b = browser(t);
  assert.equal(await placeFor({ location: true }, { needed: false }), null, "no place yet: only a short wait");
  b.grant(0);
  await new Promise(resolve => setTimeout(resolve, 0));
  const old = Date.now;
  t.after(() => { Date.now = old; });
  Date.now = () => old() + 31 * 60 * 1000;
  const started = performance.now();
  const stale = await placeFor({ location: true }, { needed: false });
  assert.equal(stale.lat, 41.88, 'an old place goes along at once');
  assert.ok(performance.now() - started < 200);
  assert.equal(b.positions.length, 2, 'and is refreshed in the background');
});

test('a desktop weather send retains coordinates arriving after six seconds through the chat boundary', async t => {
  const b = browser(t);
  t.mock.timers.enable({apis:['setTimeout']});
  let settled = false;
  const waiting = placeFor({location:true}, {needed:true});
  waiting.then(() => { settled = true; });
  t.mock.timers.tick(8000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'weather must wait while the browser can still return a position');
  b.grant();
  const place = await waiting;
  const input = chatInput({
    conversationId: '0ef3a063-f0d0-44f7-b9dc-774137b1d86c',
    messages: [{role:'user', content:'What is the weather today?'}],
    place,
  });
  assert.deepEqual([input.place.lat, input.place.lon], [41.88, -87.63]);
  assert.equal(b.requests.length, 1, 'city lookup may still be pending when the request carries coordinates');
});

test('weather location waits remain bounded if the browser never calls back', async t => {
  browser(t);
  t.mock.timers.enable({apis:['setTimeout']});
  const waiting = placeFor({location:true}, {needed:true});
  t.mock.timers.tick(10500);
  assert.equal(await waiting, null);
});

test('weather sends handle browser failure promptly and respect disabled location sharing', async t => {
  const b = browser(t);
  assert.equal(await placeFor({location:false}, {needed:true}), null);
  assert.equal(b.positions.length, 0);
  for (const code of [1, 2, 3]) {
    const waiting = placeFor({location:true}, {needed:true});
    b.positions.at(-1).reject({code});
    assert.equal(await waiting, null);
  }
});

import { needsPlace } from '../src/lib/location.js';
test('only place-dependent questions are worth waiting for', () => {
  assert.equal(needsPlace('what is the weather today'), true);
  assert.equal(needsPlace('good coffee near me'), true);
  assert.equal(needsPlace('explain recursion'), false);
});
