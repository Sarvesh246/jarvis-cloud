import { requestText } from "./request-profile.js";

const TRANSFORM = /^(?:(?:please|can you|could you|would you)\s+)*(?:translate|rewrite|rephrase|proofread|paraphrase)\b|^(?:(?:please|can you|could you|would you)\s+)*summari[sz]e\s+(?:this|the provided|the attached|my)\b/i;
const OFFLINE = /\b(?:do not|don't|dont|without|no)\s+(?:web\s+)?(?:search|browse|browsing|internet|lookups?)\b|\b(?:only|solely) (?:use|from|based on) (?:the |my |these )?(?:provided|attached|uploaded|document|text|files?)\b/i;
const VOLATILE = /\b(?:latest|newest|current(?:ly)?|recent(?:ly)?|today|tonight|tomorrow|yesterday|this (?:week|month|year)|news|weather|forecast|prices?|pricing|in stock|availability|released?|release date|launch(?:ed)?|ceo|president|prime minister|election|scores?|standings|exchange rate|interest rates?)\b/i;
const PRODUCTS = /\b(?:iphone|ipad|macbook|imac|airpods|apple watch|galaxy|pixel|oneplus|playstation|xbox|nintendo|geforce|radeon|ryzen|snapdragon|surface|thinkpad|python|react|vue|postgresql|mysql|windows|android|ios|chatgpt|claude|gemini)\b|\b(?:phone|smartphone|laptop|tablet|headphones|camera|gpu|cpu|processor|car|vehicle|software|subscription)\b|\b[a-z]{2,}[- ]?\d+(?:\.\d+)*\b/i;
const DECISION = /\b(?:compar\w*|vs\.?|versus|better|best|buy|upgrade|worth|recommend\w*|specs?|specifications?|features?|exists?|available|out yet|released?)\b/i;
const FOLLOWUP = /\b(?:which|what about|how about|does it|is it|has it|battery|camera|faster|cheaper|better|price|cost)\b/i;
const SUBJECT = /\b(?:iphone|ipad|macbook|imac|airpods|apple watch|galaxy|pixel|oneplus|playstation|xbox|nintendo|geforce|radeon|ryzen|snapdragon|surface|thinkpad|python|react|vue|postgresql|mysql|windows|android|ios|chatgpt|claude|gemini)\b|\b[a-z]{2,}[- ]?\d+(?:\.\d+)*\b|\b(?:compare|vs|versus|buy|recommend\w*|specs?|specifications?|latest)\b/i;
const LOOKUP = /\b(?:search (?:the )?(?:web|internet|online)|browse|look (?:it |this |that )?up|look up|find (?:sources|citations)|fact[- ]check)\b/i;
const PUBLIC_DATA = /^(?:define|definition of|meaning of|pokemon|UK postcode)\s|\b(?:find|search)\s+(?:books?|research papers|scholarly papers|journal articles|magic card)\s+(?:about|on|for|called|titled)?\s*|^(?:search|find|look up)\s+.+\s+(?:on|using|via)\s+\S|\b(?:hacker\s*news|product\s*hunt|npm package|pypi package|decode VIN|food barcode|barcode \d{8,14}|air quality|aqi)\b/i;
const HEALTH = /\b(?:medication|medicine|prescription|ibuprofen|acetaminophen|paracetamol|aspirin|antibiotics?|insulin|dosage|dose|symptoms?|treatment|pregnan\w*|chest pain)\b/i;
const LAW_MONEY = /\b(?:legal|laws?|landlord|evict\w*|lease|tax(?:es)?|visa|immigration|invest\w*|stocks?|mortgage|insurance|retirement|401k|roth|ira)\b/i;
const ADVICE = /\b(?:should|can i|can my|can you|safe|safety|take|taking|mix|combine|stop|treat|manage|relieve|dose|dosage|how (?:do|can|much|many)|allowed|rights?|required|eligible|deduct|recommend\w*|best)\b/i;
const CURRENCIES = /\b(?:usd|eur|gbp|inr|jpy|cad|aud|chf|cny|dollars?|euros?|pounds?|rupees?|yen)\b/gi;

function currencyLookup(text) {
  const currencies = new Set((text.match(CURRENCIES) || []).map(value => value.toLowerCase()));
  const suppliedRate = /\b(?:at|using|assuming|given)\s+(?:(?:a|an|the)\s+)?(?:exchange\s+)?rate\b|\b(?:at|using|assuming|given)\s+\d+(?:\.\d+)?\s*(?:usd|eur|gbp|inr|jpy|cad|aud|chf|cny)\b|\b\d+(?:\.\d+)?\s*[a-z]{3}\s*=\s*\d/i.test(text);
  return currencies.size > 1 && /\b(?:convert|to|into|in|worth)\b/i.test(text) && !suppliedRate;
}

const QUICK = /\b(?:weather|forecast|temperature|rain|snow|time in|scores?|stock price|share price|exchange rate|price of|how much is|who won|sunrise|sunset)\b/i;
const FEED_LOOKUP = /^(?:(?:show(?: me)?|get|what(?:'?s| is))\s+)?(?:(?:top|new|best|ask|show|job)\s+)?(?:hacker\s*news|HN)(?:\s+(?:stories|headlines|today))?[?.!]?$/i;
const LAUNCH_LOOKUP = /^(?:(?:show(?: me)?|get|what(?:'?s| is))\s+)?(?:today'?s?\s+)?product\s*hunt(?:\s+(?:launches|products|today))?[?.!]?$/i;
const LOCAL = /\b(?:weather|forecast|temperature|rain|snow|near me|nearby|around here|open now|sunrise|sunset|local)\b/i;

// A short look-up whose answer is one fact from a search result. Evidence is
// fetched first, so a fast model can state it without a tool-using agent.
export function simpleLookup(content) {
  const text = requestText(content).replace(/[’‘]/g, "'").trim();
  return text.length <= 120 && (QUICK.test(text) || FEED_LOOKUP.test(text) || LAUNCH_LOOKUP.test(text)) && !HEALTH.test(text) && !LAW_MONEY.test(text);
}

// "weather today" means weather where they are, when they have said where.
export function placeLabel(place) {
  return [place?.city, place?.region].filter(Boolean).join(", ") || (place ? `${place.lat}, ${place.lon}` : "");
}

export function localizedQuery(query, place) {
  if (!query || !place || !LOCAL.test(query) || /\b(?:in|at|near|for)\s+(?!(?:me|here|today|tonight|tomorrow|this|my|the)\b)[\p{L}][\p{L} .'-]+/iu.test(query)) return query;
  return `${query} in ${placeLabel(place)}`.slice(0, 600);
}

// Freshness is independent of verbosity and research toggles. Only the person's
// request is searched: attachments, account data and model assertions stay out.
export function freshnessQuery(content, previous = "") {
  const text = requestText(content).replace(/[’‘]/g, "'").trim();
  if (!text || TRANSFORM.test(text) || OFFLINE.test(text)) return null;
  const history = (Array.isArray(previous) ? previous : [previous]).map(requestText);
  const context = [];
  let followup = false;
  if (text.length < 180 && FOLLOWUP.test(text)) {
    for (const earlier of history.slice(-4).reverse()) {
      if (OFFLINE.test(earlier) && !LOOKUP.test(text)) return null;
      if (!earlier || TRANSFORM.test(earlier)) break;
      context.unshift(earlier);
      if (PRODUCTS.test(earlier) && (SUBJECT.test(earlier) || !FOLLOWUP.test(earlier))) {
        followup = true;
        break;
      }
      if (earlier.length >= 180 || !FOLLOWUP.test(earlier)) { context.length = 0; break; }
    }
  }
  const consequential = ADVICE.test(text) && (HEALTH.test(text) || LAW_MONEY.test(text));
  if (!VOLATILE.test(text) && !LOOKUP.test(text) && !PUBLIC_DATA.test(text) && !consequential && !currencyLookup(text) &&
      !(PRODUCTS.test(text) && DECISION.test(text)) && !followup) return null;
  // Keep the newest constraints even when earlier context fills the budget.
  const current = text.replace(/\s+/g, " ");
  if (!followup) return current.slice(0, 600);
  const prefix = context.join(" ").replace(/\s+/g, " ").slice(0, Math.max(0, 599 - current.length));
  return `${prefix} ${current}`.trim();
}
