import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Code,
  FileText,
  MagnifyingGlass,
  NotePencil,
  Plus,
  PushPin,
  PushPinSlash,
  Table,
  Trash,
} from "@phosphor-icons/react";
import { BrandWordmark } from "./Mark.jsx";
import { workspaceIcon } from "./workspace-icons.js";
import { AUDIENCES, CUSTOM_WORKSPACE, WORKSPACES } from "../../shared/workspaces.js";
import { groupChats, previewOf, searchChats, timeLabel } from "../lib/format.js";
import { collectWork, searchWork } from "../lib/library.js";
import { usePinnedReorder } from "../lib/use-pinned-reorder.js";
import { dragProps } from "../lib/gesture.js";
import { buzz } from "../lib/haptics.js";
import "./rail-phone.css";

const WORK_ICONS = { document: FileText, code: Code, table: Table };
const WORK_KINDS = { document: "Document", code: "Code", table: "Table" };
const WORK_FILTERS = [
  ["all", "All"],
  ["document", "Documents"],
  ["code", "Code"],
  ["table", "Tables"],
];

const ACTION = 70;
const OVERSHOOT = 30;
const OPEN_AT = 60;

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

/* A row that slides left under a finger to show its actions. It follows the
   finger, clamped; past 60px it snaps open to the width of its actions, and
   anything less springs back. Only one row is open at a time. */
