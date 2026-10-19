import { richPresentationFor } from "../../shared/rich-ui-guidance.js";
import {
  parseRichUI,
  richPayload,
  safeMedia,
  treePaths,
  wantsSourceReply,
} from "./rich-ui.js";
import { wantsPlainReply, inferListPresentation, requestIntent } from "./adaptive-ui.js";
import { explicitRelationshipGraph } from "./output-redesign.js";
import { headedTimeline, headedComparison, rankedFigures, periodFigures } from "./shape-recovery.js";
import { seriesTable, suppliedFigures, suppliedDates } from "../../shared/supplied-data.js";

// Presentation recovery runs on settled answers from every provider. It only
// restructures existing data; it never calls a model or executes reply code.
const MAX = 60000;
const SYMBOLS = { $: "USD", "€": "EUR", "£": "GBP", "₹": "INR" };
const WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
};
const TOTAL =
  /\b(?:total|subtotal|per person|each|balance|difference|share|remaining)\b/i;
const MONTH =
  /^(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s+\d{4})?$/i;
const strip = (text) =>
  text
    .replace(/\*\*|__/g, "")
    .replace(/^\s*(?:[-*+] |\d+[.)] )/, "")
    .trim();

export function dataFences(content = "") {
  const result = [];
  const lines = content.split("\n");
  let offset = 0,
    opened = null;
  for (const line of lines) {
    if (!opened) {
      const m = line.match(/^ {0,3}(`{3,}|~{3,})([^\n]*)$/);
      if (m)
        opened = {
          marker: m[1][0],
          length: m[1].length,
          language: m[2].trim().split(/\s/)[0],
          start: offset,
          bodyStart: offset + line.length + 1,
        };
    } else if (
      new RegExp(
        "^ {0,3}" + opened.marker + "{" + opened.length + ",}\\s*$",
      ).test(line)
    ) {
      result.push({
        ...opened,
        source: content.slice(opened.bodyStart, offset).replace(/\n$/, ""),
        end: offset + line.length,
      });
      opened = null;
    }
    offset += line.length + 1;
  }
  return result;
}

export function suppliedCosts(text = "") {
  if (text.length > MAX) return null;
  const matches = [...text.matchAll(/([$€£₹])\s*(-?\d[\d,]*(?:\.\d{1,2})?)/g)];
  if (
    matches.length < 2 ||
    matches.length > 40 ||
    new Set(matches.map((m) => m[1])).size !== 1
  )
    return null;
  const items = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i],
      previous = matches[i - 1],
      next = matches[i + 1];
    const before = text.slice(
      previous ? previous.index + previous[0].length : 0,
      m.index,
    );
    const after = text.slice(
      m.index + m[0].length,
      next ? next.index : text.length,
    );
    let label;
    const following = after.match(
      /^\s+(?:on|for)\s+(?:the\s+)?([^,;\n.!?]+?)(?=\s+and\s|[,;\n.!?]|$)/i,
    );
    if (following) label = following[1];
    else {
      const part = before
        .split(/[,;\n.!?]|\s+and\s+/i)
        .at(-1)
        .replace(/^\s*\|/, "")
        .replace(/\|\s*$/, "");
      label = strip(part)
        .replace(/^(?:we|i)\s+(?:paid|spent)\s+(?:on\s+)?/i, "")
        .replace(/[:=—–-]\s*$/, "")
        .trim();
    }
    label = label
      ?.replace(
        /^.*\b(?:budget (?:is|includes)|budget:|expenses:|costs:)\s*/i,
        "",
      )
      .replace(/^the\s+/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (
      !label ||
      !/\p{L}/u.test(label) ||
      label.length > 60 ||
      /[|{}<>]/.test(label) ||
      /\b(?:split|between|would|could|should|what if|increased?|decreased?)\b/i.test(
        label,
      )
    )
      return null;
    if (TOTAL.test(label)) continue;
    const amount = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(amount) || Math.abs(amount) > 1e12) return null;
    items.push({ label: label[0].toUpperCase() + label.slice(1), amount });
  }
  if (
    items.length < 2 ||
    new Set(items.map((x) => x.label.toLowerCase())).size !== items.length
  )
    return null;
  const explicit = text.match(/\b(USD|CAD|AUD|NZD|SGD|HKD|EUR|GBP|INR)\b/gi);
  if (explicit && new Set(explicit.map((x) => x.toUpperCase())).size > 1)
    return null;
  const currency = explicit?.[0].toUpperCase() || SYMBOLS[matches[0][1]];
  if (explicit && matches[0][1] !== "$" && currency !== SYMBOLS[matches[0][1]])
    return null;
  return { currency, items };
}

function peopleCount(request) {
  const m = request.match(
    /(?:between|among|split\s+(?:it\s+)?(?:by|with)|for)\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:people|persons?|friends?|of us)/i,
  );
  const count = m && (WORDS[m[1].toLowerCase()] || Number(m[1]));
  return count && count <= 100 ? count : 1;
}

export function requestedFactor(request = "") {
  const m = request.match(
    /\b(increas\w*|rais\w*|grow\w*|decreas\w*|reduc\w*|cut\w*)\b[^.!?]{0,35}?\b(\d+(?:\.\d+)?)\s*%/i,
  );
  if (m)
    return (
      1 + ((/^(?:decreas|reduc|cut)/i.test(m[1]) ? -1 : 1) * Number(m[2])) / 100
    );
  if (/\b(?:double|twice)\b/i.test(request)) return 2;
  if (/\bhalve\b/i.test(request)) return 0.5;
  return 1;
}

function pairs(content) {
  const result = [];
  for (const line of content.split("\n")) {
    const m = strip(line).match(
      /^([^:—–]{1,60}?)(?:\s*:\s*|\s+[—–]\s+)(.{1,400})$/,
    );
    if (m && !/[{}<>|]/.test(m[1]))
      result.push({ label: m[1].trim(), value: m[2].trim() });
  }
  return result.length >= 2 && result.length <= 12 ? result : null;
}

function sections(content) {
  const headings = [...content.matchAll(/^#{2,4}\s+(.+)$/gm)];
  if (headings.length < 2 || headings.length > 8) return null;
  return headings
    .map((m, i) => ({
      label: strip(m[1]),
      value: content
        .slice(m.index + m[0].length, headings[i + 1]?.index ?? content.length)
        .trim(),
    }))
    .filter((x) => x.label.length <= 60 && x.value && x.value.length <= 2000);
}

function supportingItems(content) {
  const bullets = content
    .split("\n")
    .map((line) => line.match(/^\s*[-*+]\s+(.{1,800})$/)?.[1])
    .filter(Boolean);
  return bullets.length >= 2 && bullets.length <= 8
    ? bullets.map((value, i) => ({
        label: "Consideration " + (i + 1),
        value: strip(value),
      }))
    : null;
}

function links(text) {
  const found = [];
  for (const m of text.matchAll(
    /!?\[([^\]\n]*)\]\((https:\/\/[^\s)]+)\)|(https:\/\/[^\s<>"'`]+)/g,
  )) {
    const src = safeMedia((m[2] || m[3]).replace(/[.,;!?]+$/, ""));
    let label =
      src && (new URL(src).pathname.split("/").at(-1) || new URL(src).hostname);
    try {
      label = decodeURIComponent(label);
    } catch {
      /* A malformed filename stays literal. */
    }
    if (src && !found.some((x) => x.src === src))
      found.push({
        src,
        alt: m[1] || label,
        image:
          m[0].startsWith("![") ||
          /\.(?:jpe?g|png|webp|gif|avif)(?:$|[?#])/i.test(src),
      });
  }
  return found;
}

const checked = (data) => data && parseRichUI(JSON.stringify(data));
const native = (language, source) => ({ language, source });
const rich = (block) => {
  const valid = checked(block);
  return valid ? { block: valid } : null;
};
const retainedLinks = (content) =>
  [...content.matchAll(/(?<!!)\[[^\]\n]+\]\(https:\/\/[^\s)]+\)/g)]
    .map((m) => m[0])
    .filter((x, i, a) => a.indexOf(x) === i)
    .join(" · ");

