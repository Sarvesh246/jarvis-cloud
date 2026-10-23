// Presentation helpers never fetch or generate content. Limits keep untrusted
// replies from turning a small interaction into an unbounded render.
import { withoutFencedCode, withoutInlineCode } from './markdown-fences.js';
import { plainLine } from './structured.js';
export const LONG_PASTE = 1800;
export function pasteName(text) {
  return (String(text).split(/\r?\n/).find(line => line.trim()) || 'Pasted text')
    .replace(/^[#>*\s]+/, '').slice(0, 64).trim() || 'Pasted text';
}
export function fileFormat(name = '', kind = '') {
  if (kind === 'image') return 'IMG';
  const ext = String(name).match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toUpperCase();
  return ext || (kind === 'table' ? 'CSV' : kind === 'code' ? 'CODE' : 'DOC');
}
export function measuredUsage(usage) {
  if (usage?.prompt_tokens == null || usage?.completion_tokens == null) return null;
  const input = Number(usage?.prompt_tokens), output = Number(usage?.completion_tokens);
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || !Number.isSafeInteger(input + output) || input < 0 || output < 0 || input + output <= 0) return null;
  return { input, output, total: input + output };
}
export function answerChoices(content = '') {
  if (content.length > 12000 || /```|~~~|\[[ xX]\]/.test(content)) return null;
  // Providers use bullets, numbered choices, or bold-labelled paragraphs.
  // Read the actual list and its nearby question rather than requiring a
  // particular heading, whitespace, or question-before-options order.
  const lines = content.split('\n');
  const groups = []; let offset = 0, group = null;
  const row = line => {
    const listed = line.match(/^\s*(?:[-*]|\d+[.)]|[A-F][.)])\s+(.+)$/);
    if (listed) return listed[1];
    return /^\*\*[^*]+\*\*\s*[^\s*]/.test(line) ? line : null;
  };
  for (const line of lines) {
    const choice = row(line);
    if (choice) {
      if (!group) group = { start: offset, end: offset, rows: [] };
      group.rows.push(choice); group.end = offset + line.length;
    } else if (line.trim() && /^ {2,}\S/.test(line) && group) {
      group.rows[group.rows.length - 1] += ' ' + line.trim(); group.end = offset + line.length;
    } else if (line.trim() && group) { groups.push(group); group = null; }
    offset += line.length + 1;
  }
  if (group) groups.push(group);
  for (const candidate of groups.reverse()) {
    if (candidate.rows.length < 2 || candidate.rows.length > 6) continue;
    const before = content.slice(0, candidate.start).replace(/(?:^|\n)\s*(?:\*\*)?(?:(?:concrete|your|the|two|available|possible|starting)\s+)?(?:options|choices|approaches)(?:\s+to consider)?\s*:?(?:\*\*)?\s*$/i, '').trimEnd();
    const after = content.slice(candidate.end).trim();
    const leading = before.match(/(?:^|\n)([^\n]{8,500}\?)\s*$/);
    const trailing = after.match(/^([^\n]{8,500}\?)$/);
    if (!leading && !trailing) continue;
    const options = [], details = [];
    let invalid = false;
    for (const value of candidate.rows) {
      if (/!?\[[^\]]*\]\(/.test(value)) { invalid = true; break; }
      const named = value.match(/^\*\*([^*]{1,120})\*\*\s*[:—–-]?\s*(.*)$/);
      const label = plainLine(named ? named[1].replace(/[:—–-]$/, '') : value);
      const detail = named ? plainLine(named[2]) : '';
      if (!label || label.length > 180 || detail.length > 1000) { invalid = true; break; }
      options.push(label); details.push(detail);
    }
    if (invalid || new Set(options).size !== options.length) continue;
    return { type: 'question', title: plainLine(trailing?.[1] || leading[1]), options,
      ...(details.some(Boolean) ? { details } : {}),
      markdown: [leading && !trailing ? before.slice(0, leading.index).trim() : before, trailing ? '' : after].filter(Boolean).join('\n\n') };
  }
  return null;
}
export function audioLinks(content = '') {
  if (content.length > 60000) return [];
  content = withoutInlineCode(withoutFencedCode(content)).replace(/^(?: {4}|\t).*$/gm, '');
  const found = [];
  for (const match of content.matchAll(/\[([^\]\n]{1,160})\]\((https:\/\/[^\s)]+)\)/g)) {
    try {
      const url = new URL(match[2]);
      if (!url.username && !url.password && /\.(?:mp3|wav|ogg|m4a|aac|flac)$/i.test(url.pathname) && !found.some(x => x.src === url.href)) found.push({ title: match[1], src: url.href });
    } catch { /* Keep malformed media links as prose. */ }
    if (found.length === 4) break;
  }
  return found;
}
