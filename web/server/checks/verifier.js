import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function getPath(object, path) {
  let value = object;
  for (const key of path) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

const paths = {
  'calendar-event': ['title', 'start', 'end', 'timeZone', 'attendees', 'location', 'status'],
  document: ['title', 'text'],
};
const operations = new Set(['equals', 'contains', 'setEquals', 'instantEquals']);

export function validateContract(contract) {
  if (!contract || typeof contract.id !== 'string' || !contract.id.trim()) throw new Error('A contract needs an id.');
  const resource = contract.resource;
  if (!resource || !paths[resource.kind] || typeof resource.id !== 'string' || !resource.id.trim()) throw new Error('Choose a supported resource and explicit id.');
  if (resource.kind === 'calendar-event' && !resource.calendarId) throw new Error('An explicit calendar id is required.');
  if (!Array.isArray(contract.checks) || !contract.checks.length) throw new Error('Choose acceptance checks before verification.');
  const ids = new Set();
  for (const check of contract.checks) {
    if (!check.id || ids.has(check.id)) throw new Error('Checks need unique ids.');
    ids.add(check.id);
    if (!Array.isArray(check.path) || check.path.length !== 1 || !paths[resource.kind].includes(check.path[0])) throw new Error('Unsupported check path.');
    if (!operations.has(check.op) || !Object.hasOwn(check, 'expected') || check.expected === undefined) throw new Error('Unsupported or incomplete check.');
    if (check.op === 'setEquals' && (!Array.isArray(check.expected) || check.expected.some(x => typeof x !== 'string'))) throw new Error('setEquals requires a string array.');
    if (['contains', 'instantEquals'].includes(check.op) && typeof check.expected !== 'string') throw new Error('Text and instant checks require strings.');
    if (check.op === 'instantEquals' && !Number.isFinite(instant(check.expected))) throw new Error('Expected time needs an explicit offset.');
  }
  return structuredClone(contract);
}

function instant(value) {
  if (typeof value !== 'string') return NaN;
  const parts=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:Z|[+-](\d\d):(\d\d))$/.exec(value);
  if (!parts) return NaN;
  const [,year,month,day,hour,minute,second,offsetHour='0',offsetMinute='0']=parts.map((x,i)=>i===0?x:Number(x));
  const leap=year%4===0 && (year%100!==0 || year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if (month<1 || month>12 || day<1 || day>days[month-1] || hour>23 || minute>59 || second>59 || offsetHour>23 || offsetMinute>59) return NaN;
  return Date.parse(value);
}

function checkValue(check, actual) {
  if (actual === undefined) return { status: 'unverified', reason: 'The source did not expose this field.' };
  let passed;
  switch (check.op) {
    case 'equals': passed = isDeepStrictEqual(actual, check.expected); break;
    case 'contains':
      if (typeof actual !== 'string') return { status: 'unverified', reason: 'Source field is not text.' };
      passed = actual.includes(check.expected); break;
    case 'setEquals':
      if (!Array.isArray(actual) || actual.some(x => typeof x !== 'string')) return { status: 'unverified', reason: 'Source field is not a complete string list.' };
      passed = isDeepStrictEqual([...new Set(actual)].sort(), [...new Set(check.expected)].sort()); break;
    case 'instantEquals':
      if (!Number.isFinite(instant(actual))) return { status: 'unverified', reason: 'Source time has no valid explicit offset.' };
      passed = instant(actual) === instant(check.expected); break;
  }
  return { status: passed ? 'passed' : 'failed', reason: passed ? 'Observed value satisfies this check.' : 'Observed value differs from the requirement.' };
}

function sameResource(left, right) {
  return ['kind', 'id', 'calendarId', 'tabId'].every(key => left?.[key] === right?.[key]);
}

export function verifyObservation(input, observation, { before = null, now = Date.now(), maxAgeMs = 60_000 } = {}) {
  const contract = validateContract(input);
  const age = now - Date.parse(observation?.observedAt);
  let unavailable = null;
  if (!observation || observation.available !== true) unavailable = observation?.reason || 'No final state could be read.';
  else if (!sameResource(contract.resource, observation.resource)) unavailable = 'Readback belongs to a different resource.';
  else if (!Number.isFinite(age) || age < -1000 || age > maxAgeMs) unavailable = 'Readback is stale or has an invalid timestamp.';
  const checks = contract.checks.map(check => {
    const actual = unavailable !== null ? undefined : getPath(observation.state, check.path);
    return { ...check, actual: actual ?? null, ...(unavailable !== null ? {status:'unverified',reason:unavailable} : checkValue(check, actual)) };
  });
  const passed = checks.filter(c => c.status === 'passed').length;
  const failed = checks.filter(c => c.status === 'failed').length;
  const unknown = checks.filter(c => c.status === 'unverified').length;
  const status = failed ? (passed ? 'partial' : 'failed') : unknown ? 'unverified' : 'completed';
  return {
    id: digest({contract, observation, now}), contract, status, verifiedAt: new Date(now).toISOString(),
    mode: 'supplied-readback',
    counts: {passed, failed, unverified: unknown}, checks,
    evidence: {before, after: observation ?? null, contractDigest: digest(contract), observationDigest: observation ? digest(observation) : null},
    limitations: ['Verifies only the declared properties at read time; it does not prove who caused the state or that the full request was captured.', 'Digests detect changes only when compared to a trusted retained digest; they are not signed attestations.'],
  };
}
