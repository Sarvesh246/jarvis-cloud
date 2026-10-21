import { constrainedAnswer } from "../shared/answer-contract.js";

/* Sizing a reply before it is written. Each message is read here, with no
   model call, for two things: the shape its answer should take (a table for a
   comparison, numbered steps for a how-to, plain prose for a greeting) and how
   hard the model should think about it.

   Both are hints, never gates. A shape is a short line in the message's
   [Vaelo request: …] note; the model still writes the answer. The effort tier
   only moves reasoning depth and, for the simplest messages, which route
   answers. Anything uncertain lands on the ordinary path: a short question
   can still be hard or consequential, so "quick" needs positive evidence and
   any sign of tools, current facts, personal context or risk rules it out.

   Everything here is deterministic on the message text, so the note written
   into an earlier message is identical on every later turn. */

/* What the model is told for each shape. Kept to one sentence each, without
   semicolons, since notes are joined with them. */
export const SHAPES = {
  smalltalk: "reply shape: one or two natural sentences, no headings, lists or tables",
  support:
    "reply shape: warm, plain conversational prose that acknowledges how they feel before any suggestion, no headings, tables or bullet-heavy lists",
  comparison:
    "reply shape: a comparison, so give one Markdown table with a row per option and columns for the criteria that matter to their stated needs (price and key specs when relevant), mark any value you could not verify as unverified instead of guessing, then a short verdict naming the best option for each of their needs. Do not replace the table with per-option bullet lists",
  shopping:
    "reply shape: a shortlist, so give one Markdown table with a row per option and columns for price, the specs that matter to their stated uses and the main drawback, note how current the prices are and mark anything unverified, then a short verdict naming the best pick for each use",
  proscons:
    "reply shape: pros and cons as two short lists (or a two-column table), then a one-line bottom line",
  decision:
    "reply shape: a decision, so give your recommendation in the first sentence, then the reasons that decide it, then when the other choice would be better",
  recipe:
    "reply shape: a recipe, so a short ingredients list with quantities, then numbered steps, then timing and serving notes",
  howto:
    "reply shape: numbered steps in order with one action each, prerequisites first and a quick way to confirm it worked at the end",
  checklist:
    "reply shape: a task checklist in the checkbox list format from your instructions, grouped under short headings when long",
  plan:
    "reply shape: a plan organized by day or phase, with a ```timeline block for dated items or a heading per day or phase with short lists, then the key assumptions",
  history:
    "reply shape: a short overview sentence, then a ```timeline block of the key dates ('When: event — detail')",
  debugging:
    "reply shape: debugging, so state the most likely cause first, then the fix with exact code or commands in language-tagged fences, then how to confirm it is fixed, and other causes only if the first fix may not apply",
  troubleshooting:
    "reply shape: troubleshooting, so list the likely causes from quickest to check, then numbered fixes for each, and say when it needs a professional",
  code:
    "reply shape: one sentence on the approach, the complete code in one language-tagged fence, then brief notes on usage and edge cases, no long walkthrough unless asked",
  math:
    "reply shape: concise step-by-step working, with the final answer in bold on its own line",
  writing:
    "reply shape: the finished piece itself, ready to use, with no preamble or commentary (a subject line first for an email)",
  rewrite:
    "reply shape: only the revised text, keeping the meaning, plus a short list of notable changes only when the edits are substantive",
  translation: "reply shape: the translation only, with a note only on ambiguous phrases",
  summary:
    "reply shape: a one-line gist, then three to seven bullets of key points, adding nothing new",
  ideas: "reply shape: a numbered list of distinct options, each with a few words on why",
  practice:
    "reply shape: numbered questions first, then the answers together under an Answers heading",
  figures:
    "reply shape: a Markdown table for a series or several numbers (the period or category in the first column and one plain number with its unit per cell, so it can open as a chart), or a ```metrics block for two to six headline figures, with sources inline",
  explanation:
    "reply shape: clear prose that builds from the core idea with a concrete example or analogy, short headings only if it runs long, a table only if comparing",
  fact: "reply shape: one to three sentences of plain prose, no headings or lists",
  yesno: "reply shape: yes, no or it depends in the first words, then the reason briefly",
};

