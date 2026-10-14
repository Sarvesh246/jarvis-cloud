import { randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify, createRemoteJWKSet } from "jose";

const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const duration = 7 * 24 * 60 * 60;
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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
  return { session: `${prefix}jarvis-session`, csrf: `${prefix}jarvis-csrf` };
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

export async function signSession(user, cfg) {
  return new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sub)
    .setIssuer(cfg.origin)
    .setAudience("jarvis-web")
    .setIssuedAt()
    .setExpirationTime(`${duration}s`)
    .sign(sessionKey(cfg));
}

export async function sessionUser(req, cfg) {
  const token = cookies(req)[cookieNames(cfg).session];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey(cfg), {
      issuer: cfg.origin,
      audience: "jarvis-web",
      algorithms: ["HS256"],
    });
    if (!payload.sub || !cfg.email || payload.email !== cfg.email) return null;
    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name || "Sarvesh",
    };
  } catch {
    return null;
  }
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
    name: String(payload.given_name || "Sarvesh").slice(0, 80),
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
  if (req.body !== undefined) {
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
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "That message is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new HttpError(400, "Invalid JSON request.");
  }
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
