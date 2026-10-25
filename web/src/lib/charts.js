import { cellText, isSectionRow, toDate, toNumber } from './table.js';

export function chartData(columns, rows, column, labelColumn) {
  let section = '';
  const points = [];
  rows.forEach((row, index) => {
    if (isSectionRow(row)) { section = cellText(row[0]); return; }
    points.push({ index, section, label: labelColumn == null ? `Row ${index + 1}` : cellText(row[labelColumn]),
      text: cellText(row[column]), value: toNumber(row[column]) });
  });
  const finite = points.filter(point => Number.isFinite(point.value));
  if (!finite.length) return { points, finite, max: 1, signed: false, summary: 'No numeric values in the current view.' };
  const highest = finite.reduce((a, b) => b.value > a.value ? b : a);
  const lowest = finite.reduce((a, b) => b.value < a.value ? b : a);
  return { points, finite, max: Math.max(...finite.map(point => Math.abs(point.value))) || 1,
    signed: finite.some(point => point.value < 0),
    summary: `${columns[column]}: highest is ${highest.label} at ${highest.text}; lowest is ${lowest.label} at ${lowest.text}.` };
}

export function temporalColumn(header, points) {
  return points.length > 1 && (/\b(date|month|week|year|quarter|day|period)\b/i.test(header || '') ||
    points.every(point => Number.isFinite(toDate(point.label))));
}

export function lineGeometry(points, box = { left: 72, right: 622, top: 24, bottom: 220 }) {
  // Normalize first: subtracting a large negative from a large positive can
  // overflow even when each individual value is finite.
  const finite = points.filter(point => Number.isFinite(point.value));
  if (!finite.length) return { paths: [], points: [], ticks: [] };
  const scale = Math.max(...finite.map(point => Math.abs(point.value))) || 1;
  const low = Math.min(0, ...finite.map(point => point.value / scale));
  const high = Math.max(0, ...finite.map(point => point.value / scale));
  const span = high - low || 1;
  const located = points.map((point, i) => ({ ...point, x: box.left + i / Math.max(1, points.length - 1) * (box.right - box.left),
    y: Number.isFinite(point.value) ? box.bottom - (point.value / scale - low) / span * (box.bottom - box.top) : null }));
  const paths = [];
  let path = [];
  located.forEach(point => {
    if (point.y == null) { if (path.length) paths.push(path.join(' ')); path = []; }
    else path.push(`${point.x},${point.y}`);
  });
  if (path.length) paths.push(path.join(' '));
  return { paths, points: located, ticks: Array.from({length: 5}, (_, i) => ({
    y: box.bottom - i / 4 * (box.bottom - box.top), value: (low + i / 4 * span) * scale,
  })) };
}

export function compactNumber(value) {
  if (value !== 0 && (Math.abs(value) < .001 || Math.abs(value) >= 1e15)) return value.toExponential(2);
  return new Intl.NumberFormat(undefined, { notation: Math.abs(value) >= 10000 ? 'compact' : 'standard', maximumSignificantDigits: 4 }).format(value);
}

export function chartChange(points) {
  const valid = points.filter(point => Number.isFinite(point.value));
  if (valid.length < 2) return '—';
  const first = valid[0].value, last = valid.at(-1).value;
  if (first === 0) return `${compactNumber(last - first)} absolute`;
  let change = (last - first) / Math.abs(first) * 100;
  // Opposite finite endpoints can overflow during subtraction even when
  // their percentage change is small. Keep ordinary rounding unchanged.
  if (!Number.isFinite(change)) change = (last / Math.abs(first) - Math.sign(first)) * 100;
  return Number.isFinite(change) ? `${change.toFixed(1)}%` : '—';
}
