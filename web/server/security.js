import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify, createRemoteJWKSet } from "jose";
import { revocations } from "./revocation.js";
import { devices, deviceLabel, DEVICE_ID } from "./devices.js";
import { HttpError } from "./http-error.js";
export { HttpError };

const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const duration = 7 * 24 * 60 * 60;
const desktopAuth = Symbol("verified desktop session");
const currentDevice = Symbol("device behind this session");
export const deviceOf = (req) => req[currentDevice];

export function settings(env = process.env) {
  const origin = env.APP_ORIGIN || "https://vaelochat.vercel.app";
  return {
    origin,
    secure: origin.startsWith("https:"),
    clientId: env.GOOGLE_CLIENT_ID || "",
    email: (env.ALLOWED_EMAIL || "").toLowerCase(),
    secret: env.SESSION_SECRET || "",
    backend: env.JARVIS_API_URL || "",
    apiKey: env.JARVIS_API_KEY || "",
  };
}

export function cookieNames(cfg) {
  const prefix = cfg.secure ? "__Host-" : "";
  return {
    session: `${prefix}jarvis-session`,
    csrf: `${prefix}jarvis-csrf`,
    guest: `${prefix}jarvis-guest`,
  };
}

export function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "").split(";").map((part) => {
      const index = part.indexOf("=");
      return index < 0
        ? ["", ""]
        : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    }),
  );
}

