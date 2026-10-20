import { devices as registry, DEVICE_ID } from "./devices.js";
import { revocations } from "./revocation.js";
import { settings, authorize, deviceOf, sameOrigin, readJson, json, fail, HttpError } from "./security.js";

/* Settings → Devices. Lists where the owner is signed in and ends one session,
   or every session but this one. It lives behind /api/session because the
   Hobby plan allows only twelve functions. */
export function createDevicesHandler({ configuration = settings, devices = registry, epochs = revocations } = {}) {
  return async function handler(req, res) {
    try {
      const cfg = configuration();
      const user = await authorize(req, cfg);
      const current = deviceOf(req) || null;
      if (!devices.enabled()) {
        if (req.method === "GET") return json(res, 200, { available: false, current, devices: [] });
        throw new HttpError(503, "Device management is not configured.");
      }
      if (req.method === "GET") {
        // A full sign-out (the Sign out button) ends every session of its kind;
        // those entries are already dead, so they are not listed.
        const ended = {
          "jarvis-web": await (cfg.revocations || epochs).epoch(user.sub, "jarvis-web"),
          "vaelo-desktop": await (cfg.revocations || epochs).epoch(user.sub, "vaelo-desktop"),
        };
        const list = (await devices.list(user.sub))
          .filter(entry => entry.issued > ended[entry.audience])
          .sort((a, b) => (b.id === current) - (a.id === current) || b.seen - a.seen)
          .map(entry => ({
            id: entry.id, label: entry.label, kind: entry.audience === "vaelo-desktop" ? "desktop" : "web",
            created: Math.round(entry.issued * 1000), seen: entry.seen, current: entry.id === current,
          }));
        return json(res, 200, { available: true, current, devices: list });
      }
      if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
      sameOrigin(req, cfg);
      const body = await readJson(req, 2000);
      // A session from before devices were tracked has no entry to keep, so it
      // can only sign itself out. It must sign in again to manage the others.
      if (!current) throw new HttpError(409, "Sign out and back in on this device first, then manage your devices.");
      if (body?.action === "revoke") {
        if (!DEVICE_ID.test(body.id || "")) throw new HttpError(400, "Choose a device.");
        if (body.id === current) throw new HttpError(400, "Use Sign out to leave this device.");
        await devices.revoke(user.sub, body.id);
      } else if (body?.action === "revoke-others") {
        await devices.revokeOthers(user.sub, current);
      } else throw new HttpError(400, "Invalid device request.");
      json(res, 200, { ok: true });
    } catch (error) { fail(res, error); }
  };
}
export default createDevicesHandler();
