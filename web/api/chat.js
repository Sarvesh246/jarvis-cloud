import {
  settings,
  authorizeAny,
  sameOrigin,
  readJson,
  fail,
  HttpError,
} from "../server/security.js";
import { LIMITS, chatInput, guestInput, resumeInput, streamChat } from "../server/chat.js";
import { withSelectedWork } from "../server/work-context.js";

/* POST starts a reply and follows it; GET picks a reply back up after the
   last event the page saw. Either way the reply itself runs on the relay. */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST" && req.method !== "GET") throw new HttpError(405, "Method not allowed.");
    const cfg = settings();
    const user = await authorizeAny(req, cfg);
    let input;
    if (req.method === "GET") {
      const query = Object.fromEntries(new URL(req.url, "http://local").searchParams);
      input = resumeInput(query);
    } else {
      sameOrigin(req, cfg);
      input = chatInput(await readJson(req, LIMITS.body), { guest: Boolean(user.guest) });
      input = user.guest ? guestInput(input) : await withSelectedWork(input, user);
    }
    await streamChat(req, res, cfg, user, input);
  } catch (error) {
    if (!res.headersSent) fail(res, error);
    else res.end();
  }
}
