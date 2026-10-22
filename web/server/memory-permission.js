import { SignJWT, jwtVerify } from 'jose';
import { constrainedAnswer } from '../shared/answer-contract.js';

export function permitsMemory(input) {
  const last = input.messages?.findLast(message => message.role === 'user')?.content;
  const text = (typeof last === 'string' ? last : Array.isArray(last) ? last.filter(p => p?.type === 'text').map(p => p.text).join('\n') : '')
    .split(/\n\n(?:Attached file: |\[Vaelo request:|\[Selected Vaelo workspace:)/)[0];
  return !input.freshness && !input.research && !input.work && !constrainedAnswer(text) &&
    !/\b(?:do not|don't|dont|never|no|without)\s+(?:(?:save|store|create|write|add|keep|record|remember|any|new|to|this|as|a|in)\s+)*(?:memor(?:y|ies)|notes?)\b|\b(?:do not|don't|dont|never) remember\b/i.test(text) &&
    !(typeof last === 'string' && last.includes('\n\nAttached file: ')) &&
    !(Array.isArray(last) && last.some(part => part?.type === 'image_url'));
}

export async function memoryPermission(cfg, sub, runId) {
  if (!cfg.secret) return null;
  return new SignJWT({ run: runId }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub)
    .setAudience('vaelo-memory-write').setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(cfg.secret));
}

export async function verifyMemoryPermission(cfg, sub, token) {
  if (!cfg.secret || typeof token !== 'string') return false;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(cfg.secret), {
      algorithms: ['HS256'], audience: 'vaelo-memory-write', subject: sub,
    });
    return typeof payload.run === 'string';
  } catch { return false; }
}