const EXPLICIT = [
  [/\b(?:in|as|into|with|make|give me|use|using|show)\s+(?:it\s+)?(?:a\s+|one\s+|the\s+)?(?:markdown\s+|comparison\s+|simple\s+)?(?:table|grid|spreadsheet)\b|\btabulate\b|\btable (?:format|form)\b/, "a table"],
  [/\b(?:no|without|avoid)\s+(?:bullets?|bullet points|lists?|tables?|headings?)\b|\bin (?:prose|paragraphs?|full sentences)\b|\bparagraph form\b/, "prose"],
  [/\b(?:bullet(?:ed)?\s*(?:points?|list)|in bullets|as (?:a )?(?:list|bullets))\b/, "a bulleted list"],
  [/\b(?:as|in|into|to)\s+(?:valid\s+)?(?:json|csv|yaml|xml|html|latex|markdown)\b/, "the named data format"],
  [/\b(?:just|only)\s+(?:the\s+)?(?:number|numeric result|final answer|answer|result)\b|\b(?:answer|result|number)\s+only\b|\b(?:no|without)\s+(?:explanation|working|steps)\b/, "the final answer only"],
  [/\b(?:one|1|single|two|2|three|3|a few)[- ](?:word|sentence|line|paragraph)s?\b|\b(?:tl;?dr|in short|short answer|keep it (?:short|brief)|briefly|in a nutshell)\b/, "the length they asked for"],
  [/\b(?:just|only) (?:the )?code\b|\bcode only\b/, "code only"],
];

const GREETING_WORDS = new Set((
  "hi hii hiii hey heyy hello helo hiya howdy yo sup gm gn good morning afternoon evening night day " +
  "there vaelo friend buddy bro dude thanks thank thankyou thanx thx ty tysm cheers you u so very much a lot " +
  "appreciate appreciated it that this was is it's that's helped helpful helps great nice cool awesome " +
  "amazing perfect wonderful brilliant lovely love bye goodbye see ya later soon take care how are r " +
  "doing today going what's whats wassup up lol haha hahaha wow all for your the help again too"
).split(" "));

const TOOL_WORDS =
  /https?:\/\/|www\.|\b(?:search|google|look (?:it )?up|lookup|find|browse|open|visit|download|upload|run|execute|install|deploy|send|email me|text me|remind|reminder|schedule|calendar|book|order|buy|file|files|folder|attachment|attached|document|pdf|spreadsheet|screenshot|image|photo|picture|link|website|page|repo|repository)\b/;
const CURRENT =
  /\b(?:today|tonight|tomorrow|yesterday|now|current(?:ly)?|latest|newest|recent(?:ly)?|this (?:week|month|year|season)|right now|news|price[sd]?|pricing|costs?|cheap(?:est)?|stock|shares?|weather|forecast|scores?|standings|deals?|sale|release[sd]?|launch(?:ed)?|update[sd]?|version|20[2-9]\d|open now|near me|next|upcoming|time in|what time|time is it|date|days? until|ceo|president|prime minister|leader|champion|winner|ranking|rankings)\b/;
const PERSONAL =
  /\b(?:my|me|mine|i|i'm|im|i've|i'd|i'll|we|our|us|remember|you said|earlier|last time|we discussed|before)\b/;
const RISKY =
  /\b(?:medical|medicine|medication|meds|dose|dosage|mg|symptoms?|diagnos\w*|pregnan\w*|doctor|disease|pain|injur\w*|legal|legally|lawsuit|sue|contract|lease|landlord|tax(?:es)?|irs|visa|immigration|invest\w*|loan|mortgage|debt|insurance|retirement|401k|ira|roth|crypto|side effects?|drugs?|pills?|prescription|vaccines?|treatment|cure|therapy|cancer|blood|surgery|mental health|depression|anxiety|safe to|is it safe|unsafe|dangerous|overdose|allerg\w*|suicid\w*|self[- ]harm|emergency)\b/;
const HARD =
  /\b(?:prove|proof|derive|derivation|analy[sz]e|analysis|trade-?offs?|in[- ]depth|deep dive|thorough(?:ly)?|step[- ]by[- ]step|architect(?:ure)?|design (?:a|an|the)|optimi[sz]e|optimi[sz]ation|strateg(?:y|ies)|evaluate|critique|root cause|edge cases?|rigorous(?:ly)?|complexity|algorithm|benchmark|scal(?:e|ing|ability)|concurren\w*|race condition|refactor)\b/;
