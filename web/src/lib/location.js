/* Where this person is, only when they switched it on in Settings. The
   browser asks permission itself. Coordinates are rounded to two decimals
   (about a kilometre) before they leave this module, and the nearest city is
   looked up once so a question like "weather today" can be searched by name. */

const FRESH_MS = 30 * 60 * 1000;
const GEOCODER = "https://api.bigdatacloud.net/data/reverse-geocode-client";
let cached = null;
let pending = null;

const round = (n) => Math.round(n * 100) / 100;

export function locationSupport() {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

function position() {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      maximumAge: 10 * 60 * 1000,
      timeout: 10000,
    }),
  );
}

async function cityOf(lat, lon) {
  try {
    const response = await fetch(`${GEOCODER}?latitude=${lat}&longitude=${lon}&localityLanguage=en`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return {};
    const data = await response.json();
    const clean = (value) => (typeof value === "string" ? value.trim().slice(0, 80) : "");
    return {
      city: clean(data.city || data.locality),
      region: clean(data.principalSubdivision),
      country: clean(data.countryName),
    };
  } catch {
    return {};
  }
}

/* Resolves to { lat, lon, tz, city?, region?, country? }, or rejects with the
   browser's error (code 1 means permission was refused). */
export function locate({ force = false } = {}) {
  if (!locationSupport()) return Promise.reject(new Error("unsupported"));
  if (!force && cached && Date.now() - cached.at < FRESH_MS) return Promise.resolve(cached.place);
  pending ??= position()
    .then(async ({ coords }) => {
      const lat = round(coords.latitude);
      const lon = round(coords.longitude);
      const place = {
        lat,
        lon,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(await cityOf(lat, lon)),
      };
      cached = { place, at: Date.now() };
      return place;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/* What a request carries right now: nothing unless switched on, never waits
   long, and never fails a reply because location was unavailable. */
export async function placeFor(prefs) {
  if (!prefs?.location) return null;
  try {
    return await Promise.race([locate(), new Promise((resolve) => setTimeout(resolve, 3500, null))]);
  } catch {
    return null;
  }
}

/* The last known place, for rebuilding a request without waiting. */
export function cachedPlace(prefs) {
  return prefs?.location && cached ? cached.place : null;
}

export function forgetPlace() {
  cached = null;
}
