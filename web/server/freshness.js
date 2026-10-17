import { requestText } from "./request-profile.js";

const TRANSFORM = /^(?:please\s+)?(?:translate|rewrite|rephrase|proofread|paraphrase)\b|^(?:please\s+)?summari[sz]e\s+(?:this|the provided|the attached|my)\b/i;
const OFFLINE = /\b(?:do not|don't|dont|without|no)\s+(?:web\s+)?(?:search|browse|browsing|internet|lookups?)\b|\b(?:only|solely) (?:use|from|based on) (?:the |my |these )?(?:provided|attached|uploaded|document|text|files?)\b/i;
const VOLATILE = /\b(?:latest|newest|current(?:ly)?|recent(?:ly)?|today|tonight|tomorrow|yesterday|this (?:week|month|year)|news|weather|forecast|prices?|pricing|in stock|availability|released?|release date|launch(?:ed)?|ceo|president|prime minister|election|scores?|standings|exchange rate|interest rates?)\b/i;
const PRODUCTS = /\b(?:iphone|ipad|macbook|imac|airpods|apple watch|galaxy|pixel|oneplus|playstation|xbox|nintendo|geforce|radeon|ryzen|snapdragon|surface|thinkpad|python|react|vue|postgresql|mysql|windows|android|ios|chatgpt|claude|gemini)\b|\b(?:phone|smartphone|laptop|tablet|headphones|camera|gpu|cpu|processor|car|vehicle|software|subscription)\b|\b[a-z]{2,}[- ]?\d+(?:\.\d+)*\b/i;
const DECISION = /\b(?:compar\w*|vs\.?|versus|better|best|buy|upgrade|worth|recommend\w*|specs?|specifications?|features?|exists?|available|out yet|released?)\b/i;
const FOLLOWUP = /\b(?:which|what about|how about|does it|is it|has it|battery|camera|faster|cheaper|better|price|cost)\b/i;

// Freshness is independent of verbosity and research toggles. Only the person's
// request is searched: attachments, account data and model assertions stay out.
export function freshnessQuery(content, previous = "") {
  const text = requestText(content).trim();
  if (!text || TRANSFORM.test(text) || OFFLINE.test(text)) return null;
  const earlier = requestText(previous).trim();
  const followup = text.length < 180 && FOLLOWUP.test(text) && PRODUCTS.test(earlier) && !OFFLINE.test(earlier);
  const query = followup ? `${earlier}\n${text}` : text;
  if (!VOLATILE.test(text) && !(PRODUCTS.test(text) && DECISION.test(text)) && !followup) return null;
  return query.replace(/\s+/g, " ").slice(0, 600);
}