function SwipeRow({ id, openId, setOpenId, actions, active, className = "", children, onActivate }) {
  const [x, setX] = useState(null);
  const width = ACTION * actions.length;
  const open = openId === id;
  const rest = open ? -width : 0;
  const restRef = useRef(rest);
  restRef.current = rest;
  const moved = useRef(false);

  const handlers = dragProps({
    axis: "x",
    start: () => {
      moved.current = false;
    },
    move: (dx) => {
      moved.current = true;
      setX(clamp(restRef.current + dx, -(width + OVERSHOOT), 0));
    },
    end: (dx) => {
      const next = clamp(restRef.current + dx, -(width + OVERSHOOT), 0);
      const opening = next < -OPEN_AT;
      if (opening && restRef.current === 0) buzz();
      setOpenId(opening ? id : open ? null : openId);
      setX(null);
      setTimeout(() => (moved.current = false), 300);
    },
    cancel: () => setX(null),
  });

  return (
    <div className={`rp-row ${className}`} data-active={active || undefined} data-swiped={open || undefined} {...handlers}>
      <div className="rp-actions" style={{ width }} aria-hidden={!open} inert={!open}>
        {actions.map(({ key, label, Icon, tone, onClick, disabled }) => (
          <button
            key={key}
            className="rp-action"
            data-tone={tone}
            disabled={disabled}
            onClick={() => {
              setOpenId(null);
              onClick();
            }}
          >
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div
        className="rp-face"
        data-dragging={x !== null || undefined}
        style={{ transform: `translateX(${x ?? rest}px)` }}
        onClickCapture={(event) => {
          /* A tap on an open row closes it; a drag is not a tap */
          if (moved.current || open) {
            event.preventDefault();
            event.stopPropagation();
            if (open) setOpenId(null);
          }
        }}
      >
        <span className="rp-dot" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

function ChatRow({ chat, active, busy, running, excerpt, openId, setOpenId, onSelect, onDelete, onPin }) {
  const preview = excerpt || previewOf(chat);
  return (
    <SwipeRow
      id={chat.id}
      openId={openId}
      setOpenId={setOpenId}
      active={active}
      actions={[
        { key: "pin", label: chat.pinned ? "Unpin" : "Pin", Icon: chat.pinned ? PushPinSlash : PushPin, onClick: () => onPin(chat.id) },
        { key: "remove", label: "Remove", Icon: Trash, tone: "clay", disabled: busy, onClick: () => onDelete(chat.id) },
      ]}
    >
      <button
        className="rail-link rp-link"
        data-running={running || undefined}
        aria-current={active ? "page" : undefined}
        onClick={() => onSelect(chat.id)}
      >
        <span className="rp-line">
          <span className="rp-title">{chat.title}</span>
          {running && <span className="rail-running" role="img" aria-label="Vaelo is replying here" />}
          <span className="rp-time">{timeLabel(chat.updated)}</span>
        </span>
        {preview && <span className="rp-excerpt">{preview}</span>}
      </button>
    </SwipeRow>
  );
}

function Library({ items, query, filter, setFilter, activeId, openId, setOpenId, onOpen, onDelete }) {
  const shown = searchWork(items, query)
    .filter((entry) => filter === "all" || entry.kind === filter)
    .slice(0, 80);
  if (!items.length)
    return (
      <p className="rp-empty">
        Documents, longer code and tables Vaelo makes will gather here, so the final version is never lost in a
        conversation.
      </p>
    );
  return (
    <>
      <div className="rp-chips" role="group" aria-label="Show">
        {WORK_FILTERS.map(([id, label]) => (
          <button key={id} className="rp-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      <p className="label rp-count" aria-live="polite">
        {query.trim() ? (shown.length ? `${shown.length} ${shown.length === 1 ? "match" : "matches"}` : "Nothing matches") : ""}
      </p>
      <ul className="rp-list">
        {shown.map((entry) => {
          const Icon = WORK_ICONS[entry.kind];
          return (
            <li key={entry.id}>
              <SwipeRow
                id={entry.id}
                openId={openId}
                setOpenId={setOpenId}
                className="rp-work"
                actions={[{ key: "delete", label: "Remove", Icon: Trash, tone: "clay", onClick: () => onDelete(entry) }]}
              >
                <button
                  className="rp-work-link"
                  data-active={entry.chatId === activeId || undefined}
                  onClick={() => onOpen(entry)}
                >
                  <span className="rp-thumb" aria-hidden="true">
                    <Icon size={22} />
                  </span>
                  <span className="rp-work-text">
                    <span className="rp-work-title">{entry.title}</span>
                    <span className="rp-work-meta">
                      {WORK_KINDS[entry.kind]}
                      {entry.edited && " · edited"} · from <em>{entry.chatTitle}</em>
                    </span>
                  </span>
                  <span className="rp-time">{timeLabel(entry.updated)}</span>
                </button>
              </SwipeRow>
            </li>
          );
        })}
      </ul>
      <p className="rp-hint">Long replies, code and tables from every conversation. Each opens with a way back to its reply.</p>
    </>
  );
}

/* The categories people reach for first sit in two rows; the rest are one
   tap away, so the chips never take over the pane. */
const FEATURED = ["money", "home", "career", "code", "travel"];

function Workroom({ audience, setAudience, onTask, onWorkroom }) {
  const [more, setMore] = useState(false);
  const shown = WORKSPACES.filter((item) => audience === "all" || item.audience === audience);
  const chips = [{ id: "all", label: "All" }, ...AUDIENCES].filter(
    (item) => more || item.id === "all" || FEATURED.includes(item.id) || item.id === audience,
  );
  return (
    <>
      <p className="rp-intro">
        Ready-made workspaces. Drop your documents in once and every conversation started here carries them.
      </p>
      <div className="rp-chips" role="group" aria-label="Show workspaces for">
        {chips.map((item) => (
          <button key={item.id} className="rp-chip" aria-pressed={audience === item.id} onClick={() => setAudience(item.id)}>
            {item.label}
          </button>
        ))}
        <button className="rp-chip rp-chip-more" aria-expanded={more} onClick={() => setMore((value) => !value)}>
          {more ? "Fewer" : "More"}
        </button>
      </div>
      <div className="rp-tiles">
        {shown.map((item) => {
          const Icon = workspaceIcon(item);
          return (
            <button key={item.id} className="rp-tile" onClick={() => onTask(item)}>
              <Icon size={26} className="rp-tile-icon" aria-hidden="true" />
              <span className="rp-tile-title">{item.title}</span>
              <span className="rp-tile-note">{item.summary}</span>
              {item.check && <span className="rp-tile-check">Includes a check</span>}
            </button>
          );
        })}
        <button className="rp-tile rp-tile-new" onClick={() => onTask({ id: CUSTOM_WORKSPACE })}>
          <Plus size={24} aria-hidden="true" />
          <span>Create a reusable task</span>
        </button>
      </div>
      <button className="rp-saved" onClick={onWorkroom}>
        Open saved work
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </>
  );
}

/* The conversations drawer on a phone. It sits under the chat, which slides
   aside to leave a strip of itself showing (see shell.css). */
export function PhoneRail({
  chats,
  activeId,
  busy,
  running = {},
  open,
  user,
  onNew,
  onSelect,
  onDelete,
  onPin,
  onSettings,
  onOpenWork,
  onDeleteWork,
  onWorkroom,
  onTask,
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState("chats");
  const [searchOpen, setSearchOpen] = useState(false);
  const [pull, setPull] = useState(0);
  const [openRow, setOpenRow] = useState(null);
  const [filter, setFilter] = useState("all");
  const [audience, setAudience] = useState("all");
  const aside = useRef(null);
  const pane = useRef(null);
  const field = useRef(null);
  const tab = useRef(null);
  const work = useMemo(() => collectWork(chats), [chats]);
  const guest = !!user.guest;
  const pristine = chats.length === 1 && !chats[0].messages.length;

  /* Pinned conversations keep the order they were arranged in; holding one
     still lets it be dragged elsewhere. */
  const orderKey = `vaelo-pin-order:${user?.sub || "guest"}`;
  const [pinOrder, setPinOrder] = useState([]);
  useEffect(() => {
    try {
      const ids = JSON.parse(localStorage.getItem(orderKey) || "[]");
      setPinOrder(Array.isArray(ids) ? ids.filter((x) => typeof x === "string").slice(0, 500) : []);
    } catch {
      setPinOrder([]);
    }
  }, [orderKey]);
  const week = Date.now() - 6 * 86_400_000;
  const groups = groupChats(chats)
    .flatMap((group) => {
      if (group.label === "Pinned")
        return [{ ...group, items: [...group.items].sort((a, b) => (pinOrder.indexOf(a.id) < 0 ? 1e4 : pinOrder.indexOf(a.id)) - (pinOrder.indexOf(b.id) < 0 ? 1e4 : pinOrder.indexOf(b.id))) }];
      if (group.label !== "Earlier") return [group];
      const recent = group.items.filter((chat) => (chat.updated || 0) >= week);
      const older = group.items.filter((chat) => (chat.updated || 0) < week);
      return [
        recent.length && { label: "Earlier this week", items: recent },
        older.length && { label: "Earlier", items: older },
      ].filter(Boolean);
    });
  const pinned = groups.find((g) => g.label === "Pinned")?.items.map((c) => c.id) || [];
  function saveOrder(ids) {
    setPinOrder(ids);
    try {
      localStorage.setItem(orderKey, JSON.stringify(ids));
    } catch {
      /* the arrangement still holds for this visit */
    }
  }
  const reorder = usePinnedReorder({ aside, ids: pinned, setOrder: setPinOrder, saveOrder, chats, owner: orderKey, disabled: !open || !!query || view !== "chats" });

  const results = searchChats(chats.filter((chat) => chat.messages.length), query);

  /* Closed, the drawer is out of the tab order; opened, focus moves into it */
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    if (open) tab.current?.focus({ preventScroll: true });
    else {
      const focus = document.activeElement;
      if (!focus || focus === document.body || aside.current?.contains(focus))
        document.querySelector(".header-rail-mobile")?.focus({ preventScroll: true });
    }
    if (!open) setOpenRow(null);
  }, [open]);

  useEffect(() => {
    if (searchOpen) field.current?.focus({ preventScroll: true });
  }, [searchOpen]);

  const searchable = view !== "work";
  function go(next) {
    if (next === view) return;
    buzz();
    setView(next);
    setQuery("");
    setSearchOpen(false);
    setOpenRow(null);
    if (pane.current) pane.current.scrollTop = 0;
  }
  const views = [
    ["chats", "Conversations"],
    ...[["library", "Library"]],
    ...(guest ? [] : [["work", "Workroom"]]),
  ];
  function tabKeys(event) {
    const at = views.findIndex(([id]) => id === view);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : (at + step + views.length) % views.length;
    go(views[next][0]);
    requestAnimationFrame(() => aside.current?.querySelector(`#rail-tab-${views[next][0]}`)?.focus());
  }

  /* Pulled down from the top of the list, the search field opens */
  const pulled = useRef(0);
  const pulling = dragProps({
    axis: "y",
    claim: (dx, dy) => view !== "work" && !searchOpen && (pane.current?.scrollTop ?? 1) <= 0 && dy > 0,
    move: (dx, dy) => {
      pulled.current = Math.min(dy * 0.5, 64);
      setPull(pulled.current);
    },
    end: () => {
      if (pulled.current > 40) setSearchOpen(true);
      pulled.current = 0;
      setPull(0);
    },
    cancel: () => {
      pulled.current = 0;
      setPull(0);
    },
  });

  const fieldHeight = searchOpen ? 54 : pull;
  const initial = (user.name || "?").trim().charAt(0).toUpperCase();
  const count = work.length;

  return (
    <aside
      ref={aside}
      className="rail rail-phone"
      data-open={open}
      aria-label="Conversations"
      inert={!open ? true : undefined}
      {...reorder.handlers}
    >
      <div className="rp-top">
        <span className="rp-brand">
          <BrandWordmark size={30} />
        </span>
        {searchable && (
          <button
            className="rp-icon"
            aria-label={searchOpen ? "Close search" : "Search"}
            aria-pressed={searchOpen}
            onClick={() => {
              setQuery("");
              setSearchOpen((value) => !value);
            }}
          >
            <MagnifyingGlass size={21} />
          </button>
        )}
        <button className="rp-avatar" aria-label="Settings" aria-haspopup="dialog" onClick={onSettings}>
          <span className="rp-avatar-disc">
            <span>{initial}</span>
          </span>
          <span className="rp-avatar-dot" aria-hidden="true" />
        </button>
      </div>

      <button className="rp-new" onClick={onNew} disabled={pristine}>
        <NotePencil size={21} aria-hidden="true" />
        <span>New conversation</span>
        <ArrowRight size={17} aria-hidden="true" />
      </button>

      <div className="rp-tabs" role="tablist" aria-label="Show" onKeyDown={tabKeys}>
        {views.map(([id, label]) => (
          <button
            key={id}
            ref={view === id ? tab : undefined}
            role="tab"
            id={`rail-tab-${id}`}
            aria-selected={view === id}
            aria-controls="rail-panel"
            tabIndex={view === id ? 0 : -1}
            className="rp-tab"
            onClick={() => go(id)}
          >
            {label}
            {id === "library" && count > 0 && <span className="chip-count">{count}</span>}
          </button>
        ))}
      </div>

      <div
        ref={pane}
        className="rail-list rp-pane"
        id="rail-panel"
        role="tabpanel"
        aria-labelledby={`rail-tab-${view}`}
        {...pulling}
      >
        {searchable && (
          <div
            className="rp-search-wrap"
            data-pulling={pull > 0 || undefined}
            style={{ height: fieldHeight, opacity: searchOpen ? 1 : Math.min(1, pull / 44) }}
          >
            <label className="rp-search">
              <MagnifyingGlass size={17} aria-hidden="true" />
              <input
                ref={field}
                type="search"
                value={query}
                tabIndex={searchOpen ? 0 : -1}
                placeholder={view === "library" ? "Search the library" : "Search conversations and saved work"}
                aria-label={view === "library" ? "Search the library" : "Search conversations"}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && (query || searchOpen)) {
                    event.stopPropagation();
                    setQuery("");
                    setSearchOpen(false);
                  }
                }}
              />
            </label>
          </div>
        )}

        {view === "library" ? (
          <Library
            items={work}
            query={query}
            filter={filter}
            setFilter={setFilter}
            activeId={activeId}
            openId={openRow}
            setOpenId={setOpenRow}
            onOpen={onOpenWork}
            onDelete={onDeleteWork}
          />
        ) : view === "work" ? (
          <Workroom audience={audience} setAudience={setAudience} onTask={onTask} onWorkroom={onWorkroom} />
        ) : results ? (
          <section>
            <h2 className="label rp-group" aria-live="polite">
              {results.length ? `${results.length} ${results.length === 1 ? "match" : "matches"}` : "Nothing matches"}
            </h2>
            {results.map(({ chat, excerpt }) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                excerpt={excerpt}
                active={chat.id === activeId}
                busy={Boolean(running[chat.id])}
                running={Boolean(running[chat.id])}
                openId={openRow}
                setOpenId={setOpenRow}
                onSelect={(id) => {
                  setQuery("");
                  setSearchOpen(false);
                  onSelect(id);
                }}
                onDelete={onDelete}
                onPin={onPin}
              />
            ))}
          </section>
        ) : (
          <>
            {groups.map((group) => (
              <section key={group.label}>
                <h2 className="label rp-group">{group.label}</h2>
                {group.items.map((chat) => (
                  <div key={chat.id} className="pin-row" data-pin-row={group.label === "Pinned" ? chat.id : undefined} data-moving={reorder.drag?.id === chat.id || undefined}>
                    <ChatRow
                      chat={chat}
                      active={chat.id === activeId}
                      busy={Boolean(running[chat.id])}
                      running={Boolean(running[chat.id])}
                      openId={openRow}
                      setOpenId={setOpenRow}
                      onSelect={onSelect}
                      onDelete={onDelete}
                      onPin={onPin}
                    />
                  </div>
                ))}
              </section>
            ))}
            <p className="rp-hint">
              {guest
                ? "Guest chat. Nothing is saved after you close this tab. "
                : ""}
              Swipe a conversation left to pin or remove it. Pull down to search.
            </p>
          </>
        )}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {reorder.announcement}
      </p>
      {reorder.drag && (
        <div
          className="pin-drag-ghost"
          aria-hidden="true"
          style={{
            left: Math.max(8, Math.min(window.innerWidth - 250, reorder.drag.x + 14)),
            top: Math.min(window.innerHeight - 70, reorder.drag.y + 14),
          }}
        >
          ⠿ <span>{reorder.drag.title}</span>
        </div>
      )}
    </aside>
  );
}
