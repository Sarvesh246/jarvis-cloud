import { TableScroll } from "./blocks/TableScroll.jsx";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowSquareOut,
  Check,
  Copy,
  DownloadSimple,
  MagnifyingGlass,
  Printer,
  ShieldCheck,
  X,
} from "@phosphor-icons/react";
import { Rendered, download, looksLikeSvg, useCopy, useSources } from "./blocks/Blocks.jsx";
import { SourceIcon } from "./blocks/SourceIcon.jsx";
import { Highlighted } from "./blocks/Highlighted.jsx";
import { SOURCE_KINDS, kindLabel } from "../lib/sources.js";
import { isNumericColumn, isSectionRow, tableView, toCSV, toTSV } from "../lib/table.js";
import { currentContent, docTitle } from "../lib/library.js";
import { DocumentWork } from "./DocumentWork.jsx";
import { requestForReply } from "../lib/adaptive-ui.js";
import "./workspace.css";

/* The workspace opens beside the conversation only when something deserves
   sustained attention: a preview, a long piece of code, a reply to read as a
   document, the sources behind an answer. On narrow screens it becomes a
   sheet over the conversation. */

const WIDTH_KEY = "vaelo-workspace-width";
const MIN = 320;
const MAX = 900;

function readWidth() {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    return value >= MIN && value <= MAX ? value : 520;
  } catch {
    return 520;
  }
}

function previewDoc(language, source) {
  const body = looksLikeSvg(language, source)
    ? `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#fff">${source}</body>`
    : source;
  return /<html[\s>]/i.test(body) ? body : `<!doctype html><meta charset="utf-8">${body}`;
}

function CodeView({ item }) {
  const canPreview = item.language === "html" || looksLikeSvg(item.language, item.source);
  const [tab, setTab] = useState(canPreview ? item.tab || "preview" : "code");
  return (
    <>
      {canPreview && (
        <div className="ws-tabs" role="tablist" aria-label="View">
          {["preview", "code"].map((name) => (
            <button
              key={name}
              role="tab"
              aria-selected={tab === name}
              className="ws-tab"
              onClick={() => setTab(name)}
            >
              {name === "preview" ? "Preview" : "Code"}
            </button>
          ))}
        </div>
      )}
      {tab === "preview" && canPreview ? (
        <div className="ws-preview">
          {/* No allow-scripts: previews are rendered markup only, isolated
              from this page and its session. It takes no focus, so
              keyboard focus can never get stranded inside it. */}
          <iframe
            title="Preview"
            tabIndex={-1}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={previewDoc(item.language, item.source)}
          />
          <p className="ws-note">Scripts don’t run in previews. Download the file to run it.</p>
        </div>
      ) : (
        <pre className="ws-code" tabIndex={0}>
          <Highlighted source={item.source} language={item.language} />
        </pre>
      )}
    </>
  );
}

function SourcesView({ message, focus }) {
  const sources = useSources(message?.content);
  const [filter, setFilter] = useState("all");
  const list = useRef(null);
  const kinds = SOURCE_KINDS.filter((kind) => sources.some((s) => s.kind === kind.kind));
  const shown = filter === "all" ? sources : sources.filter((s) => s.kind === filter);

  useEffect(() => {
    if (!focus) return;
    const el = list.current?.querySelector(`[data-id="${CSS.escape(focus)}"]`);
    el?.scrollIntoView({ block: "center" });
    el?.querySelector("a")?.focus({ preventScroll: true });
  }, [focus]);

  if (!sources.length) return <p className="ws-empty">This reply didn’t link any sources.</p>;
  return (
    <>
      {kinds.length > 1 && (
        <div className="ws-filters" role="radiogroup" aria-label="Filter sources">
          {[{ kind: "all", label: "All" }, ...kinds].map((kind) => (
            <button
              key={kind.kind}
              role="radio"
              aria-checked={filter === kind.kind}
              className="chip"
              data-on={filter === kind.kind || undefined}
              onClick={() => setFilter(kind.kind)}
            >
              {kind.label}
              <span className="chip-count">
                {kind.kind === "all"
                  ? sources.length
                  : sources.filter((s) => s.kind === kind.kind).length}
              </span>
            </button>
          ))}
        </div>
      )}
      <ol className="ws-sources" ref={list}>
        {shown.map((source) => (
          <li key={source.id} data-id={source.id} data-focus={source.id === focus || undefined}>
            <span className="ws-source-index">{source.index}</span>
            <div>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.title || source.domain}
                <ArrowSquareOut size={13} aria-hidden="true" />
              </a>
              <span className="ws-source-meta">
                <SourceIcon kind={source.kind} size={13} />
                {source.domain} · {kindLabel(source.kind)}
              </span>
              {source.context && <p className="ws-source-context">“{source.context}”</p>}
            </div>
          </li>
        ))}
      </ol>
      <p className="ws-note">
        Sources can be incomplete, out of date or wrong. Open the ones that matter and check
        them.
      </p>
    </>
  );
}

