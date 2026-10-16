import {
  settings,
  sameOrigin,
  sessionUser,
  sessionAudience,
  cookie,
  cookieNames,
  json,
  fail,
  HttpError,
} from "../server/security.js";
import { revocations } from "../server/revocation.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
    const cfg = settings();
    const user = await sessionUser(req, cfg);
    sameOrigin(req, cfg);
    res.setHeader("Set-Cookie", [
      cookie(cookieNames(cfg).session, "", cfg, 0),
      cookie(cookieNames(cfg).guest, "", cfg, 0),
    ]);
    // Clearing the cookie isn't enough: a copy of the token would still work for
    // the rest of its week. Every session of this kind issued until now ends here.
    if (user) await (cfg.revocations || revocations).revoke(user.sub, sessionAudience(req));
    json(res, 200, { ok: true });
  } catch (error) {
    fail(res, error);
  }
}
