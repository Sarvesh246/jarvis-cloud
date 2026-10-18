import {
  settings,
  csrfToken,
  sessionUser,
  guestUser,
  json,
  fail,
  HttpError,
} from "../server/security.js";
import usageHandler from "../server/usage-api.js";

export default async function handler(req, res) {
  if (new URL(req.url, "https://local").searchParams.get("resource") === "usage")
    return usageHandler(req, res);
  try {
    if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
    const cfg = settings();
    const csrf = csrfToken(req, res, cfg);
    json(res, 200, {
      user: (await sessionUser(req, cfg)) || (cfg.secret.length >= 32 ? await guestUser(req, cfg) : null),
      csrf,
      clientId: cfg.clientId,
      configured: !!cfg.clientId && !!cfg.email && cfg.secret.length >= 32,
    });
  } catch (error) {
    fail(res, error);
  }
}
