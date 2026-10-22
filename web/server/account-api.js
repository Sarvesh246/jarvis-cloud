import { AccountRecord } from "./account-record.js";
import { memories } from "./memory.js";
import { HttpError, sameOrigin, readJson, json } from "./security.js";
import { validRetention } from "../shared/retention.js";
import { verifyMemoryPermission } from './memory-permission.js';

/* Memory and the retention choice, behind /api/chats (?resource=memory or
   ?resource=retention) because the Hobby plan allows only twelve functions.
   The caller has already signed the owner in and checked storage. */
const blank = () => ({ days: 0, confirmed: 0 });
const check = value => {
  if (!value || typeof value !== "object" || !validRetention(value.days) || !Number.isFinite(value.confirmed))
    throw new Error("Invalid retention record.");
  return value;
};
export const retentionRecord = new AccountRecord("retention", { empty: blank, check });

export async function memoryApi(req, res, cfg, user, store = memories) {
  const view = data => ({ enabled: data.enabled, recallEnabled:Boolean(data.recallEnabled), items: [...data.items].sort((a, b) => b.updated - a.updated) });
  if (req.method === "GET") return json(res, 200, view(await store.read(user.sub)));
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  sameOrigin(req, cfg);
  const body = await readJson(req, 8000);
  if (body?.action === "add" || body?.action === "note") {
    const texts = body.action === "add" ? [body.text] : body.notes;
    if (!Array.isArray(texts) || !texts.length || texts.length > 10) throw new HttpError(400, "Invalid note.");
    if (body.action === 'note' && !await verifyMemoryPermission(cfg, user.sub, body.permission))
      throw new HttpError(403, 'This reply is not allowed to save memories.');
    const result = await store.add(user.sub, texts, body.action === "add" ? "you" : "vaelo");
    if (body.action === "add" && !result.added.length)
      throw new HttpError(409, result.full ? "Memory is full. Delete a note to make room." : "You already have that note.");
    return json(res, 200, { ...view(result), saved: result.added, full: result.full > 0 });
  }
  if (body?.action === "edit") return json(res, 200, view(await store.edit(user.sub, String(body.id), body.text)));
  if (body?.action === "remove") return json(res, 200, view(await store.remove(user.sub, String(body.id))));
  if (body?.action === "enable" && typeof body.enabled === "boolean")
    return json(res, 200, view(await store.setEnabled(user.sub, body.enabled)));
  if (body?.action === 'recall' && typeof body.enabled === 'boolean')
    return json(res,200,view(await store.setRecall(user.sub,body.enabled)));
  throw new HttpError(400, "Invalid memory request.");
}

export async function retentionApi(req, res, cfg, user, record = retentionRecord, now = Date.now) {
  if (req.method === "GET") {
    const { days } = (await record.read(user.sub)).data;
    // The server's clock, so one device with a wrong clock can't expire everything.
    return json(res, 200, { days, now: now() });
  }
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  sameOrigin(req, cfg);
  const body = await readJson(req, 2000);
  if (!validRetention(body?.days)) throw new HttpError(400, "Choose 30, 90 or 365 days, or keep everything.");
  if (body.days > 0 && body.confirm !== true)
    throw new HttpError(400, "Confirm first: older conversations are deleted from every device and cannot be brought back.");
  await record.update(user.sub, () => ({ days: body.days, confirmed: body.days > 0 ? now() : 0 }));
  json(res, 200, { days: body.days, now: now() });
}
