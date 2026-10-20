import { wantsPlainReply } from './adaptive-ui.js';
import { wantsSourceReply } from './rich-ui.js';

const DAY = /\b(?:today|tonight|tomorrow(?:\s+night)?|this evening|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s+night)?\b/gi;
const CONDITION = /\b(?:partly (?:sunny|cloudy)|mostly (?:sunny|clear|cloudy)|thunderstorms?|snow(?:y| showers)?|rain(?:y| showers)?|showers|sunny|clear(?: sky| skies)?|overcast|cloudy|fog(?:gy)?|windy)\b/i;
const TEMP = /(-?\d{1,3}(?:\.\d+)?)\s*°\s*([FC])\b/i;
const clean = text => text.replace(/\*\*|__/g, '').trim();
const temperature = text => {
  const m = text.match(TEMP);
  return m ? `${m[1]}°${m[2].toUpperCase()}` : null;
};
export function weatherIcon(condition = '') {
  if (/thunder/i.test(condition)) return '⛈️';
  if (/snow/i.test(condition)) return '🌨️';
  if (/rain|shower/i.test(condition)) return '🌧️';
  if (/partly|mostly sunny/i.test(condition)) return '🌤️';
  if (/cloud|overcast/i.test(condition)) return '☁️';
  if (/fog/i.test(condition)) return '🌫️';
  if (/sun|clear/i.test(condition)) return '☀️';
  if (/wind/i.test(condition)) return '🌬️';
  return '🌡️';
}

// Restructure only supplied temperatures. Never infer a missing low, weather
// condition, unit, date, or location. Full prose and sources remain available.
export function weatherForecast(content = '', request = '') {
  if (content.length > 60000 || !/\b(?:weather|forecast|temperature)\b/i.test(request) ||
      wantsPlainReply(request) || wantsSourceReply(request) || /\b(?:json|table|code)\b/i.test(request) ||
      /```/.test(content)) return null;
  const text = clean(content);
  const lines = text.split('\n').filter(line => /^\s*\|/.test(line));
  const cells = line => line.replace(/^\s*\||\|\s*$/g, '').split('|').map(clean);
  let periods = [];
  if (lines.length >= 3) {
    const header = cells(lines[0]);
    const high = header.findIndex(x => /\bhigh\b/i.test(x));
    const low = header.findIndex(x => /\blow\b/i.test(x));
    const day = header.findIndex(x => /\b(?:day|date|period)\b/i.test(x));
    const condition = header.findIndex(x => /\b(?:condition|weather|outlook)/i.test(x));
    const unit = header.join(' ').match(/°\s*([FC])\b/i)?.[1];
    const cellTemp = value => temperature(value || '') || (unit && /^-?\d{1,3}(?:\.\d+)?°?$/.test(value || '') ? `${value.replace('°', '')}°${unit.toUpperCase()}` : null);
    if (day >= 0 && (high >= 0 || low >= 0)) periods = lines.slice(2, 16).map(line => {
      const row = cells(line);
      return { label: row[day], high: cellTemp(row[high]), low: cellTemp(row[low]), condition: row[condition] || '' };
    }).filter(row => row.label && (row.high || row.low));
  }
  if (!periods.length) {
    const days = [...text.matchAll(DAY)];
    const parts = days.length ? days.slice(0, 14).map((m, i) => ({ label: m[0], text: text.slice(m.index, days[i + 1]?.index ?? text.length) })) : [{ label: 'Forecast', text }];
    periods = parts.map(({ label, text: part }) => {
      const high = part.match(/\bhigh(?:s)?(?:\s+(?:of|around|near|will be|is|reach|reaching|up to))*\s*[:~]?\s*(-?\d{1,3}(?:\.\d+)?\s*°\s*[FC])\b/i);
      const low = part.match(/\b(?:low|lows|drop(?:ping)? to|drop to about)(?:\s+(?:of|around|near|will be|is))*\s*[:~]?\s*(-?\d{1,3}(?:\.\d+)?\s*°\s*[FC])\b/i);
      return { label, high: high ? temperature(high[1]) : null, low: low ? temperature(low[1]) : null, condition: part.match(CONDITION)?.[0] || '' };
    }).filter(row => row.high || row.low);
  }
  const title = text.split('\n').map(line => line.replace(/^#+\s*/, '').trim()).find(line => line && !line.startsWith('|'));
  const notes = lines.length >= 3 ? text.split('\n').filter(line => !/^\s*\|/.test(line) && line.trim() !== title).join('\n').trim() : '';
  return periods.length ? { periods, notes, title: title?.length <= 120 && /\b(?:weather|forecast)\b/i.test(title) ? title : 'Weather' } : null;
}
