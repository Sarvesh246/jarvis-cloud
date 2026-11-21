import {
  settings,
  csrfToken,
  sessionUser,
  renewedSessionCookie,
  guestUser,
  json,
  fail,
  HttpError,
} from "../server/security.js";
import usageHandler from "../server/usage-api.js";
import devicesHandler from "../server/devices-api.js";

export default async function handler(req, res) {
  const resource = new URL(req.url, "https://local").searchParams.get("resource");
  if (resource === "usage") return usageHandler(req, res);
  if (resource === "devices") return devicesHandler(req, res);
  try {
    if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
    const cfg = settings();
    const csrf = csrfToken(req, res, cfg);
    const owner = await sessionUser(req, cfg);
    /* Opening Vaelo keeps a signed-in browser signed in: the session only
       lapses after a week away, not a week after the last sign-in. */
    const renewed = await renewedSessionCookie(req, owner, cfg);
    if (renewed) {
      const existing = res.getHeader?.("Set-Cookie");
      res.setHeader("Set-Cookie", [...(existing ? [].concat(existing) : []), renewed]);
    }
    json(res, 200, {
      user: owner || (cfg.secret.length >= 32 ? await guestUser(req, cfg) : null),
      csrf,
      clientId: cfg.clientId,
      configured: !!cfg.clientId && !!cfg.email && cfg.secret.length >= 32,
    });
  } catch (error) {
    fail(res, error);
  }
}
