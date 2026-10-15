// Reading everyday writing: amounts like "$40" or "40 dollars", dates like
// "next Friday" or "15 Oct", and lists written one per line or with commas.
// Shared by the browser (to show what was understood) and the server (which
// runs the checks), so both read the same words the same way.

const SYMBOLS = [
  [/^(?:us\$|usd|dollars?|bucks?)$/i, '$'], [/^\$$/, '$'], [/^(?:a\$|aud)$/i, 'A$'], [/^(?:c\$|cad)$/i, 'C$'], [/^(?:nz\$|nzd)$/i, 'NZ$'],
  [/^(?:£|gbp|pounds?|quid)$/i, '£'], [/^(?:€|eur|euros?)$/i, '€'], [/^(?:₹|rs\.?|inr|rupees?)$/i, '₹'], [/^(?:¥|jpy|yen)$/i, '¥'],
];
const symbolFor = word => SYMBOLS.find(([pattern]) => pattern.test(word.trim()))?.[1] ?? null;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const BEFORE = String.raw`(us\$|a\$|c\$|nz\$|\$|£|€|₹|¥|rs\.?|usd|aud|cad|nzd|gbp|eur|inr|jpy)\s?`;
const NUMBER = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?`;
const AFTER = String.raw`\s?(dollars?|bucks?|pounds?|quid|euros?|rupees?|yen|usd|aud|cad|nzd|gbp|eur|inr|jpy)\b`;

/* Every amount in a line, with whether it carried a currency and where. */
export function findAmounts(text) {
  const source = String(text ?? '');
  const pattern = new RegExp(`(?:${BEFORE})?${NUMBER}(?:${AFTER})?`, 'gi');
  const found = [];
  for (const match of source.matchAll(pattern)) {
    const [whole, before, digits, cents, after] = match;
    const end = match.index + whole.length;
    const near = source.slice(Math.max(0, match.index - 12), match.index).toLowerCase();
    const next = source.slice(end, end + 12).toLowerCase();
    // "3 Oct", "Oct 3", "3rd" and "10:30" are dates and times, not money.
    const dateLike = !before && !after && (new RegExp(`^\\s*(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH}`, 'i').test(next)
      || new RegExp(`${MONTH}\\.?\\s*$`, 'i').test(near) || /^(?:st|nd|rd|th)\b/.test(next) || /^[:/.-]\d/.test(next) || /[:/-]$/.test(near));
    if (dateLike) continue;
    const amount = Number(digits.replace(/,/g, '')) + (cents ? Number(cents.padEnd(2, '0')) / 100 : 0);
    if (!Number.isFinite(amount)) continue;
    found.push({ amount, symbol: before ? symbolFor(before) : after ? symbolFor(after) : null, marked: Boolean(before || after), index: match.index, end, text: whole.trim() });
  }
  return found;
}

/* The amount a line means: the first one written as money, or else the
   first plain number. */
export function parseMoney(text) {
  const amounts = findAmounts(text);
  return amounts.find(item => item.marked) ?? amounts[0] ?? null;
}

export function formatMoney(amount, symbol = '') {
  const whole = Math.round(amount * 100) % 100 === 0;
  const number = Number(amount).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  return symbol ? `${symbol}${number}` : number;
}

const iso = date => date.toISOString().slice(0, 10);
const utc = (year, month, day) => {
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCMonth() === ((month % 12) + 12) % 12 && date.getUTCDate() === day ? date : null;
};
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/* A date written the way people say it. Returns YYYY-MM-DD or null. Numeric
   dates are read day first (15/10/2026), as in most of the world. */
export function parseDate(text, now = Date.now()) {
  const value = String(text ?? '').trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!value) return null;
  const today = new Date(typeof now === 'number' ? now : Date.parse(now));
  const base = utc(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const shift = days => iso(new Date(base.getTime() + days * 86400000));
  let match;
  if (/^today$/.test(value)) return shift(0);
  if (/^tomorrow$/.test(value)) return shift(1);
  if (/^yesterday$/.test(value)) return shift(-1);
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:t.*)?$/.exec(value))) { const d = utc(+match[1], +match[2] - 1, +match[3]); return d && iso(d); }
  if ((match = /^in (\d{1,3}|a|an|one|two|three|four) (day|week|month)s?$/.exec(value))) {
    const n = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 }[match[1]] ?? Number(match[1]);
    if (match[2] === 'month') { const d = new Date(base); d.setUTCMonth(d.getUTCMonth() + n); return iso(d); }
    return shift(n * (match[2] === 'week' ? 7 : 1));
  }
  if ((match = /^(?:(next|this|on)\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/.exec(value))) {
    const target = WEEKDAYS.indexOf(match[2]);
    // The coming one: "Friday" and "next Friday" both mean the next Friday ahead.
    const ahead = (target - base.getUTCDay() + 7) % 7 || 7;
    return shift(ahead);
  }
  if (/^next week$/.test(value)) return shift(7);
  if (/^end of (?:the )?month$/.test(value)) return iso(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)));
  const named = new RegExp(`^(?:(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH}|${MONTH}\\s*(\\d{1,2})(?:st|nd|rd|th)?)\\.?\\s*(\\d{4})?$`);
  if ((match = named.exec(value))) {
    const day = Number(match[1] ?? match[4]);
    const month = MONTHS.indexOf((match[2] ?? match[3]).slice(0, 3));
    const d = utc(match[5] ? Number(match[5]) : base.getUTCFullYear(), month, day);
    return d && iso(d);
  }
  if ((match = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(value))) {
    let [, first, second, year] = match.map(Number);
    if (!match[3]) year = base.getUTCFullYear(); else if (year < 100) year += 2000;
    const [day, month] = first > 12 ? [first, second] : second > 12 ? [second, first] : [first, second];
    const d = utc(year, month - 1, day);
    return d && iso(d);
  }
  return null;
}

export function formatDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : String(value);
}

/* Lines of a paste box, without bullets or numbering. */
export function parseLines(text) {
  return String(text ?? '').split(/\r?\n/).map(line => line.replace(/^\s*(?:[-*•·–]|\d{1,3}[.)])\s+/, '').trim()).filter(Boolean);
}

/* "Ana, Ben and Cy" or one per line. */
export function splitList(text) {
  return String(text ?? '').split(/\r?\n|,|;|\s+and\s+|\s+or\s+|\s*\/\s*|\s*&\s*/i).map(item => item.trim()).filter(Boolean);
}

/* "Rent: $1,500" or "Rent - $1,500" → ["Rent", "$1,500"]. */
export function splitPair(line) {
  const match = /^(.+?)\s*(?::|=|\s[-–—]\s)\s*(.*)$/.exec(line);
  return match ? [match[1].trim(), match[2].trim()] : [line.trim(), ''];
}

export const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
