// Shared UI helpers. Cached records are acknowledged server versions, never a
// queue that might overwrite a newer record when connectivity returns.
export const workCacheKey = (sub) => `vaelo-work:v1:${sub}`;
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
export const fieldTitle = (key) => String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, c => c.toUpperCase());

export function schemaValue(schema = {}) {
  if (Object.hasOwn(schema, 'default')) return structuredClone(schema.default);
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties || {}).map(([key, child]) => [key, schemaValue(child)]));
  if (schema.type === 'array') return [];
  // Empty strings keep required numbers/booleans visibly unanswered.
  return '';
}

export function inferredSchema(value) {
  if (Array.isArray(value)) return { type: 'array' };
  if (value !== null && typeof value === 'object') return { type: 'object' };
  return { type: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string' };
}

export const valueForType = type => ({ number: 0, boolean: false, object: {}, array: [], string: '' })[type];

const unanswered = value => value === '' || value === undefined || value === null || (Array.isArray(value) ? value.every(unanswered) : typeof value === 'object' && Object.values(value).every(unanswered));

export function prepareInput(schema, value) {
  if (schema?.type === 'array' && Array.isArray(value)) return value.map(item => prepareInput(schema.items, item));
  if (schema?.type !== 'object' || !schema.properties || !value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key,item]) => !unanswered(item) || schema.required?.includes(key)).map(([key,item]) => [key,prepareInput(schema.properties[key],item)]));
}

export function updateValue(value, path, next) {
  if (!path.length) return next;
  const [key, ...rest] = path;
  if (forbidden.has(String(key))) throw new Error('This field name is reserved.');
  const copy = Array.isArray(value) ? [...value] : { ...(value || {}) };
  copy[key] = updateValue(copy[key], rest, next);
  return copy;
}

export function validateInput(schema, value, label = 'Inputs', depth = 0) {
  if (depth > 12) return [`${label}: use fewer nested fields.`];
  const errors = [];
  if (schema.enum && value !== '' && !schema.enum.some(option => Object.is(option, value))) errors.push(`${label}: choose a listed value.`);
  if (schema.type === 'object') {
    if (!value || Array.isArray(value) || typeof value !== 'object') return [`${label}: add a record.`];
    for (const name of schema.required || []) if (value[name] === '' || value[name] === undefined || value[name] === null) errors.push(`${label} · ${schema.properties?.[name]?.title || fieldTitle(name)} is required.`);
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.has(key)) { errors.push(`${label}: reserved field name.`); continue; }
      const childSchema = schema.properties?.[key] || inferredSchema(child);
      if (child === '' || child === null || child === undefined) continue; // Missing required values are reported once above.
      errors.push(...validateInput(childSchema, child, `${label} · ${childSchema.title || fieldTitle(key)}`, depth + 1));
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${label}: add a list.`];
    if (schema.minItems && value.length < schema.minItems) errors.push(`${label}: add at least ${schema.minItems} items.`);
    value.forEach((child, i) => errors.push(...validateInput(schema.items || inferredSchema(child), child, `${label} ${i + 1}`, depth + 1)));
  } else if (['number', 'integer'].includes(schema.type)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) errors.push(`${label}: enter ${schema.type === 'integer' ? 'a whole' : 'a'} number.`);
    else if ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) errors.push(`${label}: use a value within the allowed range.`);
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') errors.push(`${label}: choose yes or no.`);
  else if (schema.type === 'string' && typeof value !== 'string') errors.push(`${label}: enter text.`);
  return errors;
}

export function readWorkCache(sub, storage = globalThis.localStorage) {
  if (!sub) return [];
  try {
    const saved = JSON.parse(storage?.getItem(workCacheKey(sub)) || 'null');
    return saved?.account === sub && Array.isArray(saved.records) ? saved.records : [];
  } catch { return []; }
}

export function writeWorkCache(sub, records, storage = globalThis.localStorage) {
  if (!sub) return false;
  try { storage?.setItem(workCacheKey(sub), JSON.stringify({ account: sub, records })); return Boolean(storage); }
  catch { return false; }
}

export async function requestWork(body, { csrf, signal, request = fetch } = {}) {
  const response = await request('/api/work', body ? {
    method: 'POST', credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' }, body: JSON.stringify(body),
  } : { signal, credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(typeof data.error === 'string' ? data.error : 'Your work could not be loaded. Try again.'), { status: response.status });
  return data;
}

export function importWork(text, capabilities) {
  if (text.length > 2_000_000) throw new Error('Choose a file smaller than 2 MB.');
  const parsed = JSON.parse(text);
  const candidates = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : [parsed];
  if (!candidates.length || candidates.length > 100) throw new Error('Choose a file containing between 1 and 100 work records.');
  return candidates.map(record => {
    const capability = capabilities.find(c => c.id === Number(record?.capabilityId));
    if (!capability || !record.input || typeof record.input !== 'object' || Array.isArray(record.input)) throw new Error('Each record needs a supported capability and its input fields.');
    // IDs, outputs and revisions are not imported as trusted saved state.
    return { capabilityId: capability.id, title: typeof record.title === 'string' ? record.title.slice(0, 160) : capability.title,
      scope: ['personal','work','client'].includes(record.scope) ? record.scope : 'personal', input: record.input };
  });
}

export function draftMatches(record, draft) {
  return Boolean(record && draft && record.id === draft.id && record.capabilityId === draft.capabilityId && record.title === draft.title && record.scope === draft.scope && JSON.stringify(record.input) === JSON.stringify(draft.input));
}

export function refreshWorkReferences(chats, record, updated = Date.now()) {
  if (!record?.id) return chats;
  return chats.map(chat => !chat.workContext || chat.workContext.id !== record.id ? chat : {
    ...chat, updated, workContext: record.deleted ? undefined : {
      id:record.id,revision:record.revision,title:record.title,scope:record.scope
    }
  });
}
