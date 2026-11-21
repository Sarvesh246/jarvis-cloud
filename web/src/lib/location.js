/* Where this person is, only when they switched it on in Settings. The
   browser asks permission itself. Coordinates are rounded to two decimals
   (about a kilometre) before they leave this module, and the nearest city is
   looked up once so a question like "weather today" can be searched by name. */

const FRESH_MS = 30 * 60 * 1000;
const POSITION_TIMEOUT_MS = 10000;
// Let the browser deliver its success/error callback before the send deadline.
const PLACE_WAIT_MS = POSITION_TIMEOUT_MS + 500;
// While the system's permission dialog is up, the person is answering it; a
// reply that needs their place waits for that rather than going without.
const PROMPT_WAIT_MS = 30000;
// A remembered place older than this is not sent; it was somewhere else.
const KEEP_MS = 12 * 60 * 60 * 1000;
const STORE_KEY = "vaelo-place";
const GEOCODER = "https://api.bigdatacloud.net/data/reverse-geocode-client";
let cached = null;
let pending = null;
let generation = 0;
const lookups = new Set();

const round = (n) => Math.round(n * 100) / 100;

/* The last place is kept on this device (already rounded to about a
   kilometre) so a phone that closed Vaelo in the background still has it on
   the next launch. Without it, an installed iPhone app started every launch
   with no place at all and its first local question went out without one. */
function validPlace(place) {
  return place && typeof place === "object" && [place.lat, place.lon].every(Number.isFinite) &&
    Math.abs(place.lat) <= 90 && Math.abs(place.lon) <= 180;
}

export function restorePlace(now = Date.now()) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (!saved || !Number.isFinite(saved.at) || !validPlace(saved.place) || now - saved.at > KEEP_MS || saved.at > now + 60000) {
      if (saved) localStorage.removeItem(STORE_KEY);
      return null;
    }
    return { place: saved.place, at: saved.at };
  } catch {
    return null;
  }
}

function remember(next) {
  cached = next;
  try {
    if (next) localStorage.setItem(STORE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORE_KEY);
  } catch { /* the place still holds for this visit */ }
}

function current(now = Date.now()) {
  if (cached && now - cached.at > KEEP_MS) cached = null;
  if (!cached) cached = restorePlace(now);
  return cached;
}

/* "granted", "prompt", "denied", or "unknown" where the browser can't say. */
export async function locationPermission() {
  try {
    const status = await navigator.permissions?.query?.({ name: "geolocation" });
    return ["granted", "prompt", "denied"].includes(status?.state) ? status.state : "unknown";
  } catch {
    return "unknown";
  }
}

export function locationSupport() {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

function position(signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    const finish = (callback) => (value) => {
      signal.removeEventListener('abort', aborted);
      if (!signal.aborted) callback(value);
    };
    signal.addEventListener('abort', aborted, { once: true });
    try {
      navigator.geolocation.getCurrentPosition(finish(resolve), finish(reject), {
        enableHighAccuracy: false,
        maximumAge: 10 * 60 * 1000,
        timeout: POSITION_TIMEOUT_MS,
      });
    } catch (error) { finish(reject)(error); }
  });
}

export function cityNames(data) {
  const clean = value => typeof value === 'string' ? value.trim().slice(0, 80) : '';
  // The provider's `city` can be a census subdivision (e.g. South Brazos).
  // Prefer an actual municipality in its administrative hierarchy, not a
  // nearby locality or an informative statistical division.
  const municipality = data.localityInfo?.administrative?.find(entry =>
    /^(?:city|town|village|municipality|borough)\b/i.test(entry.description || ''));
  return {
    city: clean(municipality?.name || data.city || data.locality),
    region: clean(data.principalSubdivision),
    country: clean(data.countryName),
  };
}

