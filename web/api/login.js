import {
  settings,
  sameOrigin,
  readJson,
  verifyGoogle,
  signSession,
  cookieNames,
  cookie,
  json,
  fail,
  HttpError,
} from "../server/security.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
    const cfg = settings();
    sameOrigin(req, cfg);
    const body = await readJson(req, 12000);
    if (typeof body?.credential !== "string")
      throw new HttpError(400, "Missing Google credential.");
    const user = await verifyGoogle(
      body.credential,
      req.headers["x-csrf-token"],
      cfg,
    );
    res.setHeader(
      "Set-Cookie",
      cookie(cookieNames(cfg).session, await signSession(user, cfg), cfg),
    );
    json(res, 200, { user });
  } catch (error) {
    fail(res, error);
  }
}
