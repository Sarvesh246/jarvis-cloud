import test from 'node:test';
import assert from 'node:assert/strict';
import { locate, placeFor, cachedPlace, forgetPlace, cityNames } from '../src/lib/location.js';

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
