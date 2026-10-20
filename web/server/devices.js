import { randomBytes } from "node:crypto";
import { storageConfigured } from "./kv-storage.js";
import { AccountRecord } from "./account-record.js";

/* Sessions are week-long JWTs, so a token alone can't be switched off. When
   storage is configured, every owner sign-in is also written to a small
   per-account registry and its token carries that entry's id ("did"). A token
   whose entry has been removed is refused, which is what lets Settings sign
   one device (or every other device) out. Reading the registry fails closed:
   if it can't be read, the session is refused, never trusted. */
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const MAX_DEVICES = 20;
const CACHE_MS = 10_000;
const TOUCH_MS = 15 * 60 * 1000;
export const DEVICE_ID = /^[A-Za-z0-9_-]{16}$/;

const blank = () => ({ devices: {}, legacyBefore: 0 });
const check = value => {
  if (!value || typeof value !== "object" || !value.devices || typeof value.devices !== "object" ||
      Array.isArray(value.devices) || !Number.isFinite(value.legacyBefore) || value.legacyBefore < 0)
    throw new Error("Invalid device record.");
  for (const [id, entry] of Object.entries(value.devices))
    if (!DEVICE_ID.test(id) || typeof entry?.label !== "string" || !["jarvis-web", "vaelo-desktop"].includes(entry.audience) ||
        !Number.isFinite(entry.issued) || !Number.isFinite(entry.seen))
      throw new Error("Invalid device record.");
  return value;
};

/* A readable name from the browser's user agent. Only the name is kept, never
   the user agent itself. */
export function deviceLabel(userAgent = "", audience = "jarvis-web") {
  const ua = String(userAgent).slice(0, 400);
  const system = /Windows/.test(ua) ? "Windows" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "";
  if (audience === "vaelo-desktop") return system ? `${system} app` : "Desktop app";
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\/|FxiOS\//.test(ua) ? "Firefox"
    : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return browser && system ? `${browser} on ${system}` : browser || system || "Web browser";
}

export class DeviceRegistry {
  constructor(storage, { now = Date.now, enabled = storageConfigured } = {}) {
    this.record = new AccountRecord("devices", { empty: blank, check }, storage);
    this.now = now;
    this.enabled = enabled;
    this.cache = new Map();
  }

  remember(sub, data) {
    this.cache.set(sub, { data, at: this.now() });
    return data;
  }

  /* Entries older than a token can live are dead weight. */
  live(data) {
    const cutoff = this.now() / 1000 - SESSION_SECONDS;
    return Object.fromEntries(Object.entries(data.devices).filter(([, entry]) => entry.issued > cutoff));
  }

  async register(sub, audience, label) {
    if (!this.enabled()) return undefined;
    const id = randomBytes(12).toString("base64url");
    const data = await this.record.update(sub, record => {
      const devices = this.live(record);
      devices[id] = { label: String(label || "Unknown device").slice(0, 60), audience, issued: this.now() / 1000, seen: this.now() };
      // Past the cap the longest-idle devices drop off, which signs them out.
      const extra = Object.entries(devices).sort((a, b) => a[1].seen - b[1].seen).slice(0, Math.max(0, Object.keys(devices).length - MAX_DEVICES));
      for (const [old] of extra) delete devices[old];
      return { ...record, devices };
    });
    this.remember(sub, data);
    return id;
  }

  /* True when this token may be used. Storage errors throw. A token minted
     before the registry existed has no id; it stays valid until it expires
     unless "sign out other devices" has been used since it was issued. */
  async verify(sub, audience, id, issuedAt) {
    if (!this.enabled()) return true;
    let hit = this.cache.get(sub);
    if (!hit || this.now() - hit.at >= CACHE_MS) hit = { data: this.remember(sub, (await this.record.read(sub)).data) };
    if (id === undefined) return issuedAt > hit.data.legacyBefore;
    const entry = hit.data.devices[id];
    if (!entry || entry.audience !== audience) return false;
    if (this.now() - entry.seen > TOUCH_MS) await this.touch(sub, id);
    return true;
  }

  // Last-seen is a courtesy; failing to record it never ends a session.
  async touch(sub, id) {
    try {
      this.remember(sub, await this.record.update(sub, record => {
        if (!record.devices[id]) return undefined;
        record.devices[id].seen = this.now();
        return record;
      }));
    } catch { /* keep the session */ }
  }

  async list(sub) {
    const { data } = await this.record.read(sub);
    return Object.entries(this.live(data)).map(([id, entry]) => ({ id, ...entry }));
  }

  async revoke(sub, id) {
    this.remember(sub, await this.record.update(sub, record => {
      if (!record.devices[id]) return undefined;
      delete record.devices[id];
      return record;
    }));
  }

  async revokeOthers(sub, keep) {
    this.remember(sub, await this.record.update(sub, record => ({
      devices: record.devices[keep] ? { [keep]: record.devices[keep] } : {},
      legacyBefore: Math.max(record.legacyBefore, this.now() / 1000),
    })));
  }
}

export const devices = new DeviceRegistry();
