import { isTauri, invoke } from "@tauri-apps/api/core";
import { fetch as nativeFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { createDesktopFetch, CLOUD_ORIGIN } from "./desktop-transport.js";

export const DESKTOP = isTauri();
export const STORE_BUILD = import.meta.env?.VITE_VAELO_STORE === "1";
let token = null;
const browserFetch = globalThis.fetch.bind(globalThis);

// Keep the existing API callers, including streamed responses and AbortSignal,
// on one transport. Credentials are scoped to this fixed HTTPS API only.
export function installDesktopTransport() {
  if (!DESKTOP) return;
  globalThis.fetch = createDesktopFetch({ nativeFetch, browserFetch,
    loadToken: async () => token ??= await invoke("session_token"),
    clearToken: async (expired) => {
      if (token !== expired) return;
      token = null;
      await invoke("clear_session");
    },
  });
  document.addEventListener("click", event => {
    const anchor = event.target.closest?.("a[href]");
    if (!anchor || anchor.hasAttribute("download")) return;
    const url = new URL(anchor.href, location.href);
    if (["https:", "http:", "mailto:"].includes(url.protocol) && url.origin !== location.origin) {
      event.preventDefault();
      openUrl(url.href).catch(() => {});
    }
  });
}

/* Matches the native title bar to Vaelo's paper. Cosmetic, so a failure
   (an older Windows, another platform) simply leaves the system bar. */
export function desktopTitleBar(dark, caption, text) {
  if (DESKTOP) invoke("title_bar", { dark, caption, text }).catch(() => {});
}

export async function desktopSignIn() {
  token = null;
  await invoke("begin_sign_in");
  token = await invoke("session_token");
}

/* A guest has no saved sign-in: the token lives in memory only, so closing the
   app ends the session and nothing touches the system credential store. */
export async function desktopGuest() {
  let response;
  try {
    response = await nativeFetch(`${CLOUD_ORIGIN}/api/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guest: true, desktop: true }),
      connectTimeout: 30_000, maxRedirections: 0,
    });
  } catch {
    throw new Error("Could not reach Vaelo. Check your internet connection.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.token !== "string")
    throw new Error(data.error || "Guest mode isn't available right now.");
  token = data.token;
}

export function desktopLeaveGuest() {
  token = null;
}

export async function desktopSignOut() {
  await invoke("clear_session");
  token = null;
}

export const cancelDesktopSignIn = () => invoke("cancel_sign_in");

export async function saveDesktopFile(name, text) {
  const path = await save({ defaultPath: name });
  if (!path) return false;
  await writeFile(path, new TextEncoder().encode(text));
  return true;
}

export async function copyText(text) {
  if (DESKTOP) return writeText(text);
  return navigator.clipboard.writeText(text);
}

export async function allowNotifications() {
  if (DESKTOP) return await isPermissionGranted() || await requestPermission() === "granted";
  return Notification.permission === "granted" || await Notification.requestPermission() === "granted";
}

export async function desktopNotification(title, body) {
  if (STORE_BUILD) return invoke("store_notification", { title, body });
  if (await isPermissionGranted()) sendNotification({ title, body });
}
