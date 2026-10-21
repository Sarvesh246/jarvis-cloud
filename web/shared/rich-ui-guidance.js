import { seriesTable, suppliedFigures } from "./supplied-data.js";
import { constrainedAnswer } from "./answer-contract.js";

// Worked mathematics belongs in ordinary Markdown/LaTeX, where each line
// can stream and be typeset. A generic "how do I" must not force UI JSON.
const mathRequest = (text) => /\b(?:solve|equation|integral|derivative|differentiate|asymptotes?|polynomial|concentration|mixing tank)\b|\\(?:frac|int|sum)\b/i.test(text);

// Shared by the normal and direct routes. Selection adds no model request.
export const RICH_UI_GUIDANCE = [
  "Choose these cards automatically when the answer benefits from them, even without a UI request. Use one fenced vaelo-ui block containing valid JSON for a shape Markdown cannot express.",
  "Use only supplied or verified data and real HTTPS URLs; do not invent content to fill a widget. Schema: {type,title,...}.",
  "Types: overview or widgets: items:[{label,value,detail?,chips?:string[]}]; integrations: items:[{label,value,detail?,direction?:source|destination}]; steps: items:[string]; graph: nodes:[{id,label,role?}],edges:[{from,to,label?}]; files: paths:[string]; gallery: images:[{src,alt}],view?:grid|carousel; image-compare: before:{src,alt},after:{src,alt}; code-compare: before:string,after:string; receipt: currency:ISO4217,people?:integer,items:[{label,amount:number,detail?}]; qr: url:string; model: src:HTTPS .glb URL,alt:string.",
  "For example, an overview is written as a real JSON fence, with ordinary unescaped property quotes:\n```vaelo-ui\n" +
    JSON.stringify({
      type: "overview",
      title: "Trip",
      items: [
        { label: "Total", value: "$715" },
        { label: "Hotel", value: "$480" },
      ],
    }) +
    "\n```",
  "Use steps for guided procedures, graph for evidenced dependencies, files for folder layouts, gallery for verified image sets, image-compare or code-compare for two actual versions, receipt for supplied itemized costs, qr for a public link to open on a phone, model for a supplied .glb, and integrations for a proposed workflow. Overview cards carry a few unordered summary figures; widget stacks carry supporting details. Figures over time or across categories are never overview cards: write them as a Markdown table, which draws itself as a chart.",
  "Never replace these views with ASCII art or a table inside a code fence. Prefer ordinary Markdown tables for comparisons and numeric series, checklists for actionable lists, and metrics for simple figures. A timeline event may use [done], [current] or [upcoming] immediately after its date only when that state is established; past dates alone do not prove completion.",
  "Graph edges require evidence; receipts only sum supplied line items; code comparisons need both real versions. Only show integration directions when supplied or clearly proposed. Never imply integrations are connected, a receipt was paid, a QR transfers account state, or a model file was created.",
  "If required inputs are unavailable, explain that in prose instead of fabricating them. Keep blocks small: at most 24 images/nodes, 40 items, 12 overview cards and 8 chips per card; code versions under 8000 chars. Keep prose outside JSON brief, preserve citations outside the card, and do not duplicate the same information in a second table or list. Respect explicit plain-text, code-only, raw JSON, and answer-only requests.",
].join(" ");

