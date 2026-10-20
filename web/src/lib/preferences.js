/* How this person likes Vaelo to look and behave on this device. Kept in
   local storage: a preference is a convenience, so losing it only means the
   defaults come back. public/prefs.js applies the same attributes before the
   first paint, so a chosen theme never flashes the other one. */

import { DESKTOP, desktopTitleBar } from "./desktop.js";
export const PREFS_KEY = "vaelo-preferences";

export const DEFAULTS = {
  theme: "system",
  text: "standard",
  presentation: "adaptive",
  motion: "system",
  notify: false,
  location: false,
  /* Look and feel */
  accent: "gilt",
  line: "comfortable",
  density: "comfortable",
  grain: true,
  /* Replies and writing */
  sendKey: "enter",
  greet: true,
  steps: false,
  /* Quiet hours: notifications wait until the window ends */
  quiet: false,
  quietFrom: "22:00",
  quietTo: "07:00",
  /* Voice */
  dictLang: "auto",
  readAloud: false,
  voice: "",
  rate: 1,
  /* How long conversations are kept on this device, in days; 0 keeps them */
  keep: 0,
  /* What Vaelo should know about you, sent with each message */
  callMe: "",
  about: "",
};

const ALLOWED = {
  theme: ["system", "light", "dark"],
  text: ["standard", "large"],
  presentation: ["adaptive", "minimal"],
  motion: ["system", "reduce"],
  accent: ["gilt", "sage", "clay", "ink"],
  line: ["narrow", "comfortable", "wide"],
  density: ["compact", "comfortable"],
  sendKey: ["enter", "mod-enter"],
  keep: [0, 30, 90, 365],
};

const FLAGS = ["notify", "location", "grain", "greet", "steps", "quiet", "readAloud"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function cleanPrefs(value) {
  const prefs = { ...DEFAULTS };
  if (!value || typeof value !== "object") return prefs;
  for (const [key, options] of Object.entries(ALLOWED))
    if (options.includes(value[key])) prefs[key] = value[key];
  for (const key of FLAGS) prefs[key] = typeof value[key] === "boolean" ? value[key] : DEFAULTS[key];
  for (const key of ["quietFrom", "quietTo"]) if (TIME.test(value[key])) prefs[key] = value[key];
  if (typeof value.dictLang === "string" && /^(auto|[a-z]{2}(-[A-Z]{2})?)$/.test(value.dictLang)) prefs.dictLang = value.dictLang;
  if (typeof value.voice === "string") prefs.voice = value.voice.slice(0, 120);
  if (typeof value.rate === "number" && value.rate >= 0.75 && value.rate <= 1.5) prefs.rate = Math.round(value.rate * 20) / 20;
  if (typeof value.callMe === "string") prefs.callMe = value.callMe.trim().slice(0, 40);
  if (typeof value.about === "string") prefs.about = value.about.slice(0, 600);
  return prefs;
}

export function readPrefs() {
  try {
    return cleanPrefs(JSON.parse(localStorage.getItem(PREFS_KEY) || "null"));
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* the preference still holds for this visit */
  }
}

const BARS = { light: "#f7f2ea", dark: "#16110f" };
/* The window title on the desktop app, in the muted ink of each paper */
const BAR_INK = { light: "#5f524a", dark: "#bcac9a" };
const systemDark = typeof matchMedia === "undefined" ? null : matchMedia("(prefers-color-scheme: dark)");
let lastPrefs = null;
systemDark?.addEventListener?.("change", () => lastPrefs?.theme === "system" && paintTitleBar(lastPrefs));

function paintTitleBar(prefs) {
  const scheme = prefs.theme === "system" ? (systemDark?.matches ? "dark" : "light") : prefs.theme;
  desktopTitleBar(scheme === "dark", BARS[scheme], BAR_INK[scheme]);
}

export function applyPrefs(prefs, root = document.documentElement) {
  const set = (name, value, fallback) => {
    if (value === fallback) delete root.dataset[name];
    else root.dataset[name] = value;
  };
  set("theme", prefs.theme, "system");
  set("text", prefs.text, "standard");
  set("motion", prefs.motion, "system");
  set("presentation", prefs.presentation, "adaptive");
  set("accent", prefs.accent, "gilt");
  set("line", prefs.line, "comfortable");
  set("density", prefs.density, "comfortable");
  set("grain", prefs.grain ? "on" : "off", "on");
  /* The browser and status bar follow the chosen paper, not only the system */
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const scheme = meta.media.includes("dark") ? "dark" : "light";
    meta.content = BARS[prefs.theme === "system" ? scheme : prefs.theme];
  }
  if (DESKTOP) {
    lastPrefs = prefs;
    paintTitleBar(prefs);
  }
}

/* Whether this browser can tell you a reply is ready while you're away.
   On an iPhone that needs Vaelo installed to the home screen first. */
export function notifySupport() {
  if (DESKTOP) return "available";
  if (typeof window === "undefined") return "none";
  if ("Notification" in window && "serviceWorker" in navigator) return "available";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return ios ? "install" : "none";
}

/* Whether a notification should hold back right now, because it is inside the
   person's quiet hours. The window may cross midnight (22:00 to 07:00). */
export function inQuietHours(prefs, now = new Date()) {
  if (!prefs?.quiet) return false;
  const minutes = (text) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
  const at = now.getHours() * 60 + now.getMinutes();
  const from = minutes(prefs.quietFrom);
  const to = minutes(prefs.quietTo);
  if (from === to) return false;
  return from < to ? at >= from && at < to : at >= from || at < to;
}

/* What Vaelo may know about the person, as one short, bounded record. Empty
   fields are left out, so nothing is sent unless it was written. */
export function profileOf(prefs) {
  const call = String(prefs?.callMe || "").trim().slice(0, 40);
  const about = String(prefs?.about || "").trim().slice(0, 600);
  return call || about ? { ...(call && { call }), ...(about && { about }) } : undefined;
}
