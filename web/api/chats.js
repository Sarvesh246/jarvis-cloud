import { ChatStore } from "../server/chat-store.js";
import { notifyFeed } from "../server/chat.js";
import { storageConfigured } from "../server/kv-storage.js";
import { settings, authorize, sameOrigin, readJson, json, fail, HttpError } from "../server/security.js";

export default async function handler(req, res) {
  try {
    const cfg = settings();
    const user = await authorize(req, cfg);
    if (!storageConfigured())
      throw new HttpError(503, "Conversation sync is not configured.");
    const store = new ChatStore(user.sub);
    if (req.method === "GET") {
      const url = new URL(req.url, cfg.origin);
      if (url.searchParams.has("id")) {
        json(res, 200, { text: await store.part(url.searchParams.get("id"),
          url.searchParams.get("version"), Number(url.searchParams.get("part"))) });
      } else {
        const result = await store.manifest();
        json(res, 200, result.data);
      }
    } else if (req.method === "POST") {
      sameOrigin(req, cfg);
      const body = await readJson(req, 3_200_000);
      if (body?.action === "part") {
        await store.stage(body);
        json(res, 200, { ok: true });
      } else if (body?.action === "commit") {
        const entry = await store.commit(body);
        await notifyFeed(cfg, user);
        json(res, 200, { entry });
      } else throw new HttpError(400, "Invalid sync request.");
    } else throw new HttpError(405, "Method not allowed.");
  } catch (error) { fail(res, error); }
}