export function richPresentationFor(text = "") {
  if (constrainedAnswer(text)) return null;
  if (mathRequest(text)) return null;
  if (/\b(?:in|as|into) (?:a |the )?table\b/i.test(text)) return null;
  if (
    /\b(?:write|implement|generate|build)\b.{0,28}\b(?:code|script|program|function|component)\b|\breturn\b.{0,16}\bsource code\b/is.test(
      text,
    )
  )
    return null;
  if (
    /\b(?:plain text|prose only|text only|no (?:widgets|charts|tables|interactive (?:ui|elements))|raw json|json only|code only|(?:just|only) (?:the )?(?:answer|number)|(?:return|give|show) (?:me )?(?:the )?source code)\b/i.test(
      text,
    )
  )
    return null;
  if (
    /\b(?:code (?:comparison|diff)|compare (?:these |the )?(?:code|versions)|before.{0,30}after.{0,30}code|what (?:changed|is different).{0,45}(?:code|versions|implementations))\b/is.test(
      text,
    )
  )
    return "code-compare";
  if (
    /\b(?:before.{0,30}after (?:images?|photos?)|compare.{0,30}(?:photos|pictures|images)|(?:difference|changed).{0,30}(?:photos|pictures|images))\b/is.test(
      text,
    )
  )
    return "image-compare";
  if (
    /\b(?:workflow|integrations? cards|automate.{0,60}(?:email|receipts|sheets|files)|how could.{0,60}(?:systems|services).{0,30}(?:work|fit) together)\b/is.test(
      text,
    )
  )
    return "integrations";
  if (
    /\b(?:relationship (?:graph|diagram)|dependency (?:graph|diagram)|architecture|dependencies|(?:systems|services) (?:fit|work) together|how.{0,30}(?:connect|depend))\b/is.test(
      text,
    ) ||
    (/\b(?:browser|api|service|system|database)\b/i.test(text) &&
      /\b(?:calls|reads|checks|connects to|sends to)\b/i.test(text))
  )
    return "graph";
  if (
    /\b(?:itemi[sz]ed? (?:receipt|expenses?|costs?)|split.{0,40}(?:bill|cost|expenses?|tab|dinner)|(?:bill|cost|expenses?|tab|dinner).{0,40}split|who owes what|(?:we|i) (?:paid|spent).{0,120}(?:total|each|owe|cost))\b/is.test(
      text,
    )
  )
    return "receipt";
  if (
    /\b(?:walk me through|guide me through|one step at a time|how (?:do i|can i|to)|step.by.step|instructions for|teach me (?:how|to))\b/i.test(
      text,
    )
  )
    return "steps";
  if (
    /\b(?:file tree|folder tree|(?:project|folder|directory|repository|repo) (?:structure|layout)|organi[sz]e.{0,60}(?:files|folders|repository|repo|project|codebase)|concrete paths|file browser|(?:file|directory|folder) (?:structure|layout|organi[sz]ation)|where (?:should|do|would) (?:i|we) (?:put|place|keep|store).{0,40}(?:files|code|components|tests))\b/i.test(
      text,
    )
  )
    return "files";
  if (
    /\b(?:image (?:board|gallery|carousel)|moodboard|inspiration board|(?:browse|look through|look closer|inspect|zoom into).{0,30}(?:photos|images|pictures|details)|(?:design|room|studio|visual) (?:references|inspiration|ideas))\b/i.test(
      text,
    )
  )
    return "gallery";
  if (/\b(?:qr(?: code)?|(?:open|scan).{0,40}(?:phone|device))\b/is.test(text))
    return "qr";
  if (/\b(?:3d model|\.glb\b)/i.test(text)) return "model";
  if (
    /\b(?:widget stack|supporting (?:details|assumptions)|assumptions behind|key (?:risks|considerations)|trade.?offs to consider|(?:explain|walk through|break down|list|outline) (?:the |these |my )?(?:assumptions|key factors|considerations|risks|reasons|constraints))\b/i.test(
      text,
    )
  )
    return "widgets";
  if (
    /\b(?:bento|overview cards|summari[sz]e|summary of|at a glance|key takeaways|quick overview|give me (?:an? )?(?:overview|snapshot))\b/i.test(
      text,
    ) &&
    !/\b(?:compare|versus|over time|monthly trend|revenue growth)\b/i.test(text)
  )
    return "overview";
  return null;
}

const FOCUS_EXAMPLES = {
  overview: {
    type: "overview",
    title: "Summary",
    items: [
      { label: "Supplied total", value: "$12" },
      { label: "Supplied part", value: "$7" },
    ],
  },
  widgets: {
    type: "widgets",
    title: "Supporting details",
    items: [
      {
        label: "Supplied assumption",
        value: "Short statement",
        detail: "Supporting explanation",
      },
    ],
  },
  files: {
    type: "files",
    title: "Project layout",
    paths: ["src/main.js", "README.md"],
  },
  gallery: {
    type: "gallery",
    title: "Supplied images",
    view: "grid",
    images: [
      {
        src: "https://example.com/supplied.jpg",
        alt: "Supplied image description",
      },
    ],
  },
  "image-compare": {
    type: "image-compare",
    before: {
      src: "https://example.com/before.jpg",
      alt: "Supplied before image",
    },
    after: {
      src: "https://example.com/after.jpg",
      alt: "Supplied after image",
    },
  },
  "code-compare": {
    type: "code-compare",
    before: "Original code supplied by the user",
    after: "Updated code supplied by the user",
  },
  qr: { type: "qr", url: "https://example.com/supplied-public-link" },
  model: {
    type: "model",
    src: "https://example.com/supplied.glb",
    alt: "Supplied model",
  },
  integrations: {
    type: "integrations",
    title: "Proposed workflow",
    items: [
      {
        label: "Supplied source",
        value: "Supplied source role",
        direction: "source",
      },
      {
        label: "Supplied destination",
        value: "Supplied destination role",
        direction: "destination",
      },
    ],
  },
  receipt: {
    type: "receipt",
    title: "Costs",
    currency: "USD",
    people: 2,
    items: [{ label: "Supplied charge", amount: 1 }],
  },
  graph: {
    type: "graph",
    title: "Connections",
    nodes: [
      { id: "a", label: "Supplied service" },
      { id: "b", label: "Supplied dependency" },
    ],
    edges: [{ from: "a", to: "b", label: "Supplied relationship" }],
  },
  steps: {
    type: "steps",
    title: "Guide",
    items: ["First step — Instruction.", "Second step — Instruction."],
  },
};