const MATH_HARD =
  /\b(?:solve|integral|integrate|derivative|differentiate|equation|probability|theorem|matri(?:x|ces)|eigen\w*|limit of|series|converge\w*|statistic(?:s|al)|regression|hypothesis)\b/;
const CODE_SYNTAX =
  /```|^\s*(?:def|class|function|const|let|var|import|from|#include|public|private)\b|=>|\bconsole\.log\b|;\s*$/m;
const CODE_REQUEST =
  /\b(?:write|create|generate|build|implement|code|make)\b.*\b(?:function|script|program|class|component|regex|regular expression|sql|query|endpoint|api|cli|bot|algorithm|unit tests?|code|snippet|hook|module|app)\b|\b(?:in|using) (?:python|javascript|typescript|java|c\+\+|c#|rust|go|golang|ruby|php|swift|kotlin|bash|sql|powershell)\b|^(?:a )?regex\b/;
const WRITING_START =
  /^(?:please |can you |could you )?(?:write|draft|compose)\s+(?:me\s+)?(?:a|an|the|my|some)?\s*(?:short |quick |formal |polite |funny |heartfelt |professional |brief )?(?:email|e-mail|letter|cover letter|essay|post|caption|bio|speech|toast|poem|story|haiku|limerick|song|message|tweet|linkedin|announcement|invitation|review|statement|eulogy|reply|apology)\b/;
const CONVERSION =
  /^(?:convert|how many|what(?:'s| is))?\s*[\d.,]+\s*(?:°\s*)?[a-z]+\s+(?:to|in|into)\s+(?:°\s*)?[a-z]+\??$|^convert\b/;
/* Something physical or a device misbehaving, as opposed to code. */
const TROUBLE =
  /\b(?:keeps? (?:disconnecting|crashing|freezing|restarting|turning off|beeping|dropping)|won'?t (?:turn on|start|charge|connect|boot|drain|flush)|(?:does ?n[o']?t|is ?n[o']?t|not|stopped) (?:turning on|charging|connecting|cooling|heating|draining|flushing)|(?:clicking|grinding|squeaking|rattling|buzzing|weird|strange) (?:noise|sound)|leak(?:s|ing)?|overheat\w*|troubleshoot\w*|check engine|blue screen|no signal|slow (?:wifi|internet|laptop|computer|phone))\b/;
const ACK = /^(?:y|yes|yeah|yep|yup|sure|ok|okay|k|no|nope|nah|go ahead|do it|please|pls|continue|go on|more|next|again|retry|try again)\b/;

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/* The person's own words: an attached file's text and notes about earlier
   images are context, not the request. */
export function requestText(content) {
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.filter((part) => part?.type === "text").map((part) => part.text).join("\n")
      : "";
  return text
    .split(/\n\nAttached file: /)[0]
    .replace(/\[Image shared earlier: [^\]]*\]/g, "")
    .trim();
}

function wordsOf(text) {
  return text.replace(/[^\p{L}\p{N}'\s]/gu, " ").split(/\s+/).filter(Boolean);
}

function smallTalk(text) {
  const words = wordsOf(text);
  return words.length > 0 && words.length <= 9 && words.every((word) => GREETING_WORDS.has(word));
}

function explicitFormat(text) {
  for (const [pattern, label] of EXPLICIT) if (pattern.test(text)) return label;
  if (constrainedAnswer(text)) return "explicit output and length constraints";
  return null;
}

/* Ordered: the first match wins, so the more specific readings come first. */
function inferShape(text, raw) {
  if (smallTalk(text)) return "smalltalk";
  if (/\b(?:i feel|i'm feeling|im feeling|i am feeling|feeling (?:so |really )?(?:down|low|sad|anxious|lonely|lost|stuck|overwhelmed|hopeless)|i'm (?:so |really )?(?:stressed|anxious|depressed|sad|lonely|overwhelmed|burnt out|burned out|heartbroken|scared|worried)|break ?up|broke up|grief|griev\w*|passed away|lost my (?:job|mom|dad|mother|father|friend|dog|cat))\b/.test(text))
    return "support";
  if (/\b(?:traceback|stack ?trace|exception|segfault|syntaxerror|typeerror|referenceerror|valueerror|keyerror|nullpointer\w*|undefined is not|cannot read propert|error:|errors? (?:when|while|on|in)|throws?|bug|crash(?:es|ed|ing)?|(?:does ?n[o']?t|is ?n[o']?t|not|won'?t|stopped) (?:work|working|compil\w*|running|load\w*|start\w*)|debug|fails?|failing|broken)\b|(?:n't|\bnot)\b(?:\s+\S+){0,4}\s+(?:work|working|running|compiling|loading)\b/.test(text) &&
      (CODE_SYNTAX.test(raw) || /\b(?:code|script|function|app|build|compile|server|api|query|program|error|exception|traceback|test|npm|pip|python|javascript|typescript|react|node|java|rust|sql|css|html|docker|git)\b/.test(text)))
    return "debugging";
  if (TROUBLE.test(text)) return "troubleshooting";
  /* Writing a piece is named up front ("write an email…"); code is named by
     what is built, and a "top 3" inside a query is not a shortlist. */
  if (WRITING_START.test(text)) return "writing";
  if (CODE_REQUEST.test(text)) return "code";
  if (/\bpros (?:and|&) cons\b|\badvantages and disadvantages\b|\bupsides? and downsides?\b/.test(text) &&
      !/\b(?:vs\.?|versus|compare|comparison|between)\b/.test(text))
    return "proscons";
  if (/\b(?:best|top|good|cheapest|recommended)\s+(?:\d+|two|three|four|five|six|seven|eight|nine|ten|few|several)\b|\b(?:best|top|good|cheap|affordable|budget)\s+[\w-]+(?:\s+[\w-]+)?\s+(?:under|below|for less than|around|within)\s+\$?\d|\b(?:which|what)\s+[\w-]+(?:\s+[\w-]+)?\s+should i (?:buy|get|choose|pick)\b|\b(?:recommend|suggest)\s+(?:some|a few|\d+|me (?:some|a))\s+[\w-]+.*\b(?:under|for|budget)\b/.test(text))
    return /\$|\busd\b|\bbudget\b|\b(?:under|below)\s+\$?\d|\bprice|\bshould i (?:buy|get|choose|pick)\b/.test(text) ? "shopping" : "comparison";
  if (/\b(?:compare|comparison|comparing|vs\.?|versus|differences? between|difference of|how (?:does|do|is|are) .+ (?:differ|compare)|(?:better|worse|faster|cheaper|stronger) than|which (?:one |is |are )?(?:is |are )?(?:better|best|faster|cheaper|stronger|easier)|what(?:'s|s| is) (?:better|best|faster|cheaper|the better)|side[- ]by[- ]side|head[- ]to[- ]head)\b/.test(text) ||
      /^[\p{L}\p{N} .+#'-]{1,40} or [\p{L}\p{N} .+#'-]{1,40}(?: for [\p{L}\p{N} .'-]{1,40})?\?$/u.test(text) && !/^(?:should|do|does|is|are|can|will|would) /.test(text))
    return "comparison";
  if (/\b(?:recipe|how (?:do i|to|can i) (?:cook|bake|make (?:a |an |some )?(?:\w+ )?(?:cake|bread|pasta|soup|curry|cookies|pizza|sauce|salad|dinner|breakfast|lunch)))\b/.test(text))
    return "recipe";
  if (/\b(?:checklist|packing list|to-?do list|what (?:should|do) i (?:pack|bring)|what to (?:pack|bring))\b/.test(text))
    return "checklist";
  if (/\b(?:itinerary|schedule|study plan|meal plan|workout plan|training plan|roadmap|routine|week[- ]by[- ]week|day[- ]by[- ]day|(?:\d+|one|two|three|four|five|six|seven)[- ](?:day|week|month)s?\s+(?:plan|trip|program|schedule))\b|\bplan (?:a|my|out|for)\b/.test(text))
    return "plan";
  if (/\b(?:history of|timeline of|chronology|chronological|key events|major events|how did .+ (?:start|begin|evolve))\b/.test(text))
    return "history";
  if (/^[\d\s+\-*/×÷^().,%=x?]+$/.test(text) && /\d\s*[-+*/×÷^x%]\s*\d/.test(text) || CONVERSION.test(text) ||
      /\b(?:solve|calculate|compute|integral|integrate|derivative|differentiate|simplify|factor(?:ise|ize)?|equation|probability|what(?:'s| is) \d[\d,.]*\s*(?:%|percent)\s*of|how much is \d)\b/.test(text))
    return "math";
  if (/\b(?:translate|translation|in (?:spanish|french|german|italian|portuguese|japanese|chinese|mandarin|korean|hindi|arabic|russian|marathi|dutch|turkish))\b/.test(text) &&
      /\b(?:translate|translation|say|how do (?:you|i) say|into|to)\b/.test(text))
    return "translation";
  if (/^(?:please )?(?:rewrite|rephrase|reword|paraphrase|proofread|edit|polish|shorten|condense|tighten|correct|fix (?:the |my |this )?(?:grammar|spelling|typos|wording))\b|\bmake (?:this|it|that) (?:sound )?(?:more|less|shorter|longer|clearer|simpler|formal|casual|polite|professional|friendlier|friendly|concise)\b/.test(text))
    return "rewrite";
  if (/\b(?:summari[sz]e|summary|tl;?dr|key (?:points|takeaways)|main points|gist)\b/.test(text))
    return "summary";
  if (/\b(?:write|draft|compose|create)\b.*\b(?:email|e-mail|letter|cover letter|essay|post|caption|bio|speech|toast|poem|story|haiku|limerick|song|message|text|tweet|linkedin|announcement|invitation|review|resume|résumé|statement|eulogy|reply|response|apology)\b/.test(text))
    return "writing";
  if (/\b(?:quiz me|flash ?cards?|practice (?:questions|problems)|test me|mock (?:exam|test)|exam questions)\b/.test(text))
    return "practice";
  if (/\b(?:ideas?|brainstorm|suggestions?|names? for|name ideas|ways to|tips (?:for|on|to)|things to do|gift(?:s)? for|list (?:of|some|\d+)|what (?:should|can|could) (?:i|we) do|give me (?:\d+|some|a few|ten|five))\b/.test(text))
    return "ideas";
  if (/^(?:should i|should we|is it worth|would it be (?:better|worth)|do i need to|is it better to|which should i)\b|\bshould i (?:buy|get|take|choose|go|switch|learn|use|accept|quit|move)\b/.test(text))
    return "decision";
  if (/\b(?:how to|how do i|how can i|how should i|steps? (?:to|for)|walk me through|guide (?:me|to)|set ?up|setting up|install(?:ing)?|configure|tutorial|teach me how)\b/.test(text))
    return "howto";
  if (/\b(?:statistics|stats|figures|data on|numbers on|growth of|trend(?:s)? in|market size|population of|gdp|revenue|how many .+ (?:per year|each year|over time|since))\b/.test(text))
    return "figures";
  if (/\b(?:explain|eli5|explain like|how does|how do .+ work|why (?:does|do|is|are|did|was|were|can't|can|don't)|what causes|what happens (?:when|if)|help me understand|what's the reason|the reason why|meaning of life)\b/.test(text))
    return "explanation";
  if (/^(?:is|are|can|could|does|do|did|will|would|was|were|has|have|am)\b/.test(text) && wordsOf(text).length <= 16)
    return "yesno";
  if (/^(?:what is|what's|what are|what was|what were|what does|what do .+ mean|define|definition of|meaning of|who (?:was|wrote|invented|discovered|painted|founded|directed|composed)|when (?:was|did|is)|where (?:is|was|are|did)|how (?:many|much|long|far|old|tall|big))\b/.test(text) &&
      wordsOf(text).length <= 18)
    return "fact";
  return null;
}

/* Answerable from the message itself, with no tool, current fact, personal
   context or risk: the only messages sent to the fast text route. */
function quick(shape, text) {
  if (shape === "smalltalk") return true;
  /* For a rewrite or translation the text after the colon is the material,
     not the ask: "send the file asap" is a sentence to polish, not a tool. */
  if ((shape === "rewrite" || shape === "translation") && /[:\n]/.test(text)) {
    const [ask, ...rest] = text.split(/[:\n]/);
    if (TOOL_WORDS.test(ask) || CURRENT.test(ask) || PERSONAL.test(ask) || /https?:\/\/|www\./.test(text)) return false;
    return wordsOf(rest.join(" ")).length <= (shape === "rewrite" ? 400 : 80);
  }
  const words = wordsOf(text).length;
  if (TOOL_WORDS.test(text) || CURRENT.test(text) || RISKY.test(text) || HARD.test(text)) return false;
  if (shape === "math")
    return /^[\d\s+\-*/×÷^().,%=x?]+$/.test(text) ||
      /^what(?:'s| is) \d[\d,.]*\s*(?:%|percent)\s*of\s*\d/.test(text) ||
      CONVERSION.test(text) && words <= 10;
  if (PERSONAL.test(text)) return false;
  /* "this error" or "that one" points at something earlier or attached, and
     "the best way" asks for advice rather than a fact. */
  if (shape === "fact")
    return words <= 14 && !/\b(?:this|that|these|those|it|best|good|way|should|recommend\w*)\b/.test(text);
  if (shape === "translation") return words <= 80;
  if (shape === "rewrite") return words <= 400;
  return false;
}

function deep(shape, text, raw, { images, attachments }) {
  if (shape === "debugging") return true;
  if (HARD.test(text) || RISKY.test(text) || MATH_HARD.test(text) && shape === "math") return true;
  if ((shape === "comparison" || shape === "shopping" || shape === "decision") &&
      (wordsOf(text).length > 14 || (text.match(/,/g) || []).length >= 2)) return true;
  if ((raw.match(/\?/g) || []).length >= 3) return true;
  if (raw.length > 2500 && shape !== "rewrite" && shape !== "translation") return true;
  if (attachments && /\b(?:review|analy[sz]e|check|audit|find|explain|compare|what's wrong|issues?)\b/.test(text)) return true;
  return images && /\b(?:solve|analy[sz]e|diagnos\w*|what's wrong|debug|explain)\b/.test(text);
}

/* The profile of the newest message: its shape note, how hard to think, and
   whether it may take the fast text route. */
export function profileRequest(content, {
  style = "balanced", research = false, role = "none", work = false, previous = "",
} = {}) {
  const raw = requestText(content);
  const text = normalize(raw);
  const images = Array.isArray(content) && content.some((part) => part?.type === "image_url");
  const attachments = typeof content === "string"
    ? /\n\nAttached file: /.test(content)
    : Array.isArray(content) && content.some((part) => part?.type === "text" && /\n\nAttached file: /.test(part.text));
  const explicit = explicitFormat(text);
  const shape = inferShape(text, raw);
  /* A bare "yes" or "go ahead" answers whatever the last reply asked, which
     may be a search or a change, so it never counts as small talk. */
  const answering = ACK.test(text) && wordsOf(text).length <= 4 && /\?\s*$/.test(String(previous).trim());
  let tier = "normal";
  if (research || style === "thorough" || role === "skeptic" || role === "advocate") tier = "deep";
  else if (deep(shape, text, raw, { images, attachments })) tier = "deep";
  else if (!answering && !images && !attachments && !work && role === "none" && quick(shape, text)) tier = "quick";
  // A bounded, self-contained calculation needs reasoning, but not an agent
  // bootstrap and tool schemas. Keep its effort tier on the direct route.
  const directMath = shape === "math" && raw.length <= 1800 &&
    !images && !attachments && !work && !research && role === "none" &&
    !HARD.test(text) && !RISKY.test(text) && !CURRENT.test(text) &&
    !TOOL_WORDS.test(text.replace(/\bfind\b/g, ""));
  return {
    shape: explicit ? "explicit" : shape,
    explicit,
    tier,
    fast: (tier === "quick" || directMath) && style !== "thorough",
  };
}

/* The line a message's note carries for its shape, or "" for none. */
export function shapeNote(content) {
  const text = normalize(requestText(content));
  if (!text) return "";
  const explicit = explicitFormat(text);
  if (explicit) return `reply shape: use exactly the format they asked for (${explicit})`;
  const shape = inferShape(text, requestText(content));
  return shape ? SHAPES[shape] : "";
}
