import {
  settings,
  sameOrigin,
  readJson,
  verifyGoogle,
  signSession,
  cookieNames,
  cookie,
  signGuest,
  guestCookie,
  json,
  fail,
  HttpError,
} from "../server/security.js";
import { deviceLabel } from "../server/devices.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
    const cfg = settings();
    const body = await readJson(req, 12000);
    /* "Continue as guest" shares this route: the Hobby plan allows only twelve
       functions, and a guest is just another way of starting a session. The
       desktop app has no cookies, so it asks for the token itself. Nothing is
       set or read for that request, so there is nothing for CSRF to protect. */
    if (body?.guest === true && body.desktop === true)
      return json(res, 200, { guest: true, token: await signGuest(cfg) });
    sameOrigin(req, cfg);
    if (body?.guest === true) {
      res.setHeader("Set-Cookie", guestCookie(await signGuest(cfg), cfg));
      return json(res, 200, { guest: true });
    }
    if (typeof body?.credential !== "string")
      throw new HttpError(400, "Missing Google credential.");
    const user = await verifyGoogle(
      body.credential,
      req.headers["x-csrf-token"],
      cfg,
    );
    res.setHeader(
      "Set-Cookie",
      cookie(cookieNames(cfg).session, await signSession(user, cfg, "jarvis-web", {
        label: deviceLabel(req.headers["user-agent"], "jarvis-web"),
      }), cfg),
    );
    json(res, 200, { user });
  } catch (error) {
    fail(res, error);
  }
}
