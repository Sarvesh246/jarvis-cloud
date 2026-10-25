import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from 'react-dom';
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { KATEX_OPTIONS, hasMath, normalizeMath, prepareLive, rehypeMathBlock, remarkMathDisplay } from "../../lib/math.js";
import {
  ArrowSquareOut,
  ArrowCounterClockwise,
  ArrowsInLineVertical,
  ArrowsOut,
  ChartBar,
  Check,
  Copy,
  DownloadSimple,
  Eye,
  MagnifyingGlass,
  SlidersHorizontal,
  ArrowsDownUp,
  Columns,
  FileCode,
  TextAlignLeft,
  Table,
} from "@phosphor-icons/react";
import { collectSources, domainOf, kindLabel, parseUrl, sourceKey } from "../../lib/sources.js";
import { cellText, comparisonAxis, differenceCells, isNumericColumn, isSectionRow, tableView, toCSV, toTSV, toNumber } from "../../lib/table.js";
import { usePhone } from "../../lib/use-phone.js";
import {
  STRUCTURED,
  fenceClosed,
  metricsText,
  parseMetrics,
  parseTimeline,
  timelineText,
} from "../../lib/structured.js";
import { blockKey, readChecklist, saveChecklist } from "../../lib/intelligent-ui.js";
import { inferListPresentation, sectionContext, tablePresentation, overviewItems, wantsPlainReply, safeChartPlan } from "../../lib/adaptive-ui.js";
import { TableScroll } from "./TableScroll.jsx";
import { Chart } from "./Chart.jsx";
import { richPayload, pendingRichPayload, wantsSourceReply, gridOverview, treePaths, wantsOverview } from "../../lib/rich-ui.js";
import { RichUI, StepPlayer, Lightbox, ImageDownload } from "./AfterUI.jsx";
import { InlinePreview } from "./InlinePreview.jsx";
import { NumberExplorer } from "./LocalTools.jsx";
import { bestTableCells, timelineLayout } from '../../lib/output-redesign.js';
import { automaticPresentation } from '../../lib/automatic-presentation.js';
import { cleanAnswer } from '../../../shared/answer-cleanup.js';
import { weatherForecast, weatherMarkdown } from '../../lib/weather.js';
import { Weather } from './Weather.jsx';
import { SourceIcon } from "./SourceIcon.jsx";
import { Highlighted } from "./Highlighted.jsx";
import { Rolling } from "../Rolling.jsx";
import { readWorkProposal } from "../../lib/work-proposals.js";
import { getWorkspace } from "../../../shared/workspaces.js";
import { getCheck } from "../../../shared/checks.js";
import "./blocks.css";
import "./output-layout.css";
import "./output-polish.css";
import "./after.css";
import "./math.css";
import "./finish.css";
import "./mobile-tables.css";
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import { copyText } from "../../lib/desktop.js";
import { download } from "../../lib/file-download.js";
import { AudioCard } from '../EverydayUI.jsx';
import { audioLinks } from '../../lib/everyday-ui.js';
export { download } from "../../lib/file-download.js";

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

const FOLD_AT = 18;

function languageOf(children) {
  const code = Array.isArray(children) ? children[0] : children;
  return (code?.props?.className || "").match(/language-([\w+/-]+)/)?.[1]?.toLowerCase() || "";
}

/* A fenced block is either code, or one of the shapes Vaelo can answer in.
   In a mapped document each block carries where it sits in the Markdown
   (data-src), so a selection can be traced back to the words behind it. */
