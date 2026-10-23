import React, { useMemo, useState } from "react";
import { ArrowRight, MagnifyingGlass, Trash, X } from "@phosphor-icons/react";
import { collectWork, currentContent, searchWork, withoutCode } from "../lib/library.js";
import { timeLabel } from "../lib/format.js";
import "./saved-work.css";
import { FileBadge, EmptyState, Segmented } from "./EverydayUI.jsx";

/* Everything Vaelo has made that is worth keeping, from every conversation,
   each with a way back to the reply it came from. A list on the left, what
   the chosen one holds on the right. */

const KINDS = [
  ["all", "All"],
  ["document", "Documents"],
  ["table", "Tables"],
  ["code", "Code"],
];
const KIND_NAME = { document: "Document", table: "Table", code: "Code" };

const first = (text, max) => {
  const clean = withoutCode(String(text))
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, ' ')
    .replace(/[#>*_`|[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : clean;
};

function Preview({ entry, chats, onOpen, onReply, onDelete }) {
  const chat = chats.find((item) => item.id === entry.chatId);
  const message = chat?.messages.find((item) => item.id === entry.item.messageId);
  const work = chat?.works?.[entry.item.messageId];
  const versions = work?.versions || [];
  let body = "";
  if (entry.kind === "document") body = first(currentContent(work, message?.content || ""), 320);
  if (entry.kind === "table") {
    const { columns = [], rows = [] } = entry.item;
    body = `${rows.length} rows across ${columns.filter(Boolean).join(", ")}.`;
  }
  if (entry.kind === "code") body = entry.item.source.split("\n").slice(0, 6).join("\n");
  return (
    <aside className="saved-preview" aria-label="Preview" key={entry.id}>
      <div className="saved-preview-head">
        <span className="saved-kind">
          {KIND_NAME[entry.kind]} · {entry.chatTitle}
        </span>
        <h2>{entry.title}</h2>
        {entry.kind === "code" ? <pre className="saved-code">{body}</pre> : <p>{body}</p>}
      </div>
      {versions.length > 0 && (
        <div className="saved-versions">
          <span className="saved-kind">Versions</span>
          <ol>
            {[...versions].reverse().map((version, index) => {
              const at = versions.length - 1 - index;
              return (
                <li key={at} data-current={at === work.current || undefined}>
                  <span className="saved-dot" aria-hidden="true" />
                  <span className="saved-version-text">
                    <span>{version.by === "vaelo" && at === 0 ? "Original, as Vaelo wrote it" : version.note || "Edited"}</span>
                    <small>{version.by === "vaelo" && at === 0 ? "Always kept" : version.by === "you" ? "By you" : "Revised with Vaelo"}</small>
                  </span>
                  <small>{timeLabel(version.at)}</small>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <div className="saved-actions">
        <button className="saved-primary" onClick={() => onOpen(entry)}>
          Open in workspace
        </button>
        <button className="saved-secondary" onClick={() => onReply(entry)}>
          Back to its reply
        </button>
        <button className="saved-quiet" onClick={() => onDelete(entry)} aria-label={`Delete ${entry.title} from saved work`} data-tip="Delete from saved work">
          <Trash size={18} />
        </button>
      </div>
    </aside>
  );
}

export function SavedWork({ chats, onOpen, onReply, onDelete, onClose }) {
  const all = useMemo(() => collectWork(chats), [chats]);
  const [kind, setKind] = useState("all");
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [picked, setPicked] = useState(null);

  const projects = useMemo(
    () => [...new Set(chats.map((chat) => chat.workContext?.title).filter(Boolean))].slice(0, 6),
    [chats],
  );
  const inProject = (entry) => !project || chats.find((chat) => chat.id === entry.chatId)?.workContext?.title === project;
  const counts = Object.fromEntries(KINDS.map(([id]) => [id, all.filter((entry) => (id === "all" || entry.kind === id) && inProject(entry)).length]));
  const shown = searchWork(all, query).filter((entry) => (kind === "all" || entry.kind === kind) && inProject(entry));
  const current = shown.find((entry) => entry.id === picked) || shown[0];

  return (
    <section className="saved" aria-labelledby="saved-title">
      <header className="saved-head">
        <div>
          <h1 id="saved-title">Saved work</h1>
          <p>Long replies, code and tables from every conversation, each with a way back to where it was said.</p>
        </div>
        <label className="saved-search">
          <MagnifyingGlass size={19} aria-hidden="true" />
          <span className="sr-only">Search saved work</span>
          <input type="search" value={query} placeholder="Search saved work" onChange={(event) => setQuery(event.target.value)} />
        </label>
        {onClose && (
          <button className="icon-button saved-close" aria-label="Close saved work" onClick={onClose}>
            <X size={20} />
          </button>
        )}
      </header>

      <div className="saved-bar">
        <Segmented label="Kind of saved work" value={kind} options={KINDS.map(([id, label]) => [id, `${label} (${counts[id]})`])} onChange={setKind} />
        {projects.length > 0 && (
          <div className="saved-projects" role="group" aria-label="Project">
            {projects.map((title) => (
              <button key={title} aria-pressed={project === title} onClick={() => setProject(project === title ? "" : title)}>
                {title}
                {project === title && <X size={13} aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {shown.length ? (
        <div className="saved-body">
          <ol className="saved-list">
            {shown.map((entry) => (
              <li key={entry.id}>
                <button className="saved-row" aria-current={entry.id === current?.id || undefined} onClick={() => setPicked(entry.id)}>
                  <FileBadge name={entry.kind === "code" ? `snippet.${entry.item.language || "txt"}` : entry.kind === "table" ? "table.csv" : "document.md"} kind={entry.kind} />
                  <span className="saved-row-text">
                    <span className="saved-row-title">{entry.title}</span>
                    <span className="saved-row-from">
                      From “{entry.chatTitle}”{entry.edited ? " · edited" : ""}
                    </span>
                  </span>
                  <span className="saved-when">{timeLabel(entry.updated)}</span>
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
          {current && <Preview entry={current} chats={chats} onOpen={onOpen} onReply={onReply} onDelete={onDelete} />}
        </div>
      ) : (
        <EmptyState title={all.length ? 'No matching work' : 'Your work has a home here'} action={all.length ? 'Clear filters' : 'Back to conversation'} onAction={all.length ? () => { setQuery(''); setKind('all'); setProject(''); } : onClose}>
          {all.length ? 'Try a shorter search or another kind of output.' : 'Documents, code and tables gather here automatically. Open any item to read, export or return to its conversation.'}
        </EmptyState>
      )}
    </section>
  );
}