const ASKS_FIGURES =
  /\b(?:key|main|top|headline)\s+(?:business\s+)?(?:numbers|figures|stats|statistics|metrics|kpis?)\b|\bkpis?\b/i;

// Shapes Markdown already draws on its own: a series becomes a chart, figures
// become cards. The model only needs to be told which plain shape to write.
function shapeHint(text) {
  const series = seriesTable(text);
  if (series && series.width > 1)
    return `The request supplies ${series.rows.length} periods or categories with ${series.width} parts each. Write one Markdown table (header row; first column the ${series.columns[0].toLowerCase()}; one numeric column per part: ${series.columns.slice(1).join(", ")}), with no total or share columns. Vaelo draws it as a stacked chart. Do not use a vaelo-ui block, overview cards or a paragraph for these figures. Quote only the supplied values.`;
  if (series && !/\b(?:compare|versus|vs|which (?:one|is|should)|better|choose)\b/i.test(text))
    return `The request supplies ${series.rows.length} ${series.kind ? series.kind.toLowerCase() + "ly" : "categorical"} values. Write them as one Markdown table (header row; ${series.columns.join(" | ")}; one row each, values exactly as supplied). Vaelo draws it as a ${series.kind ? "line" : "bar"} chart. Do not use a vaelo-ui block, overview cards or a paragraph in its place, and add a short written takeaway after the table.`;
  if (ASKS_FIGURES.test(text) && suppliedFigures(text))
    return "The request supplies headline figures. Present them in one fenced metrics block, one 'Label: value' line each, with a one-line takeaway after it.";
  return "";
}

export function richGuidanceFor(messages = []) {
  if (constrainedAnswer(messages.filter(x => x.role === "user").at(-1)?.content)) return "";
  const last = messages.filter((x) => x.role === "user").at(-1)?.content;
  const text =
    typeof last === "string"
      ? last
      : Array.isArray(last)
        ? last
            .filter((x) => x.type === "text")
            .map((x) => x.text)
            .join(" ")
        : "";
  if (
    /\b(?:plain text|prose only|text only|no (?:widgets|charts|tables|interactive (?:ui|elements))|raw json|json only|code only|(?:just|only) (?:the )?(?:answer|number))\b/i.test(
      text,
    )
  )
    return "";
  if (mathRequest(text))
    return "\n\nFor this worked mathematics answer, use ordinary Markdown with LaTeX equations and numbered working. Do not wrap the explanation in a vaelo-ui JSON block or repeat it as a summary card.";
  const selected = richPresentationFor(text);
  const hint = selected ? "" : shapeHint(text);
  if (hint) return `\n\n${RICH_UI_GUIDANCE}\n\nPresentation for this reply: ${hint}`;
  if (selected)
    return `\n\n${RICH_UI_GUIDANCE}\n\nPresentation for this reply: use the ${selected} view. When the required inputs are supplied or verified, include one fenced vaelo-ui JSON block with the REQUIRED field "type":"${selected}". Do not replace the selected view with prose alone. ${FOCUS_EXAMPLES[selected] ? "Schema illustration only (replace labels, figures and relationships with the actual supplied facts):\n```vaelo-ui\n" + JSON.stringify(FOCUS_EXAMPLES[selected]) + "\n```\n" : ""}${selected === "receipt" ? "Put only the original chargeable line items in items; NEVER include totals, subtotals, per-person shares or other calculated values as items. Set people to the stated split count (integer 1–100); the interface calculates total and per-person amounts locally. " : ""}${selected === "graph" ? "Only include relationships established in the prompt. Do not add a cache-miss fallback, writes, invalidation or other typical architecture behavior unless it was actually stated. " : ""}If required inputs are missing, ask for them rather than inventing any.`;
  return /\b(?:bento|overview cards|widget stack|relationship (?:graph|diagram)|dependency (?:graph|diagram)|file tree|folder tree|image (?:board|gallery|comparison|compare)|before.and.after images?|code (?:comparison|diff)|compare (?:these |the )?(?:code|versions)|itemized receipt|expense receipt|qr(?: code)?|3d model|integrations cards|vaelo-ui|walk me through|guide me through|one step at a time|how .{0,30}(?:connect|depend)|architecture|dependencies|folder structure|project structure|moodboard|inspiration board|split .{0,30}(?:bill|cost|expense)|(?:bill|cost|expense).{0,30}split|itemi[sz]e|scan .{0,30}(?:phone|device)|open .{0,30}(?:phone|device)|\.glb\b|before .{0,30}after|compare .{0,30}(?:pictures|photos|images)|workflow|systems .{0,20}(?:work|fit) together)\b/i.test(
    text,
  ) || text.trim().split(/\s+/).length >= 8
    ? `\n\n${RICH_UI_GUIDANCE}`
    : "";
}