function CodeBlock({ children, node, "data-src": src }) {
  const { content, open, live, presentation, stateKey, requestText, onAnswer } = useContext(BlockContext);
  const language = languageOf(children);
  const source = textOf(children);
  const grid = !wantsSourceReply(requestText) && !live ? gridOverview(source, language) || treePaths(source, language) : null;
  if (grid && presentation !== "minimal") return <div data-src={src}><RichUI source={JSON.stringify(grid)} enabled stateKey={stateKey} /></div>;
  const payload = richPayload(source, language, requestText);
  const settled = fenceClosed(content, node?.position?.start?.offset, node?.position?.end?.offset);
  const pending = live && !settled && pendingRichPayload(source, language, requestText);
  if (payload || pending || (language === "vaelo-ui" && !wantsSourceReply(requestText))) {
    return <div data-src={src}><RichUI key={blockKey(stateKey || "temporary", node?.position?.start?.offset, textOf(children))} source={textOf(children)} enabled={settled && presentation !== "minimal"} pending={live && !settled && presentation !== 'minimal'} stateKey={stateKey} onAnswer={onAnswer} /></div>;
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
  if ((language === 'html' || looksLikeSvg(language, source)) && settled && !live && presentation !== 'minimal') return <InlinePreview source={source} language={language} src={src} />;
  return (
    <CodeFigure language={language} filename={node?.children?.find(child => child.tagName === 'code')?.properties?.['data-filename']} src={src}>
      {children}
    </CodeFigure>
  );
}

function CodeFigure({ language, filename, src, children }) {
  const { open } = useContext(BlockContext);
  const [done, copy] = useCopy();
  const [expanded, setExpanded] = useState(false);
  const [wrapped, setWrapped] = useState(false);
  const [foldAll, setFoldAll] = useState(false);
  const source = textOf(children).replace(/\n$/, "");
  const lines = source.split("\n").length;
  const folds = lines > FOLD_AT;
  const canPreview = language === "html" || looksLikeSvg(language, source);
  const name = language.length <= 4 ? language.toUpperCase() : language[0]?.toUpperCase() + language.slice(1);
  const item = { kind: "code", language, source, title: language ? `${name} snippet` : "Snippet" };
  const downloadName = filename?.split(/[\\/]/).at(-1) || `snippet.${EXT[language] || 'txt'}`;

  return (
    <figure className="code" data-src={src} data-wrapped={wrapped || undefined} data-folded={folds && !expanded ? true : undefined}>
      <figcaption className="block-bar">
        <span className="label"><FileCode size={16} />{filename || downloadName}</span>
        <span className="block-count">{name || 'Code'} · {lines} {lines === 1 ? "line" : "lines"}</span>
        <span className="block-tools">
          <button className="block-tool icon-only" aria-label={foldAll ? 'Unfold all' : 'Fold all'} title={foldAll ? 'Unfold all blocks' : 'Fold all blocks'} aria-pressed={foldAll} onClick={() => setFoldAll(value => !value)}><ArrowsInLineVertical size={17} /></button>
          <button className="block-tool icon-only" aria-label="Wrap lines" title="Wrap lines" aria-pressed={wrapped} onClick={() => setWrapped(value => !value)}><TextAlignLeft size={17} /></button>
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
            onClick={() => download(downloadName, source)}
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
        <Highlighted source={source} language={language} lineNumbers foldAll={foldAll} />
      </pre>
      {folds && (
        <button className="code-fold" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Collapse" : `Show ${lines - FOLD_AT} more lines`}
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
    <span className="metric-delta" data-direction={item.direction} data-sentiment={/\b(?:refund|error|churn|cost|latency|defect|bounce)\b/i.test(item.label) ? item.direction === 'down' ? 'good' : 'bad' : item.direction === 'up' ? 'good' : 'bad'}>
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
  const [replay, setReplay] = useState(0);
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
        <span className="block-heading"><strong>{data.title || 'Key figures'}</strong><small>{data.items.length} figures</small></span>
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
          {settled && lead.value.length <= 18 ? <Rolling key={replay} value={lead.value} enter={arriving || replay > 0} /> : lead.value}
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
      <footer className="after-footer"><span>Figures as supplied.</span><button className="block-tool" onClick={() => setReplay(value => value + 1)} aria-label="Replay figures"><ArrowCounterClockwise size={15} />Replay</button></footer>
    </figure>
  );
}

function Timeline({ source, src, settled }) {
  const { presentation, live } = useContext(BlockContext);
  const data = useMemo(() => parseTimeline(source), [source]);
  const [done, copy] = useCopy();
  /* A finished line without a date still belongs in the sequence */
  const [selected, setSelected] = useState(null);
  const plan = timelineLayout(settled || !live ? data.rows : data.events);
  const events = plan.events;
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
        <span className="block-heading"><strong>{data.title || 'Timeline'}</strong><small>{events.length} milestones{events.some(event => event.status === 'done') ? ` · ${events.filter(event => event.status === 'done').length} complete` : ''}</small></span>
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
      <div className="timeline-phases">{events.map((event, i) => <button key={i} aria-pressed={selected === i} data-state={event.status} style={{ flex:event.duration }} onClick={() => setSelected(i)}>{event.what}</button>)}{plan.today !== null && <span className="timeline-today" style={{left:`calc(20px + (100% - 40px) * ${plan.today / 100})`}} title="Today" />}</div>
      <ol className="timeline-list">
        {events.map((event, i) => (
          <li key={i} data-state={event.status} data-active={selected === i || undefined} onClick={() => setSelected(i)}>
            <span className="timeline-when" title={event.when}>{event.displayDate}<span className="timeline-relative">{event.relative}</span></span>
            <span className="timeline-state-dot" aria-hidden="true">{event.status === 'done' ? '✓' : ''}</span><span className="timeline-what">
              {event.what}
              {event.detail && <span className="timeline-detail">{event.detail}</span>}
            </span>
            {event.status && <span className="timeline-state">{({done:'Done',past:'Past',current:'Now',upcoming:'Upcoming'})[event.status]}</span>}
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
              {/* Wide screens name the site; a phone shows the number the
                  sources sheet uses (phone.css chooses) */}
              <span className="cite-site">
                <SourceIcon kind={source.kind} size={11} />
                {source.domain}
              </span>
              <span className="cite-num">{source.index}</span>
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

function inline(node, key, wrapDimensions = false) {
  if (node.type === "text") {
    if (!wrapDimensions) return node.value;
    // Add layout opportunities between dimensions without changing copied or
    // exported values, or inserting breaks inside an individual measurement.
    const parts = node.value.split(/(?<=\d[×✕⨉xX])(?=\d)/u);
    if (parts.length === 1) return node.value;
    return parts.map((part, i) => <React.Fragment key={i}>{i > 0 && <wbr />}{part}</React.Fragment>);
  }
  if (node.type !== "element") return null;
  const kids = (node.children || []).map((child, i) => inline(child, i, wrapDimensions && node.tagName !== "code"));
  switch (node.tagName) {
    case "pre": {
      const code = node.children?.find(child => child.tagName === "code");
      return <CodeBlock key={key} node={node}><code className={(code?.properties?.className || []).join(" ")}>{hastText(code || node)}</code></CodeBlock>;
    }
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
  const phone = usePhone();
  const { open, presentation, live, interactive, automatic, content, requestText, stateKey } = useContext(BlockContext);
  const data = useMemo(() => tableData(node), [node]);
  const [sort, setSort] = useState({ column: null, direction: "asc" });
  const context = useMemo(() => sectionContext(content, node.position?.start?.offset), [content, node.position?.start?.offset]);
  const suggested = useMemo(() => automatic ? tablePresentation(data.columns, data.rows, context, requestText) : { view: "table", explore: false }, [automatic, data, context, requestText]);
  const [chosenView, setView] = useState(null);
  const [asTable, setAsTable] = useState(false);
  const view = chosenView || suggested.view;
  const [done, copy] = useCopy();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState([]);
  const [onlySelected, setOnlySelected] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const toolsOpen = !phone || mobileToolsOpen;
  const [highlight, setHighlight] = useState(false);
  const [differenceAxis, setDifferenceAxis] = useState(() => comparisonAxis(data.columns));
  const enhance = presentation !== "minimal" && !live && interactive && data.rows.length >= 2 && data.rows.length <= 200 && data.columns.length <= 20;
  const displayed = useMemo(() => tableView(data.rows, {
    ...(enhance && { query, selected, onlySelected }), ...sort,
  }), [data, enhance, query, selected, onlySelected, sort]);
  const visible = displayed.indices;
  const differences = useMemo(() => highlight && !phone ? differenceCells(data.rows, data.columns, visible, selected, differenceAxis) : new Set(), [highlight, phone, data, visible, selected, differenceAxis]);
  const best = useMemo(() => onlySelected ? bestTableCells(data.columns, data.rows, visible) : new Set(), [onlySelected, data, visible]);
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
  /* A short label and amount summary (one that ends in a total, sits under a
     summary heading, or was asked for as a bento) stands as cards. No request
     is needed; the table stays one press away. */
  const cardItems = automatic && interactive && !asTable && !live && (suggested.view === "cards" || wantsOverview(requestText))
    ? overviewItems(data.columns, data.rows, 12) : null;
  if (cardItems)
    return <div className="auto-cards" data-src={src}>
      <RichUI source={JSON.stringify({ type: "overview", items: cardItems })} enabled stateKey={`${stateKey}:overview`} />
      <button className="block-tool" onClick={() => setAsTable(true)}><Table size={15} /> <span>Show as table</span></button>
    </div>;
  if (enhance && suggested.explore && !asTable && chosenView === null) return <figure className="table-block" data-src={src}><NumberExplorer columns={data.columns} rows={data.rows.filter(row => !isSectionRow(row))} /><footer className="after-footer"><span>What-if calculations stay on this device</span><button className="block-tool" onClick={() => setAsTable(true)}><Table size={15} />Show original table</button></footer></figure>;
  return (
    <figure className="table-block" data-src={src} data-phone={phone || undefined}>
      <figcaption className="block-bar">
        <span className="label">{context && context.length < 80 && !context.includes('\n') ? context : 'Table'}</span>
        <span className="block-count">
          {displayed.total} {displayed.total === 1 ? "row" : "rows"}
        </span>
        <span className="block-tools">
          {phone && enhance && view === 'table' && <button className="block-tool" aria-label="Table tools" aria-expanded={mobileToolsOpen} onClick={() => setMobileToolsOpen(value => !value)}><SlidersHorizontal size={16} /><span>Tools</span></button>}
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
      {enhance && toolsOpen && view === 'table' && <div className="local-table-tools">
        <div className="local-controls">
          <label className="after-table-filter"><MagnifyingGlass size={16}/><input aria-label="Filter rows" type="search" maxLength={200} value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter rows…" /></label>
          <button className="block-tool after-table-compare" aria-pressed={onlySelected} disabled={!selected.length && !onlySelected} onClick={() => setOnlySelected(v => !v)}><Columns size={16}/>{onlySelected ? 'Show all rows' : `Compare (${selected.length})`}</button>
        </div>
        {onlySelected && !phone && <label className="table-difference-toggle"><input type="checkbox" checked={highlight} onChange={event => setHighlight(event.target.checked)} />Highlight differences</label>}
        {!phone && highlight && <><label className="table-difference-axis">Compare <select aria-label="Compare differences by" value={differenceAxis} onChange={event=>setDifferenceAxis(event.target.value)}><option value="rows">Rows</option><option value="columns" disabled={data.columns.length < 3}>Value columns</option></select></label><p className="local-note" role="status">{differenceAxis === 'rows' && selected.length < 2 && displayed.count !== 2 ? 'Select at least two rows to highlight their differences.' : `${differences.size} differing cells. Matching values stay plain.`}</p></>}
      </div>}
      {view === "chart" && plan && visible.length > 0 ? (
        <Chart columns={data.columns} rows={displayed.rows} plan={plan} stackedDefault={/\b(?:breakdown|stacked|share of|composition|parts of|how much of|came from|contribution)\b/i.test(requestText + ' ' + context)} />
      ) : (
        <TableScroll resizable={!live && data.rows.length > 1}>
          <table style={{ "--table-min-width": `${Math.min(38, data.columns.length * 7 + (enhance && toolsOpen ? 3.5 : 0))}rem` }}>
            <thead>
              <tr>
                {enhance && toolsOpen && <th scope="col" className="table-selection"><span className="sr-only">Compare</span></th>}
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
                      <span className="table-header-label">{inline(head, i, phone)}</span>
                      <span className="sort-mark" aria-hidden="true">{sort.column === i ? sort.direction === "asc" ? "↑" : "↓" : <ArrowsDownUp size={12} />}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => isSectionRow(data.rows[r]) ? (
                <tr key={r} className="table-section">
                  <th scope="rowgroup" colSpan={data.columns.length + (enhance && toolsOpen ? 1 : 0)}>{inline(data.cells[r][0], 0, phone)}</th>
                </tr>
              ) : (
                <tr key={r} data-selected={toolsOpen && selected.includes(r) || undefined} onClick={enhance && toolsOpen ? event => { if (event.target.closest('a,button,input')) return; setSelected(items => items.includes(r) ? items.filter(i => i !== r) : [...items, r]); } : undefined}>
                  {enhance && toolsOpen && <td className="table-selection"><input type="checkbox" aria-label={`Compare row ${rowNumbers.get(r)}: ${data.rows[r][0]}`} checked={selected.includes(r)} onChange={e => setSelected(items => e.target.checked ? [...items, r] : items.filter(i => i !== r))} /></td>}
                  {data.cells[r].map((cell, i) => (
                    <td key={i} data-numeric={numeric[i] || undefined} data-different={differences.has(`${r}:${i}`) || undefined}>
                      {best.has(`${r}:${i}`) && <span className="table-best" aria-label="Best value">★</span>}
                      {differences.has(`${r}:${i}`) && <span className="sr-only">Different: </span>}
                      {/\b(?:score|rating)\b/i.test(data.columns[i]) && Number.isFinite(toNumber(data.rows[r][i])) ? <span className="table-score"><i aria-hidden="true"><b style={{width:`${Math.max(0, toNumber(data.rows[r][i])) / Math.max(1, ...data.rows.map(row => toNumber(row[i])).filter(Number.isFinite)) * 100}%`}} /></i>{inline(cell, i, phone)}</span> : inline(cell, i, phone)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {enhance && visible.length === 0 && <p className="local-note">No matching rows. Reset the view to see the full table.</p>}
      {enhance && (toolsOpen || query || selected.length > 0 || sort.column !== null) && view === 'table' && <footer className="after-footer"><b>{selected.length ? `${selected.length} selected` : `${displayed.count} rows`}</b><span>{onlySelected ? 'Comparing selection' : 'Select rows to compare'}</span>{selected.length > 0 && <button className="block-tool" onClick={() => { setSelected([]); setOnlySelected(false); setHighlight(false); }}>Clear</button>}{(query || sort.column !== null) && <button className="block-tool" onClick={() => { setQuery(''); setSort({column:null,direction:'asc'}); }}>Reset view</button>}<span className="sr-only" role="status">{displayed.count} of {displayed.total} rows. Copy and CSV include the original table.</span></footer>}
      {enhance && suggested.explore && visible.length > 0 && <NumberExplorer defaultOpen columns={data.columns} rows={displayed.rows.filter(row => !isSectionRow(row))} />}
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
  const [expanded, setExpanded] = useState(false);
  const [dimensions, setDimensions] = useState('');
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
            onLoad={event => { setLoaded(true); setDimensions(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`); }}
            onError={() => setFailed(true)}
          />
          <span className="after-image-tools"><a href={src} target="_blank" rel="noopener noreferrer" aria-label="Open image"><ArrowSquareOut size={17} /></a><ImageDownload src={src} /><button aria-label="Expand image" onClick={() => setExpanded(true)}><ArrowsOut size={17} /></button></span>
          {reveal && (
            <span className="image-tiles" aria-hidden="true">
              {imageTiles("image-tile")}
            </span>
          )}
        </span>
        <span className="image-caption">{alt || 'Image from Vaelo'}<small>{dimensions}</small></span>
        {expanded && createPortal(<Lightbox images={[{src,alt:alt || 'Image from Vaelo'}]} index={0} setIndex={() => {}} onClose={() => setExpanded(false)} />, document.body)}
      </span>
    );
  const url = parseUrl(src || "");
  const Reference = url ? "a" : "span";
  return (
    <Reference className="image-ref" {...(url ? { href: url.href, target: "_blank", rel: "noopener noreferrer" } : {})}>
      <span className="label">Image</span> {alt || "Untitled image"}
      {url && (
        <span>
          Open <ArrowSquareOut size={13} />
        </span>
      )}
      <small>External reference · opens at the source; not loaded in chat.</small>
    </Reference>
  );
}

function LocalList({ node, children, ordered = false, "data-src": src, ...props }) {
  const { presentation, live, interactive, stateKey, content, automatic, requestText } = useContext(BlockContext);
  const Tag = ordered ? "ol" : "ul";
  if (!interactive || live || presentation === "minimal") return <Tag {...props} data-src={src}>{children}</Tag>;
  const items = (node.children || []).filter(n => n.tagName === "li");
  const procedural = ordered && automatic && /\b(?:how (?:do|can|to)|walk .{0,10}through|instructions|procedure|set.?up|install|recipe|one step at a time)\b/i.test(`${requestText} ${sectionContext(content, node.position?.start?.offset)}`);
  const supported = n => n.type === "text" || ((["p", "strong", "em", "del", "code", "a", "br", "input"].includes(n.tagName) || (procedural && n.tagName === "pre")) && (n.children || []).every(supported));
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
  const inferred = automatic && !tasks ? inferListPresentation(items.map(hastText), { context: `${sectionContext(content, node.position?.start?.offset)} ${/\b(?:pack|packing|checklist|to-?do|shopping list|prepare|before (?:i|we|you))\b/i.test(requestText) ? "checklist" : ""}`, rich }) : null;
  if (inferred?.kind === "metrics" || inferred?.kind === "timeline") return <InferredList key={key} inferred={inferred} original={<Tag {...props}>{children}</Tag>} src={src} />;
  if (procedural) return <div data-src={src}><StepPlayer items={items} render={item => item.children.filter(n => n.tagName !== 'input').map((n, j) => n.tagName === 'p' ? <p key={j}>{inline(n, j)}</p> : inline(n, j))} /></div>;
  if (!tasks && !inferred) return <Tag {...props} data-src={src}>{children}</Tag>;
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
  const [undo, setUndo] = useState(null);
  const Tag = ordered ? "ol" : "ul";
  const completed = values.filter(Boolean).length;
  function update(next) {
    setValues(next);
    setSaved(storageKey ? saveChecklist(storageKey, next) : false);
  }
  return <div className="local-checklist" data-src={src}>
    <div className="local-checklist-bar">
      {active && <><span className="checklist-ring" style={{'--progress': `${completed / items.length * 100}%`}}><span>{Math.round(completed / items.length * 100)}%</span></span><strong className="checklist-title">{completed === items.length ? 'All done' : 'Checklist'}</strong></>}
      <button className="block-tool" onClick={() => setActive(v => !v)}>{active ? "Show original list" : "Use as checklist"}</button>
      {ordered && <button className="block-tool" aria-pressed={stepView} onClick={() => setStepView(v => !v)}>{stepView ? "Leave step view" : "Step through"}</button>}
      {active && <><span className="local-note" role="status">{completed} / {items.length} done</span><button className="block-tool" onClick={() => { setUndo(values); update(values.map(() => false)); }}>Reset checks</button>{undo && <button className="block-tool" onClick={() => { update(undo); setUndo(null); }}>Undo reset</button>}</>}
    </div>
    {stepView ? <StepPlayer items={items} render={item => item.children.filter(n => n.tagName !== "input").map((n, j) => inline(n, j))} /> : active ? <>
      <span className="sr-only" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={completed} aria-label="Checklist progress" />
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
  if (presentation !== 'minimal' && source.startsWith('{')) {
    const payload = richPayload(source, '', requestText);
    // Math and emphasis inside JSON are data until the complete object is
    // decoded. Recover completed bare objects even while a reply streams.
    if (payload) return <div data-src={src}><RichUI source={source} enabled stateKey={stateKey} /></div>;
    if (live && pendingRichPayload(source, '', requestText)) return <div data-src={src}><RichUI source={source} enabled pending stateKey={stateKey} /></div>;
  }
  return <p {...props} data-src={src}>{children}</p>;
}

/* A displayed equation scrolls sideways on a narrow screen instead of
   spilling out, and can be copied as the LaTeX the model wrote. */
function MathBlock({ tex, children }) {
  const [done, copy] = useCopy();
  return (
    <span className="math-block">
      <span className="math-scroll" tabIndex={0} role="group" aria-label="Equation">{children}</span>
      {tex && (
        <button className="block-tool icon-only math-copy" aria-label={done ? "Copied LaTeX" : "Copy LaTeX"} data-tip={done ? "Copied" : "Copy LaTeX"} onClick={() => copy(tex)}>
          {done ? <Check size={15} /> : <Copy size={15} />}
        </button>
      )}
    </span>
  );
}

const components = {
  span: ({ node, className, "data-tex": tex, children, ...props }) =>
    typeof className === "string" && className.split(" ").includes("math-block")
      ? <MathBlock tex={tex}>{children}</MathBlock>
      : <span className={className} {...props}>{children}</span>,
  p: RichParagraph,
  a: ({ href, children }) => <SourceLink href={href}>{children}</SourceLink>,
  img: ImageRef,
  pre: CodeBlock,
  table: TableView,
  ul: LocalList,
  ol: props => <LocalList {...props} ordered />,
};

function remarkCodeFilename() {
  return tree => {
    const visit = node => {
      if (node.type === 'code' && typeof node.meta === 'string' && node.meta.length <= 160) {
        const match = node.meta.match(/^(?:(?:filename|title)=)?["']?([\w@./-]+\.[\w-]+)["']?$/);
        if (match && !match[1].split(/[\\/]/).includes('..')) node.data = {...node.data,hProperties:{...node.data?.hProperties,'data-filename':match[1]}};
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
/* One dollar never opens math here: normalizeMath rewrites the formulas it
   believes in as $$$ … $$$, so a price keeps its "$" in the source (tables and
   charts read that source). A mapped document is not rewritten at all, since
   its selections are traced back to the original; there only $$ … $$ is math. */
const remarkPlugins = [remarkGfm, [remarkMath, { singleDollarTextMath: false }], remarkMathDisplay, remarkCodeFilename];
const mappedRemarkPlugins = remarkPlugins;
const rehypeMath = [rehypeMathBlock, [rehypeKatex, KATEX_OPTIONS]];

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

const mappedPlugins = [rehypeSourceMap, ...rehypeMath];

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

export function Rendered({ content, sources = [], onOpen, onAnswer, mapped = false, live = false, stateKey, requestText = "", attached }) {
  content = cleanAnswer(content);
  const preference = useContext(PresentationContext);
  const presentation = wantsPlainReply(requestText) ? "minimal" : preference;
  const mathy = useMemo(() => hasMath(content), [content]);
  const audio = useMemo(() => !mapped && !live && presentation !== 'minimal' ? audioLinks(content) : [], [mapped, live, presentation, content]);
  const weather = useMemo(() => !mapped && !live && presentation !== 'minimal' ? weatherForecast(content, requestText) : null, [mapped, live, presentation, content, requestText]);
  const automaticView = useMemo(() => !weather && !mapped && !live && !mathy && presentation !== 'minimal' ? automaticPresentation(content, requestText, attached) : null, [weather, mapped, live, mathy, presentation, requestText, content, attached]);
  const shaped = automaticView?.markdown ?? weatherMarkdown(content);
  const { text: displayContent, pending } = useMemo(
    () => (mapped ? { text: shaped, pending: null } : live ? prepareLive(shaped) : { text: normalizeMath(shaped), pending: null }),
    [mapped, live, shaped],
  );
  const value = useMemo(
    () => ({
      sources,
      byKey: new Map(sources.map((source) => [source.id, source])),
      open: onOpen,
      onAnswer,
      presentation,
      content: displayContent,
      live,
      stateKey,
      requestText,
      interactive: !mapped && !wantsPlainReply(requestText),
      automatic: !mapped && presentation !== "minimal" && !live,
    }),
    [sources, onOpen, onAnswer, presentation, displayContent, live, stateKey, mapped, requestText],
  );
  const markdown = <Markdown remarkPlugins={mapped ? mappedRemarkPlugins : remarkPlugins} rehypePlugins={mapped ? mappedPlugins : rehypeMath} components={components} urlTransform={urlTransform}>{displayContent}</Markdown>;
  return (
    <BlockContext.Provider value={value}>
      <BlockBoundary content={content}>
        {weather && <Weather forecast={weather} />}
        {weather?.notes && <Markdown remarkPlugins={remarkPlugins} components={components} urlTransform={urlTransform}>{weather.notes}</Markdown>}
        {automaticView?.block && <RichUI source={JSON.stringify(automaticView.block)} enabled stateKey={stateKey} onAnswer={onAnswer} />}
        {automaticView?.language === 'metrics' && <Metrics source={automaticView.source} settled />}
        {automaticView?.language === 'timeline' && <Timeline source={automaticView.source} settled />}
        {automaticView?.explorer && <NumberExplorer columns={automaticView.explorer.columns} rows={automaticView.explorer.rows} initialFactor={automaticView.explorer.factor} />}
        {weather ? <details className="weather-details"><summary>Forecast details and sources</summary>{markdown}</details> : markdown}
        {audio.map(item => <AudioCard key={item.src} {...item} />)}
        {pending && <p className="math-pending" role="status">{pending === "math" ? "Typesetting…" : "Building the table…"}</p>}
      </BlockBoundary>
    </BlockContext.Provider>
  );
}