const TABLE_LINE = /(?:^|\n)\s*\|.*\|\s*(?:\n|$)/;
const KEEP_IMAGE =
  /\b(?:keep|show|display|include|place|put|pair|attach|embed)\b[^.?!]{0,40}\b(?:image|photo|picture|screenshot)s?\b|\balongside\b|\bcaption\b/i;
const ASKS_FIGURES =
  /\b(?:key|main|top|headline)\s+(?:business\s+)?(?:numbers|figures|stats|statistics|metrics|kpis?)\b|\bkpis?\b/i;
const ASKS_SCHEDULE =
  /\b(?:schedule|timeline|roadmap|milestones?|phases?|key dates|dates|calendar|plan)\b/i;
const REPLACEABLE = new Set(["overview", "widgets", "metrics"]);
const tidy = (text) => text.replace(/\n{3,}/g, "\n\n").trim();
const cut = (content, ranges) =>
  tidy(
    [...ranges]
      .sort((a, b) => b.start - a.start)
      .reduce((text, r) => text.slice(0, r.start) + text.slice(r.end), content),
  );

// The request carried the figures, the reply did not draw them: build the table
// from the person's own words and let the table block pick the chart.
function recoverSeries(content, request, blocks, whole) {
  if (requestIntent(request) !== "chart") return null;
  const table = seriesTable(request);
  if (!table || TABLE_LINE.test(content)) return null;
  if (whole) return REPLACEABLE.has(whole.type) ? { markdown: table.markdown } : null;
  if (blocks.some((b) => !REPLACEABLE.has(b.type))) return null;
  const rest = cut(
    content,
    blocks.map((b) => ({ start: b.fence.start, end: b.fence.end })),
  );
  return { markdown: table.markdown + (rest ? "\n\n" + rest : "") };
}

