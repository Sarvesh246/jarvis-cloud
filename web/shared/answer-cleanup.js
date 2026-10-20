// Provider trust delimiters are metadata, not citations. Keep their payload
// and real Markdown links; leave literal code examples alone.
export function cleanAnswer(text = "") {
  return text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g).map((part, i) => i % 2 ? part : part
    .replace(/\[{0,2}vaelo-weather:[0-9a-f]{24}\]{0,2}/g, "")
    .replace(/\[{0,2}vaelo-weather:[0-9a-f]{0,24}\]{0,2}$/g, "")
    .replace(/\[Vaelo request:[^\]\n]*\]/g, "")
    .replace(/(?:【|\[|<)\/?untrusted_tool_result\b[^\]】>\n]*(?:\]|】|>|$)/gi, "")
    .replace(/(?:【|\[|<)\/?(?:untrusted_tool_resul|untrusted_tool_resu|untrusted_tool_res|untrusted_tool_re|untrusted_tool_r|untrusted_tool_|untrusted_tool|untrusted_too|untrusted_to|untrusted_t|untrusted_|untrusted)\s*$/gi, "")
  ).join("");
}
