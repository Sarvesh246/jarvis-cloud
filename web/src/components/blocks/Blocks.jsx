import React, { createContext, useContext, useMemo, useState } from "react";
import Markdown from "react-markdown";
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
import { cellText, chartable, isNumericColumn, sortRows, toCSV, toNumber, toTSV } from "../../lib/table.js";
import { STRUCTURED, metricsText, parseMetrics, parseTimeline, timelineText } from "../../lib/structured.js";
import { SourceIcon } from "./SourceIcon.jsx";
import "./blocks.css";

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
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      /* clipboard can be blocked; the text stays selectable */
    }
  };
  return [done, copy];
}

export function download(name, text, type = "text/plain") {
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
  return (code?.props?.className || "").match(/language-([\w+-]+)/)?.[1]?.toLowerCase() || "";
}

/* A fenced block is either code, or one of the shapes Vaelo can answer in. */
function CodeBlock({ children }) {
  const language = languageOf(children);
  if (STRUCTURED.has(language)) {
    const source = textOf(children);
    return language === "metrics" ? <Metrics source={source} /> : <Timeline source={source} />;
  }
  return <CodeFigure language={language}>{children}</CodeFigure>;
}

function CodeFigure({ language, children }) {
  const { open } = useContext(BlockContext);
  const [done, copy] = useCopy();
  const [expanded, setExpanded] = useState(false);
  const source = textOf(children).replace(/\n$/, "");
  const lines = source.split("\n").length;
  const folds = lines > FOLD_AT + 6;
  const canPreview = language === "html" || looksLikeSvg(language, source);
  const name = language.length <= 4 ? language.toUpperCase() : language[0]?.toUpperCase() + language.slice(1);
  const item = { kind: "code", language, source, title: language ? `${name} snippet` : "Snippet" };

  return (
    <figure className="code" data-folded={folds && !expanded ? true : undefined}>
      <figcaption className="block-bar">
        <span className="label">{language || "Code"}</span>
        <span className="block-count">{lines} {lines === 1 ? "line" : "lines"}</span>
        <span className="block-tools">
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
            title="Download"
            aria-label="Download code"
            onClick={() => download(`vaelo-snippet.${EXT[language] || "txt"}`, source)}
          >
            <DownloadSimple size={15} />
          </button>
          <button
            className="block-tool icon-only"
            title="Open in workspace"
            aria-label="Open code in workspace"
            onClick={() => open({ ...item, tab: "code" })}
          >
            <ArrowsOut size={15} />
          </button>
        </span>
      </figcaption>
      <pre tabIndex={0} aria-label={`${language || "Code"}, ${lines} lines`}>
        {children}
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

function Metrics({ source }) {
  const { presentation } = useContext(BlockContext);
  const data = useMemo(() => parseMetrics(source), [source]);
  const [done, copy] = useCopy();
  if (!data.items.length) return <p className="block-pending">Laying out figures…</p>;
  if (presentation === "minimal") return <pre className="block-plain">{metricsText(data)}</pre>;
  const [lead, ...rest] = data.items;
  return (
    <figure className="metrics" aria-label={data.title || "Key figures"}>
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
        <span className="metrics-lead-value">{lead.value}</span>
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
      {data.notes.map((note, i) => (
        <p key={i} className="metrics-note">
          {note}
        </p>
      ))}
    </figure>
  );
}

function Timeline({ source }) {
  const { presentation } = useContext(BlockContext);
  const data = useMemo(() => parseTimeline(source), [source]);
  const [done, copy] = useCopy();
  if (!data.events.length) return <p className="block-pending">Laying out the timeline…</p>;
  if (presentation === "minimal") return <pre className="block-plain">{timelineText(data)}</pre>;
  return (
    <figure className="timeline" aria-label={data.title || "Timeline"}>
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
        {data.events.map((event, i) => (
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
  if (!url) return <a href={href}>{children}</a>;
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

export function SourceStrip({ sources, onOpen }) {
  if (!sources.length) return null;
  const shown = sources.slice(0, 4);
  return (
    <button className="source-strip" onClick={onOpen} aria-label={`Show ${sources.length} sources`}>
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
        <span className="source-more">+{sources.length - shown.length}</span>
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

function Chart({ columns, rows, plan }) {
  const [column, setColumn] = useState(plan.values[0]);
  const values = rows.map((row) => toNumber(row[column]));
  const max = Math.max(...values.map(Math.abs)) || 1;
  const labelOf = (row, i) => (plan.label != null ? cellText(row[plan.label]) : `Row ${i + 1}`);
  const order = values.map((v, i) => i).sort((a, b) => values[b] - values[a]);
  const summary = `${columns[column]}: highest is ${labelOf(rows[order[0]], order[0])} at ${cellText(rows[order[0]][column])}; lowest is ${labelOf(rows[order.at(-1)], order.at(-1))} at ${cellText(rows[order.at(-1)][column])}.`;
  return (
    <div className="chart">
      {plan.values.length > 1 && (
        <div className="chart-pick" role="radiogroup" aria-label="Column to chart">
          {plan.values.map((i) => (
            <button
              key={i}
              role="radio"
              aria-checked={i === column}
              className="chip"
              data-on={i === column || undefined}
              onClick={() => setColumn(i)}
            >
              {columns[i]}
            </button>
          ))}
        </div>
      )}
      <p className="chart-summary">{summary}</p>
      <ol className="chart-bars" aria-hidden="true">
        {rows.map((row, i) => (
          <li key={i}>
            <span className="chart-label">{labelOf(row, i)}</span>
            <span className="chart-track">
              <span
                className="chart-bar"
                data-negative={values[i] < 0 || undefined}
                style={{ "--w": `${(Math.abs(values[i]) / max) * 100}%` }}
              />
            </span>
            <span className="chart-value">{cellText(row[column])}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TableBlock({ node }) {
  const { open, presentation } = useContext(BlockContext);
  const data = useMemo(() => tableData(node), [node]);
  const [sort, setSort] = useState({ column: null, direction: "asc" });
  const [view, setView] = useState("table");
  const [done, copy] = useCopy();
  const numeric = data.columns.map((_, i) => isNumericColumn(data.rows, i));
  const plan = presentation === "minimal" ? null : chartable(data.columns, data.rows);
  const order = useMemo(() => {
    const indexed = data.rows.map((row, i) => [...row, i]);
    return sortRows(indexed, sort.column, sort.direction).map((row) => row.at(-1));
  }, [data, sort]);

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
  return (
    <figure className="table-block">
      <figcaption className="block-bar">
        <span className="label">Table</span>
        <span className="block-count">
          {data.rows.length} {data.rows.length === 1 ? "row" : "rows"}
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
            title="Open in workspace"
            aria-label="Open table in workspace, to filter and sort"
            onClick={() =>
              open({
                kind: "table",
                title: `Table · ${data.rows.length} ${data.rows.length === 1 ? "row" : "rows"}`,
                columns: data.columns,
                rows: data.rows.map((row) => row.map(cellText)),
              })
            }
          >
            <ArrowsOut size={15} />
          </button>
        </span>
      </figcaption>
      {view === "chart" && plan ? (
        <Chart columns={data.columns} rows={data.rows} plan={plan} />
      ) : (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Table, scrolls sideways">
          <table>
            <thead>
              <tr>
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
                    <button onClick={() => toggle(i)} title="Sort by this column">
                      {inline(head, i)}
                      {sort.column === i && (
                        <span className="sort-mark" aria-hidden="true">
                          {sort.direction === "asc" ? "↑" : "↓"}
                        </span>
                      )}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.map((r) => (
                <tr key={r}>
                  {data.cells[r].map((cell, i) => (
                    <td key={i} data-numeric={numeric[i] || undefined}>
                      {inline(cell, i)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}

/* ---------- Images ---------- */

/* Images Hermes makes or returns arrive as data: URLs and are shown in
   place. Images on other sites are linked, not loaded, so reading a reply
   never pings a third party. */
function ImageRef({ alt, src }) {
  if (/^data:image\/(png|jpeg|webp|gif);base64,/.test(src || ""))
    return (
      <span className="image-inline">
        <img src={src} alt={alt || "Image from Vaelo"} loading="lazy" />
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

const components = {
  a: ({ href, children }) => <SourceLink href={href}>{children}</SourceLink>,
  img: ImageRef,
  pre: CodeBlock,
  table: TableBlock,
};

const remarkPlugins = [remarkGfm];

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

export function Rendered({ content, sources, onOpen }) {
  const presentation = useContext(PresentationContext);
  const value = useMemo(
    () => ({
      sources,
      byKey: new Map(sources.map((source) => [source.id, source])),
      open: onOpen,
      presentation,
    }),
    [sources, onOpen, presentation],
  );
  return (
    <BlockContext.Provider value={value}>
      <BlockBoundary content={content}>
        <Markdown remarkPlugins={remarkPlugins} components={components}>
          {content}
        </Markdown>
      </BlockBoundary>
    </BlockContext.Provider>
  );
}