export function cookie(name, value, cfg, maxAge = duration) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cfg.secure ? "; Secure" : ""}`;
}

export function csrfToken(req, res, cfg) {
  const name = cookieNames(cfg).csrf;
  const existing = cookies(req)[name];
  const token = /^[a-f0-9]{64}$/.test(existing || "")
    ? existing
    : randomBytes(32).toString("hex");
  if (token !== existing) res.setHeader("Set-Cookie", cookie(name, token, cfg));
  return token;
}

export function sameOrigin(req, cfg) {
  // Only sessionUser can set this marker after verifying a desktop bearer.
  if (req[desktopAuth]) {
    if (!req.headers["content-type"]?.startsWith("application/json"))
      throw new HttpError(415, "Expected a JSON request.");
    return;
  }
  if (req.headers.origin !== cfg.origin)
    throw new HttpError(403, "Request origin is not allowed.");
  const token = cookies(req)[cookieNames(cfg).csrf];
  const supplied = req.headers["x-csrf-token"];
  if (
    typeof supplied !== "string" ||
    !/^[a-f0-9]{64}$/.test(supplied) ||
    !token ||
    supplied.length !== token.length ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
  ) {
    throw new HttpError(403, "Refresh the page before trying again.");
  }
  if (!req.headers["content-type"]?.startsWith("application/json")) {
    throw new HttpError(415, "Expected a JSON request.");
  }
}

function sessionKey(cfg) {
  if (cfg.secret.length < 32)
    throw new HttpError(503, "Website sign-in has not been configured.");
  return new TextEncoder().encode(cfg.secret);
}

export async function signSession(user, cfg, audience = "jarvis-web", device = {}) {
  const signedOut = await (cfg.revocations || revocations).epoch(user.sub, audience);
  // Written before the token exists: a failure here refuses the sign-in.
  const did = await (cfg.devices || devices).register(user.sub, audience, device.label || deviceLabel("", audience));
  // NumericDate permits fractional seconds. A new sign-in must be strictly
  // newer than a sign-out even when both happen within the same clock tick.
  const issued = Math.max(Date.now() / 1000, signedOut + 0.001);
  return new SignJWT({ email: user.email, name: user.name, ...(did && { did }) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sub)
    .setIssuer(cfg.origin)
    .setAudience(audience)
    .setIssuedAt(issued)
    .setExpirationTime(`${duration}s`)
    .sign(sessionKey(cfg));
}

/* Which kind of session a request carries: the desktop app's bearer or the
   browser's cookie. Each has its own audience and its own sign-out epoch. */
export function sessionAudience(req) {
  const bearer = req.headers.authorization;
  return typeof bearer === "string" && bearer.startsWith("Bearer ")
    ? "vaelo-desktop"
    : "jarvis-web";
}

export async function sessionUser(req, cfg) {
  delete req[desktopAuth];
  delete req[currentDevice];
  const audience = sessionAudience(req);
  const desktop = audience === "vaelo-desktop";
  const token = desktop
    ? req.headers.authorization.slice(7)
    : cookies(req)[cookieNames(cfg).session];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey(cfg), {
      issuer: cfg.origin,
      audience,
      algorithms: ["HS256"],
    });
    if (!payload.sub || !cfg.email || payload.email !== cfg.email) return null;
    const signedOut = await (cfg.revocations || revocations).epoch(payload.sub, audience);
    if ((payload.iat || 0) <= signedOut) return null;
    if (payload.did !== undefined && !DEVICE_ID.test(payload.did)) return null;
    // A signed-out device is refused; an unreadable registry throws into the catch below.
    if (!(await (cfg.devices || devices).verify(payload.sub, audience, payload.did, payload.iat || 0))) return null;
    if (payload.did) req[currentDevice] = payload.did;
    if (desktop) req[desktopAuth] = true;
    return {
      sub: payload.sub,
      email: payload.email,
      name: displayName(payload.name),
    };
  } catch {
    return null;
  }
}

/* A guest is a throwaway identity for trying Vaelo without signing in. It has
   its own cookie and audience, so it can never be read as the owner, and the
   "guest:" subject is what tells the relay to answer without any tools. */
const guestDuration = 24 * 60 * 60;
export const GUEST_PREFIX = "guest:";

export async function signGuest(cfg) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`${GUEST_PREFIX}${randomUUID()}`)
    .setIssuer(cfg.origin)
    .setAudience("vaelo-guest")
    .setIssuedAt()
    .setExpirationTime(`${guestDuration}s`)
    .sign(sessionKey(cfg));
}

export function guestCookie(value, cfg, maxAge = guestDuration) {
  return cookie(cookieNames(cfg).guest, value, cfg, maxAge);
}

/* The desktop app has no cookies: it holds the guest token in memory and sends
   it as a bearer, which (as for the owner's desktop token) is what lets the
   request skip the browser-only origin and CSRF checks once verified. */
export async function guestUser(req, cfg) {
  const header = req.headers?.authorization;
  const desktop = typeof header === "string" && header.startsWith("Bearer ");
  const token = desktop ? header.slice(7) : cookies(req)[cookieNames(cfg).guest];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey(cfg), {
      issuer: cfg.origin,
      audience: "vaelo-guest",
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string" || !/^guest:[a-f0-9-]{36}$/.test(payload.sub)) return null;
    if (desktop) req[desktopAuth] = true;
    return { sub: payload.sub, email: "", name: "Guest", guest: true };
  } catch {
    return null;
  }
}

function displayName(value) {
  return (
    (typeof value === "string" ? value : "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .trim()
      .slice(0, 80) || "User"
  );
}

export function googleUser(payload, nonce, cfg) {
  if (
    !payload.sub ||
    payload.email_verified !== true ||
    !cfg.email ||
    payload.email?.toLowerCase() !== cfg.email ||
    payload.nonce !== nonce
  ) {
    throw new HttpError(
      403,
      "This Vaelo workspace is private. Use the owner’s Google account.",
    );
  }
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: displayName(payload.given_name || payload.name),
  };
}

export async function verifyGoogle(credential, nonce, cfg) {
  if (!cfg.clientId)
    throw new HttpError(503, "Google sign-in has not been configured.");
  try {
    const { payload } = await jwtVerify(credential, googleKeys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: cfg.clientId,
      algorithms: ["RS256"],
      maxTokenAge: "1h",
    });
    return googleUser(payload, nonce, cfg);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      401,
      "Google sign-in could not be verified. Please try again.",
    );
  }
}

export async function readJson(req, limit = 256000) {
  const parseBytes = bytes => {
    try {
      // Reject damaged transport bytes rather than saving replacement characters.
      // Keep BOM handling consistent with JSON.parse on string request bodies.
      return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
    } catch {
      throw new HttpError(400, "Invalid JSON request.");
    }
  };
  if (req.body !== undefined) {
    if (Buffer.isBuffer(req.body)) {
      if (req.body.length > limit) throw new HttpError(413, "That message is too large.");
      return parseBytes(req.body);
    }
    if (
      Buffer.byteLength(
        typeof req.body === "string" ? req.body : JSON.stringify(req.body),
      ) > limit
    ) {
      throw new HttpError(413, "That message is too large.");
    }
    try {
      return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch {
      throw new HttpError(400, "Invalid JSON request.");
    }
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += bytes.length;
    if (size > limit) throw new HttpError(413, "That message is too large.");
    chunks.push(bytes);
  }
  return parseBytes(Buffer.concat(chunks));
}

export function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

export function fail(res, error) {
  json(res, error instanceof HttpError ? error.status : 500, {
    error:
      error instanceof HttpError
        ? error.message
        : "Vaelo could not complete that request.",
  });
}

export async function authorize(req, cfg) {
  const user = await sessionUser(req, cfg);
  if (!user) throw new HttpError(401, "Sign in to use Vaelo.");
  return user;
}

/* Owner or guest. Only the chat, stop and status routes use this; every
   route that touches saved chats, work, files or devices stays owner-only. */
export async function authorizeAny(req, cfg) {
  const user = (await sessionUser(req, cfg)) || (await guestUser(req, cfg));
  if (!user) throw new HttpError(401, "Sign in to use Vaelo.");
  return user;
}
