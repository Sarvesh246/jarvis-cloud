// Presentation only: no model, tool, network, or conversation mutations.
import { cellText, toNumber } from './table.js';

export function blockKey(scope, offset, text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${scope}:${offset}:${text.length}:${hash >>> 0}`;
}

const STORAGE_KEY = 'vaelo-local-checklists-v1';
export function readChecklist(key, defaults, storage) {
  try {
    const value = JSON.parse((storage || globalThis.localStorage).getItem(STORAGE_KEY) || '{}')[key];
    if (Array.isArray(value) && value.length === defaults.length && value.every(x => typeof x === 'boolean')) return value;
  } catch { /* Private browsing or damaged storage: use the reply's defaults. */ }
  return defaults;
}

export function saveChecklist(key, values, storage) {
  try {
    const saved = JSON.parse((storage || globalThis.localStorage).getItem(STORAGE_KEY) || '{}');
    const entries = saved && typeof saved === 'object' && !Array.isArray(saved) ? Object.entries(saved) : [];
    (storage || globalThis.localStorage).setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries([
      ...entries.filter(([k]) => k !== key).slice(-199), [key, values],
    ])));
    return true;
  } catch { return false; }
}

export function visibleRows(rows, query = '', selected = [], onlySelected = false) {
  const needle = query.trim().toLocaleLowerCase().slice(0, 200);
  return rows.map((_, i) => i).filter(i =>
    (!onlySelected || selected.includes(i)) && rows[i].some(cell => cellText(cell).toLocaleLowerCase().includes(needle)));
}

// Units must match before values can be compared. Percentages stay percentage
// points, currencies cannot mix, and all results must be finite.
export function numberSeries(rows, column) {
  const values = rows.map(row => cellText(row[column]));
  const units = values.map(text => `${text.match(/[$€£¥₹]/)?.[0] || ''}${/%\)?$/.test(text) ? '%' : ''}`);
  const numbers = values.map(toNumber);
  if (!numbers.length || !numbers.every(Number.isFinite) || new Set(units).size !== 1) return null;
  return { numbers, unit: units[0] };
}

export function scaleSeries(series, factor) {
  if (!series || factor === '' || !Number.isFinite(Number(factor)) || Math.abs(Number(factor)) > 1000000) return null;
  const numbers = series.numbers.map(value => value * Number(factor));
  return numbers.every(Number.isFinite) ? { ...series, numbers } : null;
}
