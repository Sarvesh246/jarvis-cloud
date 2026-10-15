import React, { useMemo, useRef, useState } from "react";
import {
  Code,
  FileText,
  GearSix,
  MagnifyingGlass,
  Table,
  Plus,
  PushPin,
  PushPinSlash,
  SignOut,
  Trash,
  X,
} from "@phosphor-icons/react";
import { BrandWordmark } from "./Mark.jsx";
import { groupChats, searchChats } from "../lib/format.js";
import { collectWork, searchWork } from "../lib/library.js";
import "./rail.css";

const WORK_ICONS = { document: FileText, code: Code, table: Table };
const WORK_KINDS = { document: "Document", code: "Code", table: "Table" };

/* The things Vaelo has made, newest first, each a way back into the
   workspace and the conversation it came from. */
function Library({ items, query, activeId, onOpen }) {
  const shown = searchWork(items, query).slice(0, 80);
  if (!items.length)
    return (
      <p className="rail-empty">
        Documents, longer code and tables Vaelo makes will gather here, so the final version is
        never lost in a conversation.
      </p>
    );
  return (
    <section>
      <h2 className="label" aria-live="polite">
        {query.trim()
          ? shown.length
            ? `${shown.length} ${shown.length === 1 ? "match" : "matches"}`
            : "Nothing matches"
          : "Made with Vaelo"}
      </h2>
      <ul className="work-list">
        {shown.map((entry) => {
          const Icon = WORK_ICONS[entry.kind];
          return (
            <li key={entry.id}>
              <button
                className="work-row"
                data-active={entry.chatId === activeId || undefined}
                onClick={() => onOpen(entry)}
              >
                <Icon size={17} aria-hidden="true" className="work-icon" />
                <span className="work-text">
                  <span className="work-title">{entry.title}</span>
                  <span className="work-meta">
                    {WORK_KINDS[entry.kind]}
                    {entry.edited && " · edited"} · {entry.chatTitle}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* On a touch screen a row slides left to show its actions, the way a
   letter is slid aside to read the one beneath. Only one row is open at a
   time; tapping the row again, or opening another, closes it. Removing
   still offers Undo. The inline buttons stay for keyboards and screen
   readers. */
const ACTIONS = 104;

function useSwipe(id, openId, setOpenId) {
  const [x, setX] = useState(null);
  const gesture = useRef(null);
  const open = openId === id;
  const rest = open ? -ACTIONS : 0;

  const handlers = {
    onTouchStart(event) {
      if (matchMedia("(hover: hover)").matches || event.touches.length > 1) return;
      const t = event.touches[0];
      gesture.current = { x: t.clientX, y: t.clientY, from: rest, at: performance.now(), lock: null };
    },
    onTouchMove(event) {
      const g = gesture.current;
      if (!g) return;
      const t = event.touches[0];
      const dx = t.clientX - g.x;
      const dy = t.clientY - g.y;
      if (!g.lock) {
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
          gesture.current = null;
          return;
        }
        if (Math.abs(dx) > 8) g.lock = "x";
        else return;
      }
      /* Claimed: the drawer itself must not read this as a swipe to close */
      event.stopPropagation();
      let next = g.from + dx;
      if (next > 0) next = 0;
      if (next < -ACTIONS) next = -ACTIONS - (-ACTIONS - next) * 0.25;
      g.last = { x: next, at: performance.now(), dx };
      setX(next);
    },
    onTouchEnd(event) {
      const g = gesture.current;
      gesture.current = null;
      if (!g?.lock) return;
      event.stopPropagation();
      const travelled = g.last?.x ?? g.from;
      const speed = (g.last?.dx ?? 0) / Math.max(1, (g.last?.at ?? g.at) - g.at);
      const opening = speed < -0.4 || (speed < 0.4 && travelled < -ACTIONS / 2);
      setOpenId(opening ? id : open ? null : openId);
      setX(null);
    },
  };
  return { open, x: x ?? rest, dragging: x !== null, handlers };
}

function Row({ chat, active, busy, excerpt, openId, setOpenId, onSelect, onDelete, onPin }) {
  const swipe = useSwipe(chat.id, openId, setOpenId);
  const settle = () => setOpenId(null);
  return (
    <div
      className="rail-row"
      data-active={active}
      data-excerpt={excerpt ? true : undefined}
      data-swiped={swipe.open || undefined}
      {...swipe.handlers}
    >
      <div className="rail-swipe" aria-hidden={!swipe.open} inert={!swipe.open}>
        <button
          className="rail-swipe-act"
          onClick={() => {
            onPin(chat.id);
            settle();
          }}
        >
          {chat.pinned ? <PushPinSlash size={18} /> : <PushPin size={18} />}
          <span>{chat.pinned ? "Unpin" : "Pin"}</span>
        </button>
        <button
          className="rail-swipe-act rail-swipe-remove"
          disabled={busy}
          onClick={() => {
            settle();
            onDelete(chat.id);
          }}
        >
          <Trash size={18} />
          <span>Remove</span>
        </button>
      </div>
      <div
        className="rail-face"
        data-dragging={swipe.dragging || undefined}
        style={{ "--swipe": `${swipe.x}px` }}
        onClickCapture={(event) => {
          if (!swipe.open) return;
          event.preventDefault();
          event.stopPropagation();
          settle();
        }}
      >
        <button
          className="rail-link"
          disabled={busy}
          aria-current={active ? "page" : undefined}
          onClick={() => onSelect(chat.id)}
        >
          <span className="rail-title">{chat.title}</span>
          {excerpt && <span className="rail-excerpt">{excerpt}</span>}
        </button>
        <button
          className="rail-act"
          aria-label={chat.pinned ? `Unpin ${chat.title}` : `Pin ${chat.title}`}
          data-tip={chat.pinned ? "Unpin" : "Pin"}
          data-on={chat.pinned || undefined}
          onClick={() => onPin(chat.id)}
        >
          {chat.pinned ? <PushPinSlash size={16} /> : <PushPin size={16} />}
        </button>
        <button
          className="rail-act rail-delete"
          aria-label={`Remove ${chat.title}`}
          data-tip="Remove"
          disabled={busy}
          onClick={() => onDelete(chat.id)}
        >
          <Trash size={16} />
        </button>
      </div>
    </div>
  );
}

export function Rail({
  chats,
  activeId,
  busy,
  open,
  collapsed,
  user,
  onClose,
  onNew,
  onSelect,
  onDelete,
  onPin,
  onSettings,
  onSignOut,
  onOpenWork,
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState("chats");
  const [openRow, setOpenRow] = useState(null);
  const field = useRef(null);
  const work = useMemo(() => collectWork(chats), [chats]);
  const results = searchChats(
    chats.filter((chat) => chat.messages.length),
    query,
  );
  const groups = groupChats(chats);
  const pristine = chats.length === 1 && !chats[0].messages.length;

  return (
    <aside
      className="rail"
      data-open={open}
      data-collapsed={collapsed}
      aria-label="Conversations"
    >
      <div className="rail-head">
        <span className="rail-brand">
          <BrandWordmark size={32} />
        </span>
        <button
          className="icon-button rail-close"
          aria-label="Close conversations"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>

      <button className="rail-new" onClick={onNew} disabled={busy || pristine}>
        <Plus size={16} />
        <span>New conversation</span>
        <kbd>Ctrl K</kbd>
      </button>

      <label className="rail-search">
        <MagnifyingGlass size={16} aria-hidden="true" />
        <input
          ref={field}
          type="search"
          value={query}
          placeholder={view === "library" ? "Search the library" : "Search conversations"}
          aria-label={view === "library" ? "Search the library" : "Search conversations"}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.stopPropagation();
              setQuery("");
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="rail-search-clear"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              field.current?.focus();
            }}
          >
            <X size={14} />
          </button>
        )}
      </label>

      <div className="rail-views" role="tablist" aria-label="Show">
        {[
          ["chats", "Conversations"],
          ["library", "Library"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            id={`rail-tab-${id}`}
            aria-selected={view === id}
            aria-controls="rail-panel"
            className="rail-view"
            onClick={() => setView(id)}
          >
            {label}
            {id === "library" && work.length > 0 && <span className="chip-count">{work.length}</span>}
          </button>
        ))}
      </div>

      <nav
        className="rail-list"
        id="rail-panel"
        role="tabpanel"
        aria-labelledby={`rail-tab-${view}`}
        aria-label={view === "library" ? "Library" : results ? "Search results" : "Past conversations"}
      >
        {view === "library" ? (
          <Library items={work} query={query} activeId={activeId} onOpen={onOpenWork} />
        ) : results ? (
          <section>
            <h2 className="label" aria-live="polite">
              {results.length
                ? `${results.length} ${results.length === 1 ? "match" : "matches"}`
                : "Nothing matches"}
            </h2>
            {results.map(({ chat, excerpt }) => (
              <Row
                key={chat.id}
                chat={chat}
                excerpt={excerpt}
                active={chat.id === activeId}
                busy={busy}
                onSelect={(id) => {
                  setQuery("");
                  onSelect(id);
                }}
                openId={openRow}
                setOpenId={setOpenRow}
                onDelete={onDelete}
                onPin={onPin}
              />
            ))}
          </section>
        ) : (
          groups.map((group) => (
            <section key={group.label}>
              <h2 className="label">{group.label}</h2>
              {group.items.map((chat) => (
                <Row
                  key={chat.id}
                  chat={chat}
                  active={chat.id === activeId}
                  busy={busy}
                  onSelect={onSelect}
                  openId={openRow}
                  setOpenId={setOpenRow}
                  onDelete={onDelete}
                  onPin={onPin}
                />
              ))}
            </section>
          ))
        )}
      </nav>

      <div className="rail-foot">
        <p className="rail-note">Kept privately on this device.</p>
        <div className="rail-account">
          <span className="rail-avatar" aria-hidden="true">
            {user.name?.[0]}
          </span>
          <span className="rail-name">{user.name}</span>
          <button
            className="icon-button"
            aria-label="Settings"
            data-tip="Settings"
            aria-haspopup="dialog"
            onClick={onSettings}
          >
            <GearSix size={19} />
          </button>
          <button
            className="icon-button"
            aria-label="Sign out"
            data-tip="Sign out"
            disabled={busy}
            onClick={onSignOut}
          >
            <SignOut size={19} />
          </button>
        </div>
      </div>
    </aside>
  );
}
