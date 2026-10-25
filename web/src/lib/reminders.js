export function parseReminder(args, now = Date.now()) {
  const match = /^in\s+(\d+)\s*(m|min|minutes?|h|hours?|d|days?)\s+([\s\S]+)$/i.exec(args);
  if (!match) return null;
  const unit = match[2][0].toLowerCase();
  const delay = Number(match[1]) * ({ m: 60000, h: 3600000, d: 86400000 }[unit]);
  return delay > 0 && delay <= 366 * 86400000 ? { text: match[3].trim(), at: now + delay, repeat: 'once' } : null;
}
export function reminderCalendar(item) {
  const date = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  // Every TEXT value stays on one logical content line, including CR-only
  // source text. Escape backslashes first so literal \\n is not a line break.
  const escape = text => text.replace(/\\/g, '\\\\').replace(/\r\n|[\r\n]/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vaelo//Reminders//EN', 'BEGIN:VEVENT',
    `UID:${escape(item.id)}@vaelo`, `DTSTAMP:${date(Date.now())}`, `DTSTART:${date(item.at)}`, `DTEND:${date(item.at + 60000)}`,
    `SUMMARY:${escape(item.text)}`, ...(item.repeat === 'once' ? [] : [`RRULE:FREQ=${item.repeat === 'daily' ? 'DAILY' : 'WEEKLY'}`]),
    'BEGIN:VALARM', 'TRIGGER:PT0S', 'ACTION:DISPLAY', `DESCRIPTION:${escape(item.text)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'];
  // Fold by UTF-8 bytes without splitting a code point. The continuation's
  // leading space also counts toward the 75-octet iCalendar limit.
  return lines.map(line => {
    const parts = []; let part = '', bytes = 0;
    for (const ch of line) { const size = new TextEncoder().encode(ch).length;
      if (bytes + size > 70) { parts.push(part); part = ' '; bytes = 1; } part += ch; bytes += size; }
    parts.push(part); return parts.join('\r\n');
  }).join('\r\n') + '\r\n';
}
