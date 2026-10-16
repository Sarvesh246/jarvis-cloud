import {
  settings,
  sameOrigin,
  signGuest,
  guestCookie,
  json,
  fail,
  HttpError,
} from "../server/security.js";

/* "Continue as guest": a throwaway session that can chat and nothing else.
   Nothing is saved on the server and replies run without tools. */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
    const cfg = settings();
    sameOrigin(req, cfg);
    res.setHeader("Set-Cookie", guestCookie(await signGuest(cfg), cfg));
    json(res, 200, { ok: true });
  } catch (error) {
    fail(res, error);
  }
}
