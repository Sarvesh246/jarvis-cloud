import { createHash } from "node:crypto";
import { get, put, isConflict, storageConfigured } from "./kv-storage.js";

/* Sessions are stateless week-long JWTs, so clearing the cookie on sign-out
   leaves a copied token working. Instead the server remembers when each
   account last signed out, per audience (web or desktop), and refuses tokens
   issued before then. One kv_store row per account and audience; each
   instance re-reads it at most every few seconds. */
const CACHE_MS = 10_000;
const pathFor = (sub, audience) =>
  `auth-epoch/${audience}/${createHash("sha256").update(sub).digest("base64url")}.json`;
const storedEpoch = async result => {
  if (!result) return 0;
  const epoch = (await new Response(result.stream).json()).epoch;
  if (typeof epoch !== "number" || !Number.isFinite(epoch) || epoch < 0)
    throw new Error("Invalid session revocation record.");
  return epoch;
};

export class Revocations {
  constructor(storage = { get, put }, { now = Date.now, enabled = storageConfigured } = {}) {
    this.storage = storage;
    this.now = now;
    this.enabled = enabled;
    this.cache = new Map();
  }

  remember(key, epoch) {
    // A read started before sign-out may finish after it. Never let that
    // stale response lower this instance's revocation boundary.
    const latest = Math.max(epoch, this.cache.get(key)?.epoch || 0);
    this.cache.set(key, { epoch: latest, at: this.now() });
    return latest;
  }

  /* Seconds since the epoch of the last sign-out, or 0. Storage errors throw,
     so a session is refused rather than trusted when the row can't be read. */
  async epoch(sub, audience) {
    if (!this.enabled()) return 0;
    const key = pathFor(sub, audience);
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_MS) return hit.epoch;
    const result = await this.storage.get(key, { access: "private", useCache: false });
    return this.remember(key, await storedEpoch(result));
  }

  async revoke(sub, audience) {
    if (!this.enabled()) return;
    const key = pathFor(sub, audience);
    const epoch = this.now() / 1000;
    // Separate functions can finish sign-outs out of order. Compare-and-swap
    // keeps an older request from restoring sessions the newer one revoked.
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await this.storage.get(key, { access: "private", useCache: false });
      const previous = await storedEpoch(result);
      if (previous >= epoch) { this.remember(key, previous); return; }
      try {
        await this.storage.put(key, JSON.stringify({ epoch }), {
          access: "private", addRandomSuffix: false, allowOverwrite: Boolean(result),
          ...(result ? { ifMatch: result.blob.etag } : {}), contentType: "application/json",
        });
        this.remember(key, epoch);
        return;
      } catch (error) {
        if (!isConflict(error)) throw error;
      }
    }
    throw new Error("Session revocation changed repeatedly. Try signing out again.");
  }
}

export const revocations = new Revocations();
