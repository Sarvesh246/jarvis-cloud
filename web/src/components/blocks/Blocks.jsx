import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowSquareOut,
  ArrowsOut,
  ChartBar,
  Check,
  Copy,
  DownloadSimple,
  Eye,
  Table,
} from "@phosphor-icons/react";
import { collectSources, domainOf, kindLabel, parseUrl, sourceKey } from "../../lib/sources.js";
import { cellText, isNumericColumn, isSectionRow, tableView, toCSV, toTSV } from "../../lib/table.js";
import {
  STRUCTURED,
  fenceClosed,
  metricsText,
  parseMetrics,
  parseTimeline,
  timelineText,
} from "../../lib/structured.js";
import { blockKey, readChecklist, saveChecklist } from "../../lib/intelligent-ui.js";
import { inferListPresentation, sectionContext, tablePresentation, wantsPlainReply, safeChartPlan } from "../../lib/adaptive-ui.js";
import { TableScroll } from "./TableScroll.jsx";
import { Chart } from "./Chart.jsx";
import { richPayload, pendingRichPayload, wantsSourceReply, gridOverview, wantsOverview } from "../../lib/rich-ui.js";
import { RichUI, StepPlayer } from "./RichUI.jsx";
import { NumberExplorer } from "./LocalTools.jsx";
import { SourceIcon } from "./SourceIcon.jsx";
import { Highlighted } from "./Highlighted.jsx";
import { Rolling } from "../Rolling.jsx";
import { readWorkProposal } from "../../lib/work-proposals.js";
import { getWorkspace } from "../../../shared/workspaces.js";
import { getCheck } from "../../../shared/checks.js";
import "./blocks.css";
import "./output-layout.css";
import "./output-polish.css";
import { DESKTOP, copyText, saveDesktopFile } from "../../lib/desktop.js";

/* A reply is rendered as typed blocks: prose, code, tables, sources. Each
   block carries the controls that suit it and can be promoted into the
   workspace when it deserves more room. */

const BlockContext = createContext({
  sources: [],
  byKey: new Map(),
  open: () => {},
  presentation: "adaptive",
});

/* How much shape replies take on: "adaptive" (figures, timelines and charts
   where they help) or "minimal" (plain text and tables). Set in Settings. */
export const PresentationContext = createContext("adaptive");

export function useCopy() {
  const [done, setDone] = useState(false);
  const copy = async (text) => {
    try {
      await copyText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      /* clipboard can be blocked; the text stays selectable */
    }
  };
  return [done, copy];
}

