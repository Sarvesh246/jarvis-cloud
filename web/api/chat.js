import {
  settings,
  authorize,
  sameOrigin,
  readJson,
  fail,
  HttpError,
} from "../server/security.js";
import { chatInput, streamChat } from "../server/chat.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
    const cfg = settings();
    const user = await authorize(req, cfg);
    sameOrigin(req, cfg);
    const input = chatInput(await readJson(req));
    await streamChat(req, res, cfg, user, input);
  } catch (error) {
    if (!res.headersSent) fail(res, error);
    else res.end();
  }
}
