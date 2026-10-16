import { createHash } from "node:crypto";
import { get, put, storageConfigured } from "./kv-storage.js";

/* Sessions are stateless week-long JWTs, so clearing the cookie on sign-out
   leaves a copied token working. Instead the server remembers when each
   account last signed out, per audience (web or desktop), and refuses tokens
   issued before then. One kv_store row per account and audience; each
   instance re-reads it at most every few seconds. */
const CACHE_MS = 10_000;
const pathFor = (sub, audience) =>
  `auth-epoch/${audience}/${createHash("sha256").update(sub).digest("base64url")}.json`;

export class Revocations {
  constructor(storage = { get, put }, { now = Date.now, enabled = storageConfigured } = {}) {
    this.storage = storage;
    this.now = now;
    this.enabled = enabled;
    this.cache = new Map();
  }

  /* Seconds since the epoch of the last sign-out, or 0. Storage errors throw,
     so a session is refused rather than trusted when the row can't be read. */
  async epoch(sub, audience) {
    if (!this.enabled()) return 0;
    const key = pathFor(sub, audience);
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_MS) return hit.epoch;
    const result = await this.storage.get(key, { access: "private", useCache: false });
    const epoch = result && result.statusCode !== 304
      ? Number((await new Response(result.stream).json()).epoch) || 0
      : 0;
    this.cache.set(key, { epoch, at: this.now() });
    return epoch;
  }

  async revoke(sub, audience) {
    if (!this.enabled()) return;
    const key = pathFor(sub, audience);
    const epoch = this.now() / 1000;
    await this.storage.put(key, JSON.stringify({ epoch }), {
      access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json",
    });
    this.cache.set(key, { epoch, at: this.now() });
  }
}

export const revocations = new Revocations();
