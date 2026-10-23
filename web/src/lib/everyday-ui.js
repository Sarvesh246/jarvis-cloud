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
  // A closing question followed by a small explicit list of choices is enough
  // evidence to offer buttons. Instructions/checklists are not questions.
  if (content.length > 12000 || /```|~~~|\[[ xX]\]/.test(content)) return null;
  const leading = content.match(/(?:^|\n)([^\n]{8,300}\?)\s*\n(?:[^\n]{0,40}(?:options|choices|approaches)[^\n]{0,35}:\s*\n)?((?:(?:[-*]|\d+[.)]|[A-F][.)])\s+[^\n]+(?:\n\s*)?){2,6})\s*$/i);
  const trailing = !leading && content.match(/(?:^|\n)((?:(?:(?:[-*]|\d+[.)]|[A-F][.)])\s+|\*\*(?=\S))[^\n]+(?:\n\s*)?){2,6})\s*\n([^\n]{8,300}\?)\s*$/i);
  const found = leading || (trailing && { index: trailing.index, 1: trailing[2], 2: trailing[1] });
  if (!found) return null;
  if (trailing && /^(?:(?:[-*]|\d+[.)]|[A-F][.)])\s+|\*\*)/.test(content.slice(0, trailing.index).trim().split('\n').at(-1) || '')) return null;
  if (/!?\[[^\]]*\]\(/.test(found[2])) return null;
  const options = found[2].trim().split('\n').filter(line => line.trim()).map(line => plainLine(line.trim().replace(/^(?:[-*]|\d+[.)]|[A-F][.)])\s+/, '')));
  if (options.some(x => !x || x.length > 180) || new Set(options).size !== options.length) return null;
  return { type: 'question', title: plainLine(found[1]), options, markdown: content.slice(0, found.index).trim() };
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