// Rows of a Markdown table as label / value / detail, for supporting details.
function tableItems(content) {
  const lines = content.split("\n");
  const row = (l) => /^\s*\|.*\|\s*$/.test(l);
  const first = lines.findIndex(row);
  if (first < 0) return null;
  let end = first;
  while (end < lines.length && row(lines[end])) end++;
  const rows = lines
    .slice(first, end)
    .filter((l) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l))
    .map((l) =>
      l
        .trim()
        .replace(/^\||\|$/g, "")
        .split(/(?<!\\)\|/)
        .map((c) => strip(c.replace(/\\\|/g, "|"))),
    );
  const body = rows.slice(1).filter((r) => r.length >= 2 && r[0] && r[1]);
  if (body.length < 2 || body.length > 12) return null;
  const items = body.map(([label, value, ...more]) => {
    const detail = more.filter(Boolean).join(" · ");
    return { label, value, ...(detail && { detail }) };
  });
  return { items, rest: tidy([...lines.slice(0, first), ...lines.slice(end)].join("\n")) };
}

// "- **Travelers:** two adults" and bold-led paragraphs name their own labels.
function boldLed(content) {
  const found = [];
  const kept = [];
  for (const line of content.split("\n")) {
    const m = line.match(
      /^\s*(?:[-*+]\s+|\d+[.)]\s+)?\*\*([^*\n]{1,60}?)\*\*\s*[:—–-]?\s*(.{3,400})$/,
    );
    if (m) found.push({ label: strip(m[1]).replace(/[:—–-]$/, "").trim(), value: strip(m[2]) });
    else kept.push(line);
  }
  return found.length >= 2 && found.length <= 12
    ? { items: found, rest: tidy(kept.join("\n")) }
    : null;
}

// A tree can sit in a fence of any plain language, or in a run of bullets.
function fileTree(content, fences) {
  for (const f of fences) {
    // Asked for a layout, a fence tagged with the wrong language is still one.
    const tree = treePaths(f.source, "");
    if (tree) return { tree, markdown: cut(content, [f]) };
  }
  if (fences.length) return null;
  const whole = treePaths(content, "");
  if (whole) return { tree: whole, markdown: "" };
  let offset = 0;
  for (const block of content.split(/\n\s*\n/)) {
    const start = content.indexOf(block, offset);
    offset = start + block.length;
    const lines = block.split("\n");
    for (const drop of [0, 1]) {
      const tree = treePaths(lines.slice(drop).join("\n"), "");
      if (tree)
        return {
          tree,
          markdown: tidy(
            cut(content, [{ start, end: start + block.length }]) + (drop ? "\n\n" + lines[0] : ""),
          ),
        };
    }
  }
  return null;
}

