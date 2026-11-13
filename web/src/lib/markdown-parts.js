import { withoutFencedCode, withoutInlineCode } from "./markdown-fences.js";
/* Only split independent top-level blocks. Reference definitions, nested
   lists, quotations and display math need document-wide parsing. */
export function markdownParts(text) {
  const prose = withoutInlineCode(withoutFencedCode(text));
  if (/^ {0,3}(?:>|[-+*] |\d+[.)] |\[.*?\]:)|^ {4}\S|\$\$|\\[[(]/m.test(prose) || /\[[^\]]+\](?!\()/.test(prose)) return [text];
  const lines = text.split(/(?<=\n)/), parts = [];
  let fence = null, part = "";
  for (const line of lines) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)/);
    if (marker && !fence) fence = { char: marker[1][0], size: marker[1].length };
    else if (marker && fence && marker[1][0] === fence.char && marker[1].length >= fence.size && !marker[2].trim()) fence = null;
    part += line;
    if (!fence && /^\s*\n$/.test(line) && part.trim()) { parts.push(part); part = ""; }
  }
  if (part || !parts.length) parts.push(part);
  return parts;
}
