import {
  settings,
  authorizeAny,
  json,
  fail,
  HttpError,
} from "../server/security.js";
import { probeBackend, wakeBackend } from "../server/backend-readiness.js";

/* Asking whether Vaelo is ready also starts waking it, so by the time a
   message is written the cloud is usually up. A sleeping or booting server
   is "starting", not unavailable; the page polls until it is ready. */
export default async function handler(req, res) {
  try {
    if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
    const cfg = settings();
    await authorizeAny(req, cfg);
    if (!cfg.backend.startsWith("https://") || !cfg.apiKey)
      throw new HttpError(503, "Cloud connection is not configured.");
    const revision=/^[a-f0-9]{40}$/.test(process.env.VERCEL_GIT_COMMIT_SHA || '') ? process.env.VERCEL_GIT_COMMIT_SHA : null;
    if (await probeBackend(cfg.backend)) return json(res, 200, { ready: true, status: "ok", revision });
    await wakeBackend(cfg.backend);
    json(res, 200, { ready: false, status: "starting" });
  } catch (error) {
    fail(
      res,
      error instanceof HttpError
        ? error
        : new HttpError(503, "Vaelo is starting or temporarily unavailable."),
    );
  }
}
