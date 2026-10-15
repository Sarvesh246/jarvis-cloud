import { settings, authorize, fail, HttpError } from "../server/security.js";
import { feedInput, followFeed } from "../server/chat.js";

/* One open request per signed-in device, telling it the moment a
   conversation is saved or a reply starts or ends anywhere on the account. */
export default async function handler(req, res) {
  try {
    if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
    const cfg = settings();
    const user = await authorize(req, cfg);
    const query = Object.fromEntries(new URL(req.url, "http://local").searchParams);
    await followFeed(req, res, cfg, user, feedInput(query));
  } catch (error) {
    if (!res.headersSent) fail(res, error);
    else res.end();
  }
}
