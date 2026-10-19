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
};

const ALLOWED = {
  theme: ["system", "light", "dark"],
  text: ["standard", "large"],
  presentation: ["adaptive", "minimal"],
  motion: ["system", "reduce"],
};

export function cleanPrefs(value) {
  const prefs = { ...DEFAULTS };
  if (!value || typeof value !== "object") return prefs;
  for (const [key, options] of Object.entries(ALLOWED))
    if (options.includes(value[key])) prefs[key] = value[key];
  prefs.notify = value.notify === true;
  prefs.location = value.location === true;
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
