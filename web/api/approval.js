import {
  settings,
  authorize,
  sameOrigin,
  readJson,
  json,
  fail,
  HttpError,
} from "../server/security.js";
import { answerApproval, approvalInput } from "../server/chat.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
    const cfg = settings();
    await authorize(req, cfg);
    sameOrigin(req, cfg);
    const input = approvalInput(await readJson(req, 4000));
    json(res, 200, await answerApproval(cfg, input));
  } catch (error) {
    fail(
      res,
      error instanceof HttpError ? error : new HttpError(503, "Vaelo couldn’t record your answer."),
    );
  }
}