async function cityOf(lat, lon, controller) {
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${GEOCODER}?latitude=${lat}&longitude=${lon}&localityLanguage=en`, {
      signal: controller.signal,
    });
    if (!response.ok) return {};
    const data = await response.json();
    return cityNames(data);
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/* Resolves to { lat, lon, tz, city?, region?, country? }, or rejects with the
   browser's error (code 1 means permission was refused). */
export function locate({ force = false } = {}) {
  if (!locationSupport()) return Promise.reject(new Error("unsupported"));
  const known = force ? null : current();
  if (known && Date.now() - known.at < FRESH_MS) return Promise.resolve(known.place);
  if (pending) return pending;
  const controller = new AbortController();
  const { signal } = controller;
  lookups.add(controller);
  const request = position(signal)
    .then(({ coords }) => {
      // A browser callback can resolve just before sharing is switched off.
      if (signal.aborted) throw signal.reason;
      if (!coords || ![coords.latitude, coords.longitude].every(Number.isFinite) ||
          Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180)
        throw new Error('Invalid location coordinates.');
      const lat = round(coords.latitude);
      const lon = round(coords.longitude);
      const place = {
        lat,
        lon,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      remember({ place, at: Date.now() });
      // Coordinates are usable immediately. A slow city lookup must never
      // discard a browser permission grant or delay a local weather request.
      void cityOf(lat, lon, controller).then(names => {
        if (!signal.aborted && cached?.place === place) remember({ ...cached, place: { ...place, ...names } });
      }).finally(() => lookups.delete(controller));
      return place;
    })
    .catch(error => { lookups.delete(controller); throw error; })
    .finally(() => {
      if (pending === request) pending = null;
    });
  pending = request;
  return pending;
}

/* Questions whose answer depends on where the person is. Only these are
   worth holding a reply for while the browser works out its position. */
const LOCAL = /\b(?:weather|forecast|temperature|rain(?:ing)?|snow(?:ing)?|humid(?:ity)?|sunrise|sunset|near(?:by| me)|local|around here|my (?:area|location|city|town)|closest|nearest|open now|directions? to)\b/i;
export function needsPlace(text) {
  return LOCAL.test(String(text || ''));
}

/* What a request carries right now: nothing unless switched on, never waits
   long, and never fails a reply because location was unavailable.

   With `{ needed }` the reply does not wait on the browser's position unless the
   question depends on it: a known place, even an old one, goes along at once
   and is refreshed in the background, and with no place yet a short wait is
   all an everyday question gets. Waiting on GPS used to hold every message for
   seconds before anything was sent. */
export async function placeFor(prefs, quick) {
  if (!prefs?.location) return null;
  const started = generation;
  // Desktop location providers can need most of the browser's ten-second
  // window. Sending earlier silently drops an otherwise successful position.
  let limit = quick && !quick.needed ? 800 : PLACE_WAIT_MS;
  const known = current();
  if (quick && known) {
    const stale = Date.now() - known.at >= FRESH_MS;
    if (!stale) return known.place;
    if (!quick.needed) {
      locate().catch(() => {});
      return known.place;
    }
  }
  // Browsers that can't report permission keep the timing above unchanged.
  if (quick && typeof navigator !== "undefined" && typeof navigator.permissions?.query === "function") {
    const permission = await locationPermission();
    if (generation !== started || !prefs.location) return null;
    // Asking again would only repeat the refusal; whatever is known goes along.
    if (permission === "denied") return cachedPlace(prefs);
    // An everyday message never raises a permission dialog. A question that
    // needs the place does, and its reply waits while the dialog is answered
    // (iOS can show two in a row) instead of going out without a place.
    if (permission === "prompt") {
      if (!quick.needed) return cachedPlace(prefs);
      limit = PROMPT_WAIT_MS;
    }
  }
  let timer;
  try {
    const place = await Promise.race([locate(), new Promise((resolve) => {
      timer = setTimeout(() => resolve(cachedPlace(prefs)), limit);
    })]);
    return generation === started && prefs.location ? place : null;
  } catch {
    return generation === started ? cachedPlace(prefs) : null;
  } finally {
    clearTimeout(timer);
  }
}

/* The last known place, for rebuilding a request without waiting. */
export function cachedPlace(prefs) {
  return prefs?.location ? current()?.place ?? null : null;
}

/* At launch, with sharing on and permission already granted, find the place
   in the background so the first message doesn't wait for it. Never raises a
   permission dialog by itself. */
export async function warmPlace(prefs) {
  if (!prefs?.location || !locationSupport()) return;
  if (await locationPermission() !== "granted") return;
  locate().catch(() => {});
}

export function forgetPlace() {
  // Browser geolocation cannot be stopped, but its callbacks lose ownership.
  generation++;
  remember(null);
  pending = null;
  for (const lookup of lookups) lookup.abort();
  lookups.clear();
}