export function download(name, text, type = "text/plain") {
  // Without a byte-order mark, Excel reads CSV as the local code page and mangles "€" and "é".
  if (type === "text/csv" && !text.startsWith("﻿")) text = `﻿${text}`;
  if (DESKTOP) return saveDesktopFile(name, text).catch(() => {
    alert("The file could not be saved. Please try again.");
    return false;
  });
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function textOf(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
}

function hastText(node) {
  if (!node) return "";
  if (node.type === "text") return node.value;
  if (node.tagName === "img") return node.properties?.alt || "";
  if (node.tagName === "br") return "\n";
  return (node.children || []).map(hastText).join("");
}

/* ---------- Code ---------- */

const EXT = {
  javascript: "js", js: "js", jsx: "jsx", typescript: "ts", ts: "ts", tsx: "tsx",
  python: "py", py: "py", html: "html", css: "css", json: "json", bash: "sh",
  sh: "sh", shell: "sh", powershell: "ps1", sql: "sql", yaml: "yml", yml: "yml",
  markdown: "md", md: "md", svg: "svg", xml: "xml", rust: "rs", go: "go",
  java: "java", c: "c", cpp: "cpp", csharp: "cs", ruby: "rb", php: "php", csv: "csv",
};

export function looksLikeSvg(language, source) {
  return language === "svg" || (language === "xml" && /^\s*<svg[\s>]/.test(source));
}

const FOLD_AT = 24;

function languageOf(children) {
  const code = Array.isArray(children) ? children[0] : children;
  return (code?.props?.className || "").match(/language-([\w+/-]+)/)?.[1]?.toLowerCase() || "";
}

/* A fenced block is either code, or one of the shapes Vaelo can answer in.
   In a mapped document each block carries where it sits in the Markdown
   (data-src), so a selection can be traced back to the words behind it. */
function CodeBlock({ children, node, "data-src": src }) {
  const { content, open, live, presentation, stateKey, requestText } = useContext(BlockContext);
  const language = languageOf(children);
  const source = textOf(children);
  const grid = !wantsSourceReply(requestText) && !live ? gridOverview(source, language) : null;
  if (grid && presentation !== "minimal") return <div data-src={src}><RichUI source={JSON.stringify(grid)} enabled stateKey={stateKey} /></div>;
  const payload = richPayload(source, language, requestText);
  const settled = fenceClosed(content, node?.position?.start?.offset, node?.position?.end?.offset);
  const pending = live && !settled && pendingRichPayload(source, language, requestText);
  if (payload || pending || (language === "vaelo-ui" && !wantsSourceReply(requestText))) {
    return <div data-src={src}><RichUI key={blockKey(stateKey || "temporary", node?.position?.start?.offset, textOf(children))} source={textOf(children)} enabled={settled && presentation !== "minimal"} pending={live && !settled && presentation !== 'minimal'} stateKey={stateKey} /></div>;
  }
  if (language === "vaelo-work") {
    const proposal = readWorkProposal(textOf(children));
    const complete = fenceClosed(content, node?.position?.start?.offset, node?.position?.end?.offset);
    if (live) return <p className="work-proposal-note">Filling it in…</p>;
    if (!complete || !proposal) return <div className="work-proposal"><p className="work-proposal-note" role="status">This draft is incomplete. Its original text is kept below; ask Vaelo to repair it before saving.</p><pre className="block-plain">{textOf(children)}</pre></div>;
    const workspace = getWorkspace(proposal.workspaceId);
    const check = proposal.check && getCheck(proposal.check.id);
    return <section className="work-proposal">
      <span className="label">Ready for you to check</span>
      <h3>{proposal.title || workspace?.title || "Your own workspace"}</h3>
      <p>{check ? `${workspace?.title || "Workspace"} · ${check.title}` : workspace?.summary || "A workspace you set up yourself."}</p>
      <p className="work-proposal-note">Vaelo filled this in. Open it to check it before you save.</p>
      <button className="text-button" onClick={() => open({kind:"work-proposal", proposal})}>Open it <ArrowsOut size={15} /></button>
    </section>;
  }
  if (STRUCTURED.has(language)) {
    const source = textOf(children);
    const settled = fenceClosed(content, node?.position?.start?.offset, node?.position?.end?.offset);
    return language === "metrics" ? (
      <Metrics source={source} src={src} settled={settled} />
    ) : (
      <Timeline source={source} src={src} settled={settled} />
    );
  }
  return (
    <CodeFigure language={language} src={src}>
      {children}
    </CodeFigure>
  );
}

function CodeFigure({ language, src, children }) {
  const { open } = useContext(BlockContext);
  const [done, copy] = useCopy();
  const [expanded, setExpanded] = useState(false);
  const [wrapped, setWrapped] = useState(false);
  const source = textOf(children).replace(/\n$/, "");
  const lines = source.split("\n").length;
  const folds = lines > FOLD_AT + 6;
  const canPreview = language === "html" || looksLikeSvg(language, source);
  const name = language.length <= 4 ? language.toUpperCase() : language[0]?.toUpperCase() + language.slice(1);
  const item = { kind: "code", language, source, title: language ? `${name} snippet` : "Snippet" };

  return (
    <figure className="code" data-src={src} data-wrapped={wrapped || undefined} data-folded={folds && !expanded ? true : undefined}>
      <figcaption className="block-bar">
        <span className="label">{language || "Code"}</span>
        <span className="block-count">{lines} {lines === 1 ? "line" : "lines"}</span>
        <span className="block-tools">
          <button className="block-tool" aria-pressed={wrapped} onClick={() => setWrapped(value => !value)}>Wrap lines</button>
          {canPreview && (
            <button
              className="block-tool"
              aria-label="Preview"
              onClick={() => open({ ...item, tab: "preview" })}
            >
              <Eye size={15} /> <span>Preview</span>
            </button>
          )}
          <button
            className="block-tool"
            onClick={() => copy(source)}
            aria-label={done ? "Copied" : "Copy code"}
          >
            {done ? <Check size={15} /> : <Copy size={15} />}
            <span>{done ? "Copied" : "Copy"}</span>
          </button>
          <button
            className="block-tool icon-only"
            data-tip="Download"
            aria-label="Download code"
            onClick={() => download(`vaelo-snippet.${EXT[language] || "txt"}`, source)}
          >
            <DownloadSimple size={15} />
          </button>
          <button
            className="block-tool icon-only"
            data-tip="Open in workspace"
            aria-label="Open code in workspace"
            onClick={() => open({ ...item, tab: "code" })}
          >
            <ArrowsOut size={15} />
          </button>
        </span>
      </figcaption>
      <pre tabIndex={0} aria-label={`${language || "Code"}, ${lines} lines`}>
        <Highlighted source={source} language={language} />
      </pre>
      {folds && (
        <button className="code-fold" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show less" : `Show all ${lines} lines`}
        </button>
      )}
    </figure>
  );
}

/* ---------- Figures and timelines ---------- */

/* A few key figures read at a glance: the first leads, the rest sit in a
   ledger beneath it. Direction is said with a glyph and in words, never by
   colour alone. In the minimal presentation they stay plain lines. */
function Delta({ item }) {
  if (!item.delta) return null;
  const word = item.direction === "up" ? "up" : item.direction === "down" ? "down" : "change";
  return (
    <span className="metric-delta" data-direction={item.direction}>
      <span aria-hidden="true">{item.direction === "up" ? "▲" : item.direction === "down" ? "▼" : "◆"}</span>
      <span className="sr-only">{word} </span>
      {item.delta.replace(/^[↑↓▲▼]\s*/, "")}
    </span>
  );
}

function Metrics({ source, src, settled }) {
  const { presentation, live } = useContext(BlockContext);
  const data = useMemo(() => parseMetrics(source), [source]);
  const [done, copy] = useCopy();
  /* A figure set down while you watch turns into place once its block is
     complete; one already on the page when it opens simply stands there. */
  const [arriving] = useState(!settled);
  /* Lines that aren't figures may be half-arrived ones while the block
     streams; once it is finished they are part of what was said. */
  const finished = settled || !live;
  const extra = finished ? data.extra : [];
  if (!data.items.length && !(finished && (extra.length || data.notes.length)))
    return (
      <p className="block-pending" data-src={src}>
        {live ? 'Laying out figures…' : `${data.title ? `${data.title}: ` : ''}No figures were included in this block.`}
      </p>
    );
  if (presentation === "minimal" || !data.items.length)
    return (
      <pre className="block-plain" data-src={src}>
        {metricsText(data)}
      </pre>
    );
  const [lead, ...rest] = data.items;
  return (
    <figure className="metrics" data-src={src} aria-label={data.title || "Key figures"}>
      <figcaption className="block-bar">
        <span className="label">Figures</span>
        {data.title && <span className="metrics-title">{data.title}</span>}
        <span className="block-tools">
          <button
            className="block-tool"
            onClick={() => copy(metricsText(data))}
            aria-label={done ? "Copied" : "Copy figures"}
          >
            {done ? <Check size={15} /> : <Copy size={15} />}
            <span>{done ? "Copied" : "Copy"}</span>
          </button>
        </span>
      </figcaption>
      <div className="metrics-lead">
        <span className="metrics-lead-label">{lead.label}</span>
        <span className="metrics-lead-value">
          {settled && lead.value.length <= 18 ? <Rolling value={lead.value} enter={arriving} /> : lead.value}
        </span>
        <Delta item={lead} />
      </div>
      {rest.length > 0 && (
        <dl className="metrics-grid">
          {rest.map((item, i) => (
            <div key={i} className="metric">
              <dt>{item.label}</dt>
              <dd>
                <span className="metric-value">{item.value}</span>
                <Delta item={item} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {[...data.notes, ...extra].map((note, i) => (
        <p key={i} className="metrics-note">
          {note}
        </p>
      ))}
    </figure>
  );
}

function Timeline({ source, src, settled }) {
  const { presentation, live } = useContext(BlockContext);
  const data = useMemo(() => parseTimeline(source), [source]);
  const [done, copy] = useCopy();
  /* A finished line without a date still belongs in the sequence */
  const events = settled || !live ? data.rows : data.events;
  if (!events.length)
    return (
      <p className="block-pending" data-src={src}>
        {live ? 'Laying out the timeline…' : `${data.title ? `${data.title}: ` : ''}No events were included in this block.`}
      </p>
    );
  if (presentation === "minimal")
    return (
      <pre className="block-plain" data-src={src}>
        {timelineText(data)}
      </pre>
    );
  return (
    <figure className="timeline" data-src={src} aria-label={data.title || "Timeline"}>
      <figcaption className="block-bar">
        <span className="label">Timeline</span>
        {data.title && <span className="metrics-title">{data.title}</span>}
        <span className="block-tools">
          <button
            className="block-tool"
            onClick={() => copy(timelineText(data))}
            aria-label={done ? "Copied" : "Copy timeline"}
          >
            {done ? <Check size={15} /> : <Copy size={15} />}
            <span>{done ? "Copied" : "Copy"}</span>
          </button>
        </span>
      </figcaption>
      <ol className="timeline-list">
        {events.map((event, i) => (
          <li key={i}>
            <span className="timeline-when">{event.when}</span>
            <span className="timeline-what">
              {event.what}
              {event.detail && <span className="timeline-detail">{event.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/* ---------- Sources and citations ---------- */

/* Place the card where it fits: below when there's no room above, and
   pinned to whichever side keeps it on screen. */
function flip(event) {
  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  const half = Math.min(152, (innerWidth - 32) / 2);
  if (rect.top < 280) el.dataset.below = "";
  else delete el.dataset.below;
  const center = rect.left + rect.width / 2;
  if (center + half > innerWidth - 12) el.dataset.align = "end";
  else if (center - half < 12) el.dataset.align = "start";
  else delete el.dataset.align;
}

/* An external link stays readable prose, followed by a small numbered mark.
   The mark previews the source on hover or focus and opens the sources
   panel on click. */
function SourceLink({ href, children }) {
  const { byKey, open } = useContext(BlockContext);
  const url = parseUrl(href || "");
  // A refused address (javascript:, data:) stays text: an empty href would reload the app.
  if (!url) return href ? <a href={href}>{children}</a> : <span>{children}</span>;
  const source = byKey.get(sourceKey(href));
  const text = textOf(children).trim();
  const bare = !text || /^\[?\d+\]?$/.test(text) || text === href || text === domainOf(href);
  if (!source)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  const description = `Source ${source.index}: ${source.title || source.domain}, ${kindLabel(source.kind)}`;
  return (
    <>
      {!bare && (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      )}
      <span
        className="cite"
        onPointerEnter={flip}
        onFocus={flip}
      >
        <button
          className="cite-mark"
          data-kind={source.kind}
          aria-label={description}
          onClick={() => open({ kind: "sources", focus: source.id })}
        >
          {bare ? (
            <>
              <SourceIcon kind={source.kind} size={11} />
              {source.domain}
            </>
          ) : (
            source.index
          )}
        </button>
        <span className="cite-card" role="tooltip">
          <span className="cite-head">
            <SourceIcon kind={source.kind} size={14} />
            <span>{source.domain}</span>
            <span className="cite-kind">{kindLabel(source.kind)}</span>
          </span>
          {source.title && <span className="cite-title">{source.title}</span>}
          {source.context && <span className="cite-context">“{source.context}”</span>}
          <a className="cite-open" href={source.url} target="_blank" rel="noopener noreferrer">
            Open source <ArrowSquareOut size={13} />
          </a>
        </span>
      </span>
    </>
  );
}

/* While a reply is written, each source joins the strip as it is cited. */
export function SourceStrip({ sources, onOpen, arriving = false }) {
  if (!sources.length) return null;
  const shown = sources.slice(0, 4);
  return (
    <button
      className="source-strip"
      data-arriving={arriving || undefined}
      onClick={onOpen}
      aria-label={`Show ${sources.length} sources`}
    >
      <span className="label">Sources</span>
      <span className="source-stack" aria-hidden="true">
        {shown.map((source) => (
          <span key={source.id} className="source-pip" data-kind={source.kind}>
            <SourceIcon kind={source.kind} size={12} />
            <span>{source.domain}</span>
          </span>
        ))}
      </span>
      {sources.length > shown.length && (
        <span className="source-more">
          +<Rolling value={sources.length - shown.length} />
        </span>
      )}
    </button>
  );
}

/* ---------- Tables ---------- */

function inline(node, key) {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return null;
  const kids = (node.children || []).map((child, i) => inline(child, i));
  switch (node.tagName) {
    case "strong":
      return <strong key={key}>{kids}</strong>;
    case "em":
      return <em key={key}>{kids}</em>;
    case "del":
      return <del key={key}>{kids}</del>;
    case "code":
      return <code key={key}>{kids}</code>;
    case "br":
      return <br key={key} />;
    case "img":
      return <ImageRef key={key} src={node.properties?.src} alt={node.properties?.alt} />;
    case "a":
      return (
        <SourceLink key={key} href={node.properties?.href}>
          {kids}
        </SourceLink>
      );
    default:
      return <React.Fragment key={key}>{kids}</React.Fragment>;
  }
}

function tableData(node) {
  const rows = [];
  const walk = (n) => {
    if (n.tagName === "tr")
      rows.push((n.children || []).filter((c) => c.tagName === "th" || c.tagName === "td"));
    else (n.children || []).forEach(walk);
  };
  walk(node);
  const [head = [], ...body] = rows;
  return {
    columns: head.map(hastText).map(cellText),
    heads: head,
    rows: body.map((row) => row.map(hastText)),
    cells: body,
  };
}

function TableView(props) {
  const { live, stateKey, content } = useContext(BlockContext);
  const position = props.node.position;
  const source = content?.slice(position?.start?.offset, position?.end?.offset) || hastText(props.node);
  const identity = blockKey(stateKey || "view", position?.start?.offset, live ? "streaming" : source);
  return <TableBlock key={identity} {...props} />;
}

function TableBlock({ node, "data-src": src }) {
  const { open, presentation, live, interactive, automatic, content, requestText, stateKey } = useContext(BlockContext);
  const data = useMemo(() => tableData(node), [node]);
  const [sort, setSort] = useState({ column: null, direction: "asc" });
  const context = useMemo(() => sectionContext(content, node.position?.start?.offset), [content, node.position?.start?.offset]);
  const suggested = useMemo(() => automatic ? tablePresentation(data.columns, data.rows, context, requestText) : { view: "table", explore: false }, [automatic, data, context, requestText]);
  const [chosenView, setView] = useState(null);
  const view = chosenView || suggested.view;
  const [done, copy] = useCopy();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState([]);
  const [onlySelected, setOnlySelected] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const enhance = presentation !== "minimal" && !live && interactive && data.rows.length >= 2 && data.rows.length <= 200 && data.columns.length <= 20;
  const displayed = useMemo(() => tableView(data.rows, {
    ...(enhance && { query, selected, onlySelected }), ...sort,
  }), [data, enhance, query, selected, onlySelected, sort]);
  const visible = displayed.indices;
  const rowNumbers = new Map();
  data.rows.forEach((row, i) => { if (!isSectionRow(row)) rowNumbers.set(i, rowNumbers.size + 1); });
  const numeric = data.columns.map((_, i) => isNumericColumn(data.rows, i));
  const plan = presentation === "minimal" || live ? null : safeChartPlan(data.columns, data.rows);

  /* Numbers sort largest first, words A to Z; a third press restores the
     order Vaelo wrote. */
  function toggle(column) {
    const first = numeric[column] ? "desc" : "asc";
    setSort((current) => {
      if (current.column !== column) return { column, direction: first };
      if (current.direction === first)
        return { column, direction: first === "asc" ? "desc" : "asc" };
      return { column: null, direction: "asc" };
    });
  }

  if (!data.columns.length) return null;
  /* Asked for a bento or overview cards, a plain label and value table is
     shown as the cards it stands for. */
  if (automatic && interactive && wantsOverview(requestText) && data.columns.length <= 3 && data.rows.length >= 2 && data.rows.length <= 12 && !data.rows.some(isSectionRow)) {
    const items = data.rows.map((row) => ({ label: cellText(row[0]), value: cellText(row[1]), ...(row[2] && { detail: cellText(row[2]) }) }));
    if (items.every((item) => item.label && item.value && item.label.length <= 200 && item.value.length <= 200))
      return <div data-src={src}><RichUI source={JSON.stringify({ type: "overview", items })} enabled stateKey={`${stateKey}:overview`} /></div>;
  }
  return (
    <figure className="table-block" data-src={src}>
      <figcaption className="block-bar">
        <span className="label">Table</span>
        <span className="block-count">
          {displayed.total} {displayed.total === 1 ? "row" : "rows"}
        </span>
        <span className="block-tools">
          {plan && (
            <span className="segmented" role="group" aria-label="View as">
              <button
                className="block-tool"
                aria-label="Show as table"
                aria-pressed={view === "table"}
                onClick={() => setView("table")}
              >
                <Table size={15} /> <span>Table</span>
              </button>
              <button
                className="block-tool"
                aria-label="Show as chart"
                aria-pressed={view === "chart"}
                onClick={() => setView("chart")}
              >
                <ChartBar size={15} /> <span>Chart</span>
              </button>
            </span>
          )}
          <button
            className="block-tool"
            onClick={() => copy(toTSV(data.columns, data.rows))}
            aria-label={done ? "Copied" : "Copy table for a spreadsheet"}
          >
            {done ? <Check size={15} /> : <Copy size={15} />}
            <span>{done ? "Copied" : "Copy"}</span>
          </button>
          <button
            className="block-tool"
            onClick={() => download("vaelo-table.csv", toCSV(data.columns, data.rows), "text/csv")}
            aria-label="Download as CSV"
          >
            <DownloadSimple size={15} /> <span>CSV</span>
          </button>
          <button
            className="block-tool icon-only"
            data-tip="Open in workspace"
            aria-label="Open table in workspace, to filter and sort"
            onClick={() =>
              open({
                kind: "table",
                title: `Table · ${displayed.total} ${displayed.total === 1 ? "row" : "rows"}`,
                source: blockKey("table", node.position?.start?.offset, toTSV(data.columns, data.rows)),
                columns: data.columns,
                rows: data.rows.map((row) => row.map(cellText)),
              })
            }
          >
            <ArrowsOut size={15} />
          </button>
        </span>
      </figcaption>
      {enhance && <details className="local-table-tools" onToggle={event => setToolsOpen(event.currentTarget.open)}>
        <summary>Filter and compare{query || onlySelected ? ` · ${displayed.count} of ${displayed.total} rows` : ''}</summary>
        <div className="local-controls">
          <label>Filter rows <input type="search" maxLength={200} value={query} onChange={e => setQuery(e.target.value)} placeholder="Find in this table" /></label>
          <button className="block-tool" aria-pressed={onlySelected} disabled={!selected.length && !onlySelected} onClick={() => setOnlySelected(v => !v)}>Compare selected ({selected.length})</button>
          <button className="block-tool" onClick={() => { setQuery(""); setSelected([]); setOnlySelected(false); setSort({ column: null, direction: "asc" }); }}>Reset view</button>
        </div>
        <p className="local-note" role="status">{displayed.count} of {displayed.total} rows · Copy and CSV include the original table.</p>
      </details>}
      {view === "chart" && plan && visible.length > 0 ? (
        <Chart columns={data.columns} rows={displayed.rows} plan={plan} />
      ) : (
        <TableScroll>
          <table style={{ "--table-min-width": `${Math.min(38, data.columns.length * 7 + (enhance && toolsOpen ? 3.5 : 0))}rem` }}>
            <thead>
              <tr>
                {enhance && toolsOpen && <th scope="col"><span className="sr-only">Compare</span></th>}
                {data.heads.map((head, i) => (
                  <th
                    key={i}
                    scope="col"
                    data-numeric={numeric[i] || undefined}
                    aria-sort={
                      sort.column === i
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                  >
                    <button onClick={() => toggle(i)} aria-label={`Sort by ${data.columns[i]}`} data-tip="Sort by this column">
                      {inline(head, i)}
                      <span className="sort-mark" aria-hidden="true">{sort.column === i ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => isSectionRow(data.rows[r]) ? (
                <tr key={r} className="table-section">
                  <th scope="rowgroup" colSpan={data.columns.length + (enhance && toolsOpen ? 1 : 0)}>{inline(data.cells[r][0], 0)}</th>
                </tr>
              ) : (
                <tr key={r}>
                  {enhance && toolsOpen && <td><input type="checkbox" aria-label={`Compare row ${rowNumbers.get(r)}: ${data.rows[r][0]}`} checked={selected.includes(r)} onChange={e => setSelected(items => e.target.checked ? [...items, r] : items.filter(i => i !== r))} /></td>}
                  {data.cells[r].map((cell, i) => (
                    <td key={i} data-numeric={numeric[i] || undefined}>
                      {inline(cell, i)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {enhance && visible.length === 0 && <p className="local-note">No matching rows. Reset the view to see the full table.</p>}
      {enhance && visible.length > 0 && <NumberExplorer defaultOpen={suggested.explore} columns={data.columns} rows={displayed.rows.filter(row => !isSectionRow(row))} />}
    </figure>
  );
}

/* ---------- Images ---------- */

/* Images Hermes makes or returns arrive as data: URLs and are shown in
   place. Images on other sites are linked, not loaded, so reading a reply
   never pings a third party. */
/* The tiles the image placeholder is made of; shared with the reveal so the
   picture appears from the same grid that stood in for it. */
export const IMAGE_COLUMNS = 8;
export const IMAGE_ROWS = 6;

export function imageTiles(className) {
  return Array.from({ length: IMAGE_COLUMNS * IMAGE_ROWS }, (_, i) => (
    <span
      key={i}
      className={className}
      style={{ "--i": (i % IMAGE_COLUMNS) + Math.floor(i / IMAGE_COLUMNS) }}
    />
  ));
}

function ImageRef({ alt, src }) {
  const { live } = useContext(BlockContext);
  /* An image that arrives while you watch is uncovered tile by tile; one
     already in the conversation is simply there. */
  const [reveal] = useState(live);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setLoaded(false); setFailed(false); }, [src]);
  if (failed) return <span className="image-ref" role="img" aria-label={alt || 'Image from Vaelo'}>{alt || 'Image from Vaelo'} <span className="local-note">This image could not be displayed.</span></span>;
  if (/^data:image\/(png|jpeg|webp|gif);base64,/.test(src || ""))
    return (
      <span className="image-inline">
        <span className="image-frame" data-reveal={reveal || undefined} data-loaded={loaded || undefined}>
          <img
            src={src}
            alt={alt || "Image from Vaelo"}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
          {reveal && (
            <span className="image-tiles" aria-hidden="true">
              {imageTiles("image-tile")}
            </span>
          )}
        </span>
        {alt && <span className="image-caption">{alt}</span>}
      </span>
    );
  const url = parseUrl(src || "");
  return (
    <span className="image-ref">
      <span className="label">Image</span> {alt || "Untitled image"}
      {url && (
        <a href={url.href} target="_blank" rel="noopener noreferrer">
          Open <ArrowSquareOut size={13} />
        </a>
      )}
    </span>
  );
}

function LocalList({ node, children, ordered = false, "data-src": src, ...props }) {
  const { presentation, live, interactive, stateKey, content, automatic } = useContext(BlockContext);
  const Tag = ordered ? "ol" : "ul";
  if (!interactive || live || presentation === "minimal") return <Tag {...props} data-src={src}>{children}</Tag>;
  const items = (node.children || []).filter(n => n.tagName === "li");
  const supported = n => n.type === "text" || (["p", "strong", "em", "del", "code", "a", "br", "input"].includes(n.tagName) && (n.children || []).every(supported));
  const nested = items.some(item => !(item.children || []).every(supported));
  const checkbox = n => n.tagName === "input" ? n : (n.children || []).map(checkbox).find(Boolean);
  const defaults = items.map(item => !!checkbox(item)?.properties?.checked);
  const tasks = items.some(item => !!checkbox(item));
  const signature = content?.slice(node.position?.start?.offset, node.position?.end?.offset) || items.map(hastText).join("\n");
  const key = blockKey(stateKey || "temporary", node.position?.start?.offset, signature);
  // Key the inner component by the exact block, so edits and versions reset state.
  if (nested || items.length < (tasks ? 1 : 2) || items.length > 80 || signature.length > 50000) {
    return <Tag {...props} data-src={src}>{children}</Tag>;
  }
  const rich = items.some(item => {
    const simple = n => n.type === "text" || (["p", "strong", "em"].includes(n.tagName) && (n.children || []).every(simple));
    return !(item.children || []).every(simple);
  });
  const inferred = automatic && !tasks ? inferListPresentation(items.map(hastText), { context: sectionContext(content, node.position?.start?.offset), rich }) : null;
  if (inferred?.kind === "metrics" || inferred?.kind === "timeline") return <InferredList key={key} inferred={inferred} original={<Tag {...props}>{children}</Tag>} src={src} />;
  return <Checklist key={key} autoActive={inferred?.kind === "checklist"} storageKey={stateKey ? key : null} defaults={defaults} tasks={tasks} items={items} original={children} ordered={ordered} src={src} start={props.start} />;
}

function InferredList({ inferred, original, src }) {
  const [originalView, setOriginalView] = useState(false);
  return <div className="inferred-block" data-src={src}>
    {originalView ? original : inferred.kind === "metrics" ? <Metrics source={inferred.source} settled /> : <Timeline source={inferred.source} settled />}
    <button className="block-tool" onClick={() => setOriginalView(v => !v)}>{originalView ? "Show visual view" : "Show original list"}</button>
  </div>;
}

function Checklist({ storageKey, defaults, tasks, autoActive, items, original, ordered, src, start }) {
  const [active, setActive] = useState(tasks || autoActive);
  const [stepView, setStepView] = useState(false);
  const [values, setValues] = useState(() => storageKey ? readChecklist(storageKey, defaults) : defaults);
  const [saved, setSaved] = useState(true);
  const Tag = ordered ? "ol" : "ul";
  const completed = values.filter(Boolean).length;
  function update(next) {
    setValues(next);
    setSaved(storageKey ? saveChecklist(storageKey, next) : false);
  }
  return <div className="local-checklist" data-src={src}>
    <div className="local-checklist-bar">
      <button className="block-tool" onClick={() => setActive(v => !v)}>{active ? "Show original list" : "Use as checklist"}</button>
      {ordered && <button className="block-tool" aria-pressed={stepView} onClick={() => setStepView(v => !v)}>{stepView ? "Leave step view" : "Step through"}</button>}
      {active && <><span className="local-note" role="status">{completed} / {items.length} done</span><button className="block-tool" onClick={() => update(defaults)}>Reset checks</button></>}
    </div>
    {stepView ? <StepPlayer items={items} render={item => item.children.filter(n => n.tagName !== "input").map((n, j) => inline(n, j))} /> : active ? <>
      <progress max={items.length} value={completed} aria-label="Checklist progress" />
      <ul className="local-check-items">{items.map((item, i) => <li key={i}>
        <label><input type="checkbox" checked={values[i]} onChange={e => update(values.map((v, j) => j === i ? e.target.checked : v))} />
          <span data-checked={values[i] || undefined}>{ordered && <span className="local-step">{(start || 1) + i}. </span>}{item.children.filter(n => n.tagName !== "input").map((n, j) => inline(n, j))}</span>
        </label>
      </li>)}</ul>
      <p className="local-note">{saved && storageKey ? "Checks stay on this device." : "Checks last for this view; storage is unavailable."} Vaelo’s answer stays unchanged; checks are not sent to the model.</p>
    </> : <Tag start={ordered ? start : undefined}>{original}</Tag>}
  </div>;
}

function RichParagraph({ node, children, "data-src": src, ...props }) {
  const { presentation, stateKey, requestText, live, content } = useContext(BlockContext);
  const source = content.slice(node.position?.start?.offset, node.position?.end?.offset).trim();
  if (presentation !== 'minimal' && !live && source.startsWith('{') && richPayload(source, '', requestText)) return <div data-src={src}><RichUI source={source} enabled stateKey={stateKey} /></div>;
  return <p {...props} data-src={src}>{children}</p>;
}

const components = {
  p: RichParagraph,
  a: ({ href, children }) => <SourceLink href={href}>{children}</SourceLink>,
  img: ImageRef,
  pre: CodeBlock,
  table: TableView,
  ul: LocalList,
  ol: props => <LocalList {...props} ordered />,
};

const remarkPlugins = [remarkGfm];

/* Markdown's own filter drops every data: URL, which would leave the images
   Hermes makes with nothing to show. Raster images inline are let through
   (they can't run anything); every other URL gets the usual filter. */
function urlTransform(url, key, node) {
  if (key === "src" && node.tagName === "img" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(url))
    return url;
  return defaultUrlTransform(url);
}

/* Marks each block with where it sits in the Markdown ("start:end"), so a
   selection in the rendered document maps back to its source words. */
const MAPPED_TAGS = new Set([
  "p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "table", "hr",
]);

function rehypeSourceMap() {
  return (tree) => {
    const walk = (node) => {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (node.type === "element" && MAPPED_TAGS.has(node.tagName) && start != null && end != null)
        node.properties = { ...node.properties, dataSrc: `${start}:${end}` };
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

const mappedPlugins = [rehypeSourceMap];

/* A block that fails to render stays a local problem: the reply's words
   are still shown as plain text and the rest of the conversation is intact. */
class BlockBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(previous) {
    if (this.state.failed && previous.content !== this.props.content) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <>
        <p className="block-fallback">Part of this reply couldn’t be laid out, so here it is as plain text.</p>
        <pre className="block-plain">{this.props.content}</pre>
      </>
    );
  }
}

export function useSources(content) {
  return useMemo(() => collectSources(content || ""), [content]);
}

export function Rendered({ content, sources, onOpen, mapped = false, live = false, stateKey, requestText = "" }) {
  const preference = useContext(PresentationContext);
  const presentation = wantsPlainReply(requestText) ? "minimal" : preference;
  const value = useMemo(
    () => ({
      sources,
      byKey: new Map(sources.map((source) => [source.id, source])),
      open: onOpen,
      presentation,
      content,
      live,
      stateKey,
      requestText,
      interactive: !mapped && !wantsPlainReply(requestText),
      automatic: !mapped && presentation !== "minimal" && !live,
    }),
    [sources, onOpen, presentation, content, live, stateKey, mapped, requestText],
  );
  return (
    <BlockContext.Provider value={value}>
      <BlockBoundary content={content}>
        <Markdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={mapped ? mappedPlugins : undefined}
          components={components}
          urlTransform={urlTransform}
        >
          {content}
        </Markdown>
      </BlockBoundary>
    </BlockContext.Provider>
  );
}
