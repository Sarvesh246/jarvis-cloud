import {
  settings,
  sameOrigin,
  cookie,
  cookieNames,
  json,
  fail,
  HttpError,
} from "../server/security.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
    const cfg = settings();
    sameOrigin(req, cfg);
    res.setHeader("Set-Cookie", cookie(cookieNames(cfg).session, "", cfg, 0));
    json(res, 200, { ok: true });
  } catch (error) {
    fail(res, error);
  }
}
