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

export function lineGeometry(points) {
  // Normalize first: subtracting a large negative from a large positive can
  // overflow even when each individual value is finite.
  const finite = points.filter(point => Number.isFinite(point.value));
  if (!finite.length) return { paths: [], points: [], ticks: [] };
  const scale = Math.max(...finite.map(point => Math.abs(point.value))) || 1;
  const low = Math.min(0, ...finite.map(point => point.value / scale));
  const high = Math.max(0, ...finite.map(point => point.value / scale));
  const span = high - low || 1;
  const located = points.map((point, i) => ({ ...point, x: 72 + i / Math.max(1, points.length - 1) * 550,
    y: Number.isFinite(point.value) ? 220 - (point.value / scale - low) / span * 196 : null }));
  const paths = [];
  let path = [];
  located.forEach(point => {
    if (point.y == null) { if (path.length) paths.push(path.join(' ')); path = []; }
    else path.push(`${point.x},${point.y}`);
  });
  if (path.length) paths.push(path.join(' '));
  return { paths, points: located, ticks: Array.from({length: 5}, (_, i) => ({
    y: 220 - i / 4 * 196, value: (low + i / 4 * span) * scale,
  })) };
}

export function compactNumber(value) {
  if (value !== 0 && (Math.abs(value) < .001 || Math.abs(value) >= 1e15)) return value.toExponential(2);
  return new Intl.NumberFormat(undefined, { notation: Math.abs(value) >= 10000 ? 'compact' : 'standard', maximumSignificantDigits: 4 }).format(value);
}
