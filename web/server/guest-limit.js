import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { AccountRecord } from "./account-record.js";
import { HttpError, signGuest } from "./security.js";

const limits = new AccountRecord("guest-limits", {
  empty: () => ({ hour: 0, count: 0 }),
  check: value => { if (!Number.isInteger(value?.hour) || !Number.isInteger(value.count)) throw new Error("Invalid guest limit."); return value; },
});
export function guestNetwork(req, cfg, now = Date.now()) {
  const address = process.env.VERCEL ? req.headers["x-vercel-forwarded-for"] : req.socket?.remoteAddress;
  const ip = String(address || "").split(",")[0].trim();
  if (!isIP(ip)) throw new HttpError(503, "Guest access is unavailable right now.");
  // One pseudonymous subject per network per day. Minting another token cannot
  // reset the relay allowance; raw addresses are never stored or sent upstream.
  const hex = createHmac("sha256", cfg.secret).update(`${Math.floor(now / 86400000)}:${ip}`).digest("hex").slice(0, 32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export async function issueGuest(req, cfg, store = limits, now = Date.now()) {
  const subject = guestNetwork(req, cfg, now), hour = Math.floor(now / 3600000);
  await store.update(subject, value => {
    const count = value.hour === hour ? value.count : 0;
    if (count >= 10) throw new HttpError(429, "Too many guest sign-ins. Please try again later.");
    return { hour, count: count + 1 };
  });
  return signGuest(cfg, subject);
}
