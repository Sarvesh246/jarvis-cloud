import policy from './output-policy.json' with { type: 'json' };
const patterns = Object.entries(policy).filter(([key]) => key !== 'inLength').map(([, source]) => new RegExp(source, 'i'));
const inLengthPattern = new RegExp(policy.inLength, 'i');
const jsonPattern = new RegExp(policy.json, 'i');
const askText = content => (typeof content === 'string' ? content : Array.isArray(content)
  ? content.filter(part => part?.type === 'text').map(part => part.text).join('\n') : '')
  .split(/\n\n(?:Attached file: |\[Vaelo request:|\[Selected Vaelo workspace:)/)[0]
  .replace(/```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~/g, '');

// Exact text is data. The browser must not repair punctuation, interpret
// Markdown or infer widgets inside a requested raw-format answer.
export function literalAnswerRequested(content = '') {
  const text = askText(content);
  return jsonPattern.test(text) ||
    /(?:^|\b(?:as|in|using|with)\s+)raw (?:json|csv|tsv|text|code)\b|\b(?:(?:json|csv|tsv|code|text)[ -]only|(?:no|without) markdown)\b/i.test(text) ||
    /\b(?:in|as|using|with|use|return|output|give|reply|respond|answer)\s+(?:(?:only|just|the)\s+)?plain[ -]text\b|\bplain[ -]text\s+(?:only|please)\b|^\s*plain[ -]text\s*[.!?]?\s*$/i.test(text) ||
    /(?:^|[.!?]\s+|\n|,\s+|\band\s+)(?:(?:please|can you|could you|would you)\s+)?(?:return|output|give|reply|respond|answer)(?:\s+me)?\s+(?:(?:with|as|in|only|just|the|a|an|one|single|valid|raw)\s+)*(?:json|csv|tsv|source code)\b/i.test(text) ||
    /\b(?:return|output|give|reply|respond|answer)\s+(?:(?:with|only|just|the)\s+)*(?:code)\s*(?:[.!?]|$)/i.test(text);
}
// Inspect the ask, not instructions quoted in attached data or server notes.
// This selects guidance; it does not claim to validate a model's answer.
export function constrainedAnswer(content = "") {
  const text = askText(content);
  const lengthText = text.replace(/"[^"\n]*"|“[^”\n]*”|(?<!\w)'[^'\n]*'/g, '');
  return patterns.some(pattern => pattern.test(text)) || inLengthPattern.test(lengthText) ||
    /\bpython\b/i.test(text) && /\b(?:include|provide|show|supply|return|with|run|execute)\s+(?:(?:runnable|unit|the|these|following|assertion|synchronous)\s+)*(?:tests|assertions)\b/i.test(text) ||
    /\b(?:only|just)\s+(?:(?:with|one|a|an|the|valid|single|final|conventional|literal|direct|those|these|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)*(?:json|csv|code|answer|translation|results?|number|word|sentence|line|object)\b|\b(?:json|csv|code|prose|text)[ -]only\b|\braw (?:json|csv|text)\b|\bplain text\b/i.test(text);
}

export const ANSWER_CONTRACT_GUIDANCE = "Explicit output requirements take precedence over teaching, style and presentation defaults. For answer-only, code-only or raw JSON/CSV, return only that requested content, without cards, headings, fences unless requested, preambles or follow-up offers. Obey stated word, sentence and line limits. Check the final answer against every requested field and constraint before sending. Resolve conflicting intermediate calculations privately; publish one consistent checked result. Never quote or expose internal [Vaelo request: ...] annotations.";
