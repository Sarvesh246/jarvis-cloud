import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { get, put, del } from "@vercel/blob";
import { HttpError, signSession } from "./security.js";

const digest = value => createHash("sha256").update(value).digest("base64url");
const validProof = value => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const pathFor = code => `desktop-signin/${digest(code)}.json`;

// Browser cookies never leave the browser. A short-lived, one-use grant is
// bound to a verifier held by the native application (PKCE S256).
export class DesktopAuth {
  constructor(storage = { get, put, del }, now = Date.now) {
    this.storage = storage;
    this.now = now;
  }
  async grant(user, challenge) {
    if (!validProof(challenge)) throw new HttpError(400, "Invalid sign-in challenge.");
    const code = randomBytes(32).toString("base64url");
    await this.storage.put(pathFor(code), JSON.stringify({ user, challenge, expires: this.now() + 60_000 }), {
      access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/json",
    });
    return code;
  }
  async exchange(code, verifier, cfg) {
    if (!validProof(code) || !validProof(verifier)) throw new HttpError(400, "Invalid sign-in return.");
    const path = pathFor(code);
    const result = await this.storage.get(path, { access: "private", useCache: false });
    if (!result || result.statusCode === 304) throw new HttpError(401, "That sign-in expired. Try again.");
    const data = await new Response(result.stream).json();
    if (data.used || data.expires < this.now() || !validProof(data.challenge) ||
        !timingSafeEqual(Buffer.from(data.challenge), Buffer.from(digest(verifier))))
      throw new HttpError(401, "That sign-in expired or could not be verified. Try again.");
    if (!cfg.email || data.user?.email !== cfg.email) throw new HttpError(403, "This Vaelo workspace is private.");
    try {
      // Conditional replacement admits exactly one exchange across instances.
      await this.storage.put(path, JSON.stringify({ used: true }), {
        access: "private", addRandomSuffix: false, allowOverwrite: true,
        ifMatch: result.blob.etag, contentType: "application/json",
      });
    } catch { throw new HttpError(401, "That sign-in was already used. Try again."); }
    await this.storage.del(path).catch(() => {});
    return signSession(data.user, cfg, "vaelo-desktop");
  }
}
