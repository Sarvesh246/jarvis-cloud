// Shared by the cloud and direct request paths; no extra model request is made.
export const RICH_UI_GUIDANCE =
  "For a requested interactive visual that Markdown cannot express, you may use one fenced vaelo-ui block containing valid JSON. Use only supplied or verified data and real URLs; do not invent content to fill a widget. Schema: {type,title,...}. Types: overview or widgets or integrations: items:[{label,value,detail?}]; steps: items:[string]; graph: nodes:[{id,label}],edges:[{from,to,label?}]; files: paths:[string]; gallery: images:[{src,alt}]; image-compare: before:{src,alt},after:{src,alt}; code-compare: before:string,after:string; receipt: currency:ISO4217,items:[{label,amount:number}]; qr: url:string; model: src:HTTPS .glb URL,alt:string. URLs must be HTTPS. Prefer ordinary tables for comparisons and numeric series, numbered Markdown lists for instructions, existing metrics for simple figures. Graph edges require evidence, receipts only sum supplied line items, code comparisons need both real versions. Never imply integrations are connected, a receipt was paid, a QR transfers private account state, or a model file was created. Omit any unsupported field or visualization; answer in prose instead. Keep blocks small (at most 24 images/nodes, 40 items, 12 overview cards; code versions under 8000 chars). Respect explicit plain text or JSON requests and do not wrap requested raw JSON in a UI block.";

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
  if (/\b(?:plain text|no widgets|raw json|json only)\b/i.test(text)) return "";
  return /\b(?:bento|overview cards|widget stack|relationship (?:graph|diagram)|dependency (?:graph|diagram)|file tree|folder tree|image (?:board|gallery|comparison|compare)|before.and.after images?|code (?:comparison|diff)|compare (?:these |the )?(?:code|versions)|itemized receipt|expense receipt|qr(?: code)?|3d model|integrations cards|vaelo-ui)\b/i.test(
    text,
  )
    ? `\n\n${RICH_UI_GUIDANCE}`
    : "";
}
