import { DesktopAuth } from "../server/desktop-auth.js";
import { settings, authorize, sameOrigin, readJson, json, fail, HttpError } from "../server/security.js";

export function createDesktopAuthHandler({ configuration = settings, store = new DesktopAuth() } = {}) {
  return async function handler(req, res) {
    try {
      if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
      const cfg = configuration();
      const body = await readJson(req, 4000);
      if (body?.action === "authorize") {
        const user = await authorize(req, cfg);
        // Authorization belongs to the browser's authenticated website session.
        if (req.headers.authorization) throw new HttpError(403, "Use your browser to sign in.");
        sameOrigin(req, cfg);
        json(res, 200, { code: await store.grant(user, body.challenge) });
      } else if (body?.action === "exchange") {
        json(res, 200, { token: await store.exchange(body.code, body.verifier, cfg) });
      } else throw new HttpError(400, "Invalid sign-in request.");
    } catch (error) { fail(res, error); }
  };
}
export default createDesktopAuthHandler();
