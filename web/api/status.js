import {
  settings,
  authorize,
  json,
  fail,
  HttpError,
} from "../server/security.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
    const cfg = settings();
    await authorize(req, cfg);
    if (!cfg.backend.startsWith("https://") || !cfg.apiKey)
      throw new HttpError(503, "Cloud connection is not configured.");
    const response = await fetch(`${cfg.backend.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(65000),
    });
    const result = await response.json();
    json(res, 200, {
      ready: response.ok && result.status === "ok",
      status: result.status || "unavailable",
    });
  } catch (error) {
    fail(
      res,
      error instanceof HttpError
        ? error
        : new HttpError(503, "Jarvis is starting or temporarily unavailable."),
    );
  }
}
