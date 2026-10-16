import {
  settings,
  authorizeAny,
  sameOrigin,
  readJson,
  json,
  fail,
  HttpError,
} from "../server/security.js";
import { resumeInput, stopRun } from "../server/chat.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
    const cfg = settings();
    const user = await authorizeAny(req, cfg);
    sameOrigin(req, cfg);
    const { runId } = resumeInput({ run: (await readJson(req, 1000))?.runId });
    json(res, 200, await stopRun(cfg, user, runId));
  } catch (error) {
    fail(res, error instanceof HttpError ? error : new HttpError(503, "Vaelo couldn’t stop that reply."));
  }
}
