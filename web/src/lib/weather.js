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
  if (/drizzle/i.test(condition)) return '🌦️';
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
  if (content.length > 60000 ||
      wantsPlainReply(request) || wantsSourceReply(request) || /\b(?:json|table|code)\b/i.test(request)) return null;
  const structured = weatherData(content);
  if (structured) return structured;
  if (!/\b(?:weather|forecast|temperature)\b/i.test(request) || /```/.test(content)) return null;
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
  if (!periods.length && lines.length === 1) {
    const row = cells(lines[0]);
    if (row.length === 8 && /^day$/i.test(row[0]) && /^conditions$/i.test(row[1]) && /^high$/i.test(row[2]) && /^low$/i.test(row[3])) {
      const high = temperature(row[6]), low = temperature(row[7]);
      if (high || low) periods = [{ label: row[4], condition: row[5], high, low }];
    }
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

// Only the bounded weather contract is promoted; arbitrary JSON stays literal.
export function weatherData(content = '') {
  if (content.length > 60000) return null;
  const fence = content.match(/^```weather\n([^]*?)\n```/m);
  if (!fence) return null;
  try {
    const data = JSON.parse(fence[1]);
    if (data.view !== undefined && !['day', 'week', 'range'].includes(data.view)) return null;
    if (data.view === 'week' && data.periods?.length !== 7) return null;
    const text = (v, max = 160) => typeof v === 'string' && v.length <= max;
    const numeric = v => v === null || (typeof v === 'number' && Number.isFinite(v));
    const stamp = v => text(v, 40) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v);
    if (data.version !== 1 || !text(data.title) || !text(data.timezone) || !['°F', '°C'].includes(data.unit) || !['mp/h', 'mph', 'km/h'].includes(data.windUnit) || !stamp(data.localTime) || !stamp(data.retrieved) || !Array.isArray(data.periods) || !data.periods.length || data.periods.length > 16) return null;
    if (!data.periods.every(p => p && text(p.label, 10) && /^\d{4}-\d{2}-\d{2}$/.test(p.label) && text(p.condition) && ['high','low','rain','wind','uv'].every(k => numeric(p[k])) && [p.sunrise,p.sunset].every(v => v === null || stamp(v)) && Array.isArray(p.hours) && p.hours.length <= 25 && p.hours.every(h => h && stamp(h.time) && numeric(h.temperature) && numeric(h.rain) && text(h.condition) && typeof h.isDay === 'boolean'))) return null;
    if (data.current && (!stamp(data.current.time) || !text(data.current.condition) || !['temperature','feels','humidity','wind'].every(k => numeric(data.current[k])) || typeof data.current.isDay !== 'boolean')) return null;
    return { ...data, detailed: true, notes: '', fallback: content.replace(fence[0], '').trim() };
  } catch { return null; }
}

export function weatherMarkdown(content) {
  return weatherData(content)?.fallback ?? content;
}
