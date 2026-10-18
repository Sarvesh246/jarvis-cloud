import { createHmac, timingSafeEqual } from "node:crypto";
import { UsageStore, validateUsage } from "../server/usage-store.js";
import { readJson, json, fail, HttpError } from "../server/security.js";

export function usageAuthorized(header, key) {
  if (!key || key.length < 32 || typeof header !== "string") return false;
  const actual = Buffer.from(header), expected = Buffer.from(`Bearer ${key}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
let store;
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!["GET", "POST"].includes(req.method)) throw new HttpError(405, "Method not allowed.");
    const ingest = process.env.USAGE_INGEST_KEY || process.env.JARVIS_API_KEY;
    const key = req.method === "POST" ? ingest : (process.env.USAGE_READ_KEY ||
      (ingest ? createHmac("sha256", ingest).update("usage-dashboard-read-v1").digest("hex") : ""));
    if (!usageAuthorized(req.headers.authorization, key)) throw new HttpError(401, "Authentication required.");
    store ??= new UsageStore();
    if (req.method === "POST") {
      const body = await readJson(req, 4096);
      try { validateUsage(body); } catch { throw new HttpError(400, "Invalid usage event."); }
      await store.record(body);
      return json(res, 200, { ok: true });
    }
    const month = new URL(req.url, "https://local").searchParams.get("month") || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, "Invalid usage month.");
    json(res, 200, await store.summary(month));
  } catch (error) { fail(res, error); }
}
