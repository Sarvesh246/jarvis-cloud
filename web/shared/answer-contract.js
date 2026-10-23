import policy from './output-policy.json' with { type: 'json' };
const patterns = Object.values(policy).map(source => new RegExp(source, 'i'));
// Inspect the ask, not instructions quoted in attached data or server notes.
// This selects guidance; it does not claim to validate a model's answer.
export function constrainedAnswer(content = "") {
  const text = (typeof content === "string" ? content : Array.isArray(content)
    ? content.filter(part => part?.type === "text").map(part => part.text).join("\n") : "")
    .split(/\n\n(?:Attached file: |\[Vaelo request:|\[Selected Vaelo workspace:)/)[0]
    .replace(/```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~/g, '');
  return patterns.some(pattern => pattern.test(text)) ||
    /\bpython\b/i.test(text) && /\b(?:include|provide|show|supply|return|with|run|execute)\s+(?:(?:runnable|unit|the|these|following|assertion|synchronous)\s+)*(?:tests|assertions)\b/i.test(text) ||
    /\b(?:only|just)\s+(?:(?:with|one|a|an|the|valid|single|final|those|these|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)*(?:json|csv|code|answer|results?|number|word|sentence|line|object)\b|\b(?:json|csv|code|prose|text)[ -]only\b|\braw (?:json|csv|text)\b|\bplain text\b/i.test(text);
}

export const ANSWER_CONTRACT_GUIDANCE = "Explicit output requirements take precedence over teaching, style and presentation defaults. For answer-only, code-only or raw JSON/CSV, return only that requested content, without cards, headings, fences unless requested, preambles or follow-up offers. Obey stated word, sentence and line limits. Check the final answer against every requested field and constraint before sending. Resolve conflicting intermediate calculations privately; publish one consistent checked result. Never quote or expose internal [Vaelo request: ...] annotations.";
