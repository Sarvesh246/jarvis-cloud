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
  "Use steps for guided procedures, graph for evidenced dependencies, files for folder layouts, gallery for verified image sets, image-compare or code-compare for two actual versions, receipt for supplied itemized costs, qr for a public link to open on a phone, model for a supplied .glb, and integrations for a proposed workflow. Overview cards carry summaries; widget stacks carry supporting details.",
  "Never replace these views with ASCII art or a table inside a code fence. Prefer ordinary Markdown tables for comparisons and numeric series, checklists for actionable lists, and metrics for simple figures. A timeline event may use [done], [current] or [upcoming] immediately after its date only when that state is established; past dates alone do not prove completion.",
  "Graph edges require evidence; receipts only sum supplied line items; code comparisons need both real versions. Only show integration directions when supplied or clearly proposed. Never imply integrations are connected, a receipt was paid, a QR transfers account state, or a model file was created.",
  "If required inputs are unavailable, explain that in prose instead of fabricating them. Keep blocks small: at most 24 images/nodes, 40 items, 12 overview cards and 8 chips per card; code versions under 8000 chars. Keep prose outside JSON brief, preserve citations outside the card, and do not duplicate the same information in a second table or list. Respect explicit plain-text, code-only, raw JSON, and answer-only requests.",
].join(" ");

export function richPresentationFor(text = "") {
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
    /\b(?:code (?:comparison|diff)|compare (?:these |the )?(?:code|versions)|before.{0,30}after.{0,30}code)\b/is.test(
      text,
    )
  )
    return "code-compare";
  if (
    /\b(?:before.{0,30}after images?|compare.{0,30}(?:photos|pictures|images))\b/is.test(
      text,
    )
  )
    return "image-compare";
  if (
    /\b(?:workflow|integrations? cards|how could.{0,60}(?:systems|services).{0,30}(?:work|fit) together)\b/is.test(
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
    /\b(?:itemi[sz]ed? (?:receipt|expenses?|costs?)|split.{0,40}(?:bill|cost|expenses?)|(?:bill|cost|expenses?).{0,40}split)\b/is.test(
      text,
    )
  )
    return "receipt";
  if (/\b(?:walk me through|guide me through|one step at a time)\b/i.test(text))
    return "steps";
  if (
    /\b(?:file tree|folder tree|(?:project|folder|directory) structure)\b/i.test(
      text,
    )
  )
    return "files";
  if (
    /\b(?:image (?:board|gallery|carousel)|moodboard|inspiration board)\b/i.test(
      text,
    )
  )
    return "gallery";
  if (/\b(?:qr(?: code)?|(?:open|scan).{0,40}(?:phone|device))\b/is.test(text))
    return "qr";
  if (/\b(?:3d model|\.glb\b)/i.test(text)) return "model";
  if (/\b(?:bento|overview cards)\b/i.test(text)) return "overview";
  if (/\b(?:widget stack|supporting (?:details|assumptions))\b/i.test(text))
    return "widgets";
  return null;
}

const FOCUS_EXAMPLES = {
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

export function richGuidanceFor(messages = []) {
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
  const selected = richPresentationFor(text);
  if (selected)
    return `\n\n${RICH_UI_GUIDANCE}\n\nPresentation for this reply: use the ${selected} view. When the required inputs are supplied or verified, include one fenced vaelo-ui JSON block with the REQUIRED field "type":"${selected}". Do not replace the selected view with prose alone. ${FOCUS_EXAMPLES[selected] ? "Schema illustration only (replace labels, figures and relationships with the actual supplied facts):\n```vaelo-ui\n" + JSON.stringify(FOCUS_EXAMPLES[selected]) + "\n```\n" : ""}${selected === "receipt" ? "Put only the original chargeable line items in items; NEVER include totals, subtotals, per-person shares or other calculated values as items. Set people to the stated split count (integer 1–100); the interface calculates total and per-person amounts locally. " : ""}${selected === "graph" ? "Only include relationships established in the prompt. Do not add a cache-miss fallback, writes, invalidation or other typical architecture behavior unless it was actually stated. " : ""}If required inputs are missing, ask for them rather than inventing any.`;
  return /\b(?:bento|overview cards|widget stack|relationship (?:graph|diagram)|dependency (?:graph|diagram)|file tree|folder tree|image (?:board|gallery|comparison|compare)|before.and.after images?|code (?:comparison|diff)|compare (?:these |the )?(?:code|versions)|itemized receipt|expense receipt|qr(?: code)?|3d model|integrations cards|vaelo-ui|walk me through|guide me through|one step at a time|how .{0,30}(?:connect|depend)|architecture|dependencies|folder structure|project structure|moodboard|inspiration board|split .{0,30}(?:bill|cost|expense)|(?:bill|cost|expense).{0,30}split|itemi[sz]e|scan .{0,30}(?:phone|device)|open .{0,30}(?:phone|device)|\.glb\b|before .{0,30}after|compare .{0,30}(?:pictures|photos|images)|workflow|systems .{0,20}(?:work|fit) together)\b/i.test(
    text,
  ) || text.trim().split(/\s+/).length >= 8
    ? `\n\n${RICH_UI_GUIDANCE}`
    : "";
}
