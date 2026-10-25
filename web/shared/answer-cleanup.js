// Provider trust delimiters are metadata, not citations. Keep their payload
// and real Markdown links; leave literal code examples alone.
import { inlineCodeSpans, markdownFences } from './markdown-fences.js';

export function cleanAnswer(text = "") {
  const clean = part => part
    .replace(/\[{0,2}vaelo-weather:[0-9a-f]{24}\]{0,2}/g, "")
    .replace(/\[{0,2}vaelo-weather:[0-9a-f]{0,24}\]{0,2}$/g, "")
    .replace(/\[Vaelo request:[^\]\n]*\]/g, "")
    .replace(/(?:【|\[|<)\/?untrusted_tool_result\b[^\]】>\n]*(?:\]|】|>|$)/gi, "")
    .replace(/(?:【|\[|<)\/?(?:untrusted_tool_resul|untrusted_tool_resu|untrusted_tool_res|untrusted_tool_re|untrusted_tool_r|untrusted_tool_|untrusted_tool|untrusted_too|untrusted_to|untrusted_t|untrusted_|untrusted)\s*$/gi, "")
  ;
  const inline = part => {
    let out = '', at = 0;
    for (const [start, end] of inlineCodeSpans(part, true)) {
      out += clean(part.slice(at, start)) + part.slice(start, end);
      at = end;
    }
    return out + clean(part.slice(at));
  };
  let out = '', at = 0;
  for (const block of markdownFences(text, { containers: true })) {
    out += inline(text.slice(at, block.start)) + text.slice(block.start, block.end);
    at = block.end;
  }
  return out + inline(text.slice(at));
}