// Reply lines that only restate a supplied date are what the timeline replaces.
function withoutDateLines(content, events) {
  const days = events.map((x) => x.when.replace(/,?\s+\d{4}$/, "").toLowerCase());
  return tidy(
    content
      .split("\n")
      .filter(
        (line) =>
          line.length > 160 ||
          !/^\s*(?:[-*+•]|\d+[.)])\s|^[^:\n]{1,40}:\s|^\s*\|/.test(line) ||
          !days.some((d) => line.toLowerCase().replace(/\*\*|__/g, "").includes(d)),
      )
      .join("\n"),
  );
}

function withoutFigureLines(content, items) {
  return tidy(
    content
      .split("\n")
      .filter(
        (line) =>
          line.length > 160 ||
          !/^\s*(?:[-*+•]|\d+[.)])\s|^[^:\n]{1,40}:\s/.test(line) ||
          !items.some((x) => line.includes(x.value)),
      )
      .join("\n"),
  );
}

export function automaticPresentation(content = "", request = "", attached = []) {
  if (
    !content.trim() ||
    content.length > MAX ||
    request.length > 12000 ||
    wantsPlainReply(request) ||
    wantsSourceReply(request) ||
    /\b(?:write|implement|generate|build)\b.{0,28}\b(?:code|script|program|function|component)\b/is.test(
      request,
    ) ||
    /\b(?:just|only) (?:the )?(?:answer|number)\b/i.test(request)
  )
    return null;
  const fences = dataFences(content);
  // An image the person attached is shown beside the reply's caption.
  if (attached.length && KEEP_IMAGE.test(request) && !/!\[[^\]\n]*\]\(/.test(content))
    return {
      markdown:
        attached
          .map((x) => "![" + String(x.alt).replace(/[[\]\n]/g, " ") + "](" + x.src + ")")
          .join("\n\n") +
        "\n\n" +
        content,
    };
  const whole = parseRichUI(content.trim());
  const blocks = fences
    .map((fence) => ({ fence, ...richPayload(fence.source, fence.language, request) }))
    .filter((b) => b.type);
  // Figures typed into the request win over a card the model chose for them.
  const series = recoverSeries(content, request, blocks, whole);
  if (series) return series;
  // Already valid rich output has its own renderer; never add a duplicate card.
  if (whole || blocks.length) return null;
  const intent = richPresentationFor(request);
  const forceTable = /\b(?:in|as|into) (?:a |the )?table\b/i.test(request);
  if(forceTable) {
    const rows=pairs(content);
    return rows && !fences.length && !/^\s*\|/m.test(content) ? {markdown:'| Item | Value |\n|---|---|\n'+rows.map(x=>'| '+x.label+' | '+x.value.replace(/\|/g,'\\|')+' |').join('\n')+'\n\n'+retainedLinks(content)} : null;
  }
  const sourceCosts = suppliedCosts(request);
  const costs = sourceCosts || (!fences.length ? suppliedCosts(content) : null);
  const hypothetical =
    /\b(?:what if|suppose|increas\w*|decreas\w*|rais\w*|reduc\w*|double|halve)\b/i.test(
      request,
    );
  if (
    costs &&
    hypothetical &&
    /\b(?:budget|spend\w*|costs?|expenses?|rent|groceries)\b/i.test(request)
  )
    return {
      explorer: {
        columns: ["Category", "Amount"],
        rows: costs.items.map((x) => [
          x.label,
          new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: costs.currency,
          }).format(x.amount),
        ]),
        factor: requestedFactor(request),
      },
    };
  if (
    costs &&
    (intent === "receipt" ||
      /\b(?:paid|spent|bill|expenses|owe|cost in total)\b/i.test(request))
  )
    return rich({
      type: "receipt",
      title: "Cost summary",
      ...costs,
      people: peopleCount(request),
    });
  if (intent === "graph") {
    const graph = explicitRelationshipGraph(request);
    if (graph) return rich(graph);
  }
  const assets = links(request + "\n" + content),
    images = assets
      .filter((x) => x.image)
      .slice(0, 24)
      .map(({ src, alt }) => ({ src, alt }));
  if (intent === "model") {
    const model = assets.find((x) => safeMedia(x.src, "model"));
    if (model)
      return rich({
        type: "model",
        src: model.src,
        alt: model.alt,
        title: "Supplied 3D model",
      });
  }
  if (intent === "qr") {
    const urls = links(request).length ? links(request) : links(content);
    if (
      urls.length === 1 &&
      !urls[0].image &&
      !/\.(?:glb|html?)$/i.test(new URL(urls[0].src).pathname)
    )
      return rich({
        type: "qr",
        title: "Open on your phone",
        url: urls[0].src,
      });
  }
  if (intent === "image-compare" && images.length === 2)
    return rich({
      type: "image-compare",
      title: "Image comparison",
      before: images[0],
      after: images[1],
    });
  if (
    images.length &&
    (intent === "gallery" ||
      /\b(?:photos|images|pictures|inspiration)\b/i.test(request))
  ) {
    const lens = /\b(?:inspect|closer|detail|zoom)\b/i.test(request);
    if (lens && images.length !== 1) return null;
    const block = checked({
      type: "gallery",
      title: lens ? "Inspect details" : "Supplied images",
      images,
      view: /\b(?:browse|look through|one at a time)\b/i.test(request)
        ? "carousel"
        : "grid",
    });
    const hasImage = content.includes("![");
    return block
      ? {
          block,
          markdown: hasImage
            ? content.replace(/!\[[^\]\n]*\]\(https:\/\/[^\s)]+\)/g, "").trim()
            : content,
        }
      : null;
  }
  if (intent === "code-compare") {
    const inputCode = dataFences(request).filter(
        (f) => !richPayload(f.source, f.language, request),
      ),
      code = inputCode.length === 2 ? inputCode : fences;
    if (code.length === 2 && code.every((f) => f.source.length <= 8000)) {
      const result = rich({
        type: "code-compare",
        title: "Code changes",
        before: code[0].source,
        after: code[1].source,
      });
      if (code === fences)
        result.markdown = tidy(
          content.slice(0, code[0].start) +
            content.slice(code[0].end, code[1].start) +
            content.slice(code[1].end),
        );
      return result;
    }
    // Two versions written as inline code in the request itself.
    const spans = [...request.matchAll(/`([^`\n]{6,})`/g)].map((m) => m[1]);
    if (spans.length === 2 && spans[0] !== spans[1])
      return rich({ type: "code-compare", title: "Code changes", before: spans[0], after: spans[1] });
  }
  if (intent === "steps") {
    const headings = [
      ...content.matchAll(/^#{1,4}\s+(?:Step\s+)?\d+[.):—–-]?\s+(.+)$/gim),
    ];
    if (headings.length >= 2 && headings.length <= 40)
      return {
        block: checked({
          type: "steps",
          title: "Step by step",
          items: headings.map(
            (m, i) =>
              m[1] +
              "\n\n" +
              content
                .slice(
                  m.index + m[0].length,
                  headings[i + 1]?.index ?? content.length,
                )
                .trim(),
          ),
        }),
        markdown: content.slice(0, headings[0].index),
      };
  }
  if (intent === "files") {
    const found = fileTree(content, fences);
    if (found) return { block: checked(found.tree), markdown: found.markdown };
  }
  if (intent === "widgets") {
    const found = tableItems(content) || boldLed(content);
    const block =
      found &&
      checked({
        type: "widgets",
        title: "Supporting details",
        items: found.items.map((x) => ({
          ...x,
          value: x.value.slice(0, 220),
          ...(x.value.length > 220
            ? { detail: [x.value.slice(220), x.detail].filter(Boolean).join(" · ") }
            : {}),
        })),
      });
    if (block) return { block, markdown: found.rest };
  }
  if (fences.length || TABLE_LINE.test(content)) return null;
  if (intent === "files") {
    const paths = [
      ...content.matchAll(
        /^\s*(?:[-*+]\s+)?`?([\w@.-]+(?:\/[\w@.-]+)+)`?\s*$/gm,
      ),
    ].map((m) => m[1]);
    if (paths.length >= 2 && paths.length <= 100)
      return rich({ type: "files", title: "Project layout", paths });
  }
  // Whatever the request said, answers shaped like these read better as visuals.
  for (const recover of [headedTimeline, headedComparison, rankedFigures, periodFigures]) {
    const shaped = recover(content);
    if (shaped) return shaped;
  }
  const dates = ASKS_SCHEDULE.test(request) ? suppliedDates(request) : null;
  if (dates)
    return {
      language: "timeline",
      source: dates.map((x) => x.when + ": " + x.label).join("\n"),
      markdown: withoutDateLines(content, dates),
    };
  const figures = ASKS_FIGURES.test(request) ? suppliedFigures(request) : null;
  if (figures)
    return {
      language: "metrics",
      source: figures.map((x) => x.label + ": " + x.value).join("\n"),
      markdown: withoutFigureLines(content, figures),
    };
  const labeled = pairs(content);
  if (intent === "integrations") {
    const move = request.match(
      /\bfrom\s+([\p{L}\p{N}][\p{L}\p{N} ._-]{0,35}?)\s+to\s+([\p{L}\p{N}][\p{L}\p{N} ._-]{0,35}?)(?=[.!?;,\n]|$)/u,
    );
    if (move)
      return rich({
        type: "integrations",
        title: "Proposed workflow",
        items: [
          { label: move[1], value: "Supplied source", direction: "source" },
          {
            label: move[2],
            value: "Supplied destination",
            direction: "destination",
          },
        ],
      });
    if (labeled)
      return {
        block: checked({
          type: "integrations",
          title: "Proposed systems",
          items: labeled,
        }),
        markdown: retainedLinks(content),
      };
  }
  if (intent === "overview" && (labeled || costs)) {
    const items =
      labeled ||
      costs.items.map((x) => ({
        label: x.label,
        value: new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: costs.currency,
        }).format(x.amount),
      }));
    if (items.length <= 12)
      return {
        block: checked({ type: "overview", title: "At a glance", items }),
        markdown: labeled ? retainedLinks(content) : content,
      };
  }
  if (intent === "widgets") {
    const items = labeled || sections(content) || supportingItems(content);
    if (items?.length >= 2)
      return {
        block: checked({
          type: "widgets",
          title: "Supporting details",
          items: items.map((x) => ({
            ...x,
            value: x.value.slice(0, 220),
            ...(x.value.length > 220 ? { detail: x.value.slice(220) } : {}),
          })),
        }),
        markdown: retainedLinks(content),
      };
  }
  // Plain labelled lines are also useful data, even if a model omitted bullets.
  if (labeled && !/^\s*(?:[-*+] |\d+[.)] )/m.test(content)) {
    if(requestIntent(request)==='table') return {markdown:'| Item | Value |\n|---|---|\n'+labeled.map(x=>'| '+x.label+' | '+x.value.replace(/\|/g,'\\|')+' |').join('\n')+'\n\n'+retainedLinks(content)};
    if (
      labeled.length <= 30 &&
      labeled.every(
        (x) => MONTH.test(x.label) && /^[$€£₹]?\s*-?\d[\d,.]*%?$/.test(x.value),
      ) &&
      /\b(?:over time|each month|monthly|grew|growth|trend|revenue|sales)\b/i.test(
        request,
      )
    ) {
      return {
        markdown:
          "| Month | Value |\n|---|---:|\n" +
          labeled
            .map((x) => "| " + x.label + " | " + x.value + " |")
            .join("\n"),
      };
    }
    const inferred = inferListPresentation(
      labeled.map((x) => x.label + ": " + x.value),
      { context: request },
    );
    if (inferred?.source)
      return {
        ...native(inferred.kind, inferred.source),
        markdown: retainedLinks(content),
      };
  }
  return null;
}