/* A table given room: every row, a filter across all columns, and sorting.
   Inline it stays light; here it is a working grid. */
function TableView({ item }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ column: null, direction: "asc" });
  const numeric = useMemo(
    () => item.columns.map((_, i) => isNumericColumn(item.rows, i)),
    [item],
  );
  const displayed = useMemo(() => tableView(item.rows, { query, ...sort }), [item, query, sort]);
  const shown = displayed.rows;

  function toggle(column) {
    const first = numeric[column] ? "desc" : "asc";
    setSort((current) => {
      if (current.column !== column) return { column, direction: first };
      if (current.direction === first) return { column, direction: first === "asc" ? "desc" : "asc" };
      return { column: null, direction: "asc" };
    });
  }

  return (
    <>
      <label className="ws-filter">
        <MagnifyingGlass size={16} aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder="Filter rows"
          aria-label="Filter rows"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.stopPropagation();
              setQuery("");
            }
          }}
        />
        <span className="ws-filter-count" aria-live="polite">
          {query ? `${displayed.count} of ${displayed.total}` : `${displayed.total} rows`}
        </span>
      </label>
      <TableScroll className="ws-grid table-block" wrapClassName="ws-grid-wrap" label="Table">
        <table style={{ "--table-min-width": `${Math.min(38, item.columns.length * 7)}rem` }}>
          <thead>
            <tr>
              {item.columns.map((column, i) => (
                <th
                  key={i}
                  scope="col"
                  data-numeric={numeric[i] || undefined}
                  aria-sort={
                    sort.column === i ? (sort.direction === "asc" ? "ascending" : "descending") : undefined
                  }
                >
                  <button onClick={() => toggle(i)} data-tip="Sort by this column">
                    {column}
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
            {shown.map((row, r) => isSectionRow(row) ? (
              <tr key={r} className="table-section"><th scope="rowgroup" colSpan={item.columns.length}>{row[0]}</th></tr>
            ) : (
              <tr key={r}>
                {row.map((cell, i) => (
                  <td key={i} data-numeric={numeric[i] || undefined}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="ws-empty">No rows match “{query.trim()}”.</p>}
      </TableScroll>
    </>
  );
}

export function Workspace({
  item,
  messages,
  works,
  canRevise,
  onClose,
  onOpen,
  onWorkChange,
  onReveal,
  onRevise,
  onVerifyDocument,
}) {
  const [width, setWidth] = useState(readWidth);
  const [done, copy] = useCopy();
  const panel = useRef(null);
  const heading = useRef(null);
  const message = useMemo(
    () => (item?.messageId ? messages.find((m) => m.id === item.messageId) : null),
    [item?.messageId, messages],
  );
  const work = item?.kind === "document" ? works?.[item.messageId] : undefined;
  const documentText = currentContent(work, message?.content ?? "");

  /* Focus moves in when the panel opens and back to whatever opened it when
     it closes. As an overlay, Tab stays inside it. */
  useEffect(() => {
    if (!item) return;
    const opener = document.activeElement;
    heading.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [item?.kind, item?.messageId, item?.source]);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
    } catch {
      /* a remembered width is a nicety */
    }
  }, [width]);

  if (!item) return null;

  function trap(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !matchMedia("(max-width: 74.9375rem)").matches) return;
    const items = panel.current.querySelectorAll(
      'button:not(:disabled), a[href], [tabindex="0"]',
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function startResize(event) {
    event.preventDefault();
    const startX = event.clientX;
    const startW = width;
    const move = (e) => setWidth(Math.min(MAX, Math.max(MIN, startW + startX - e.clientX)));
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up, { once: true });
  }

  const titles = {
    code: item.title || "Code",
    sources: "Sources",
    document: docTitle(documentText, "Document"),
    table: item.title || "Table",
  };
  const kinds = { code: "Workspace", sources: "Provenance", document: "Document", table: "Data" };
  const text =
    item.kind === "code"
      ? item.source
      : item.kind === "table"
        ? toTSV(item.columns, item.rows)
        : item.kind === "document"
          ? documentText
          : message?.content || "";
  function save() {
    if (item.kind === "table") return download("vaelo-table.csv", toCSV(item.columns, item.rows), "text/csv");
    if (item.kind === "document") return download("vaelo-reply.md", text, "text/markdown");
    const ext = item.language === "svg" ? "svg" : item.language === "html" ? "html" : "txt";
    download(`vaelo-snippet.${ext}`, text);
  }

  return (
    <aside
      ref={panel}
      className="workspace"
      style={{ "--ws-w": `${width}px` }}
      aria-labelledby="ws-title"
      onKeyDown={trap}
    >
      <div
        className="ws-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize workspace"
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(event) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) event.preventDefault();
          if (event.key === "Home") setWidth(MIN);
          if (event.key === "End") setWidth(MAX);
          if (event.key === "ArrowLeft") setWidth((w) => Math.min(MAX, w + 32));
          if (event.key === "ArrowRight") setWidth((w) => Math.max(MIN, w - 32));
        }}
      />
      <header className="ws-head">
        <div className="ws-title-group">
          <span className="label">{kinds[item.kind]}</span>
          <h2 id="ws-title" ref={heading} tabIndex={-1}>
            {titles[item.kind]}
          </h2>
        </div>
        <div className="ws-actions">
          {item.kind === "document" && onVerifyDocument && (
            <button className="block-tool" onClick={() => onVerifyDocument(item.messageId, titles.document)}>
              <ShieldCheck size={16} /><span>Verify</span>
            </button>
          )}
          {item.kind !== "sources" && (
            <>
              <button className="block-tool" onClick={() => copy(text)}>
                {done ? <Check size={15} /> : <Copy size={15} />}
                <span>{done ? "Copied" : "Copy"}</span>
              </button>
              <button
                className="block-tool icon-only"
                data-tip={item.kind === "table" ? "Download as CSV" : "Download"}
                aria-label={item.kind === "table" ? "Download as CSV" : "Download"}
                onClick={save}
              >
                <DownloadSimple size={16} />
              </button>
            </>
          )}
          {item.kind === "document" && (
            <button
              className="block-tool icon-only"
              data-tip="Print or save as PDF"
              aria-label="Print or save as PDF"
              onClick={() => {
                document.documentElement.dataset.print = "workspace";
                print();
                delete document.documentElement.dataset.print;
              }}
            >
              <Printer size={16} />
            </button>
          )}
          <button className="icon-button" aria-label="Close workspace" data-tip="Close (Esc)" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
      </header>
      <div className="ws-body">
        {item.kind === "code" && <CodeView key={item.source} item={item} />}
        {item.kind === "sources" && <SourcesView message={message} focus={item.focus} />}
        {item.kind === "document" && (
          <DocumentWork
            key={item.messageId}
            message={message}
            requestText={requestForReply(messages, messages.indexOf(message))}
            work={work}
            canRevise={canRevise}
            onOpen={onOpen}
            onRevise={onRevise}
            onReveal={message ? () => onReveal(message.id) : undefined}
            onWorkChange={(next) => onWorkChange(item.messageId, next)}
          />
        )}
        {item.kind === "table" && <TableView key={`${item.messageId || ""}:${item.source || JSON.stringify([item.columns, item.rows])}`} item={item} />}
      </div>
    </aside>
  );
}
