import { usePinnedReorder } from "../lib/use-pinned-reorder.js";
import { movePinned } from "../lib/rich-ui.js";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
  User,
  X,
} from "@phosphor-icons/react";
import { BrandWordmark } from "./Mark.jsx";
import { WorkroomIcon } from "./WorkroomIcon.jsx";
import { groupChats, searchChats } from "../lib/format.js";
import { collectWork, searchWork } from "../lib/library.js";
import "./rail.css";

const WORK_ICONS = { document: FileText, code: Code, table: Table };
const WORK_KINDS = { document: "Document", code: "Code", table: "Table" };

/* The things Vaelo has made, newest first, each a way back into the
   workspace and the conversation it came from. */
function Library({ items, query, activeId, busy, onOpen, onDelete }) {
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
            <li key={entry.id} className="library-row">
              <button
                className="work-row"
                data-active={entry.chatId === activeId || undefined}
                /* Like the conversation rows: a reply in progress keeps you
                   in its conversation. */
                disabled={busy && entry.chatId !== activeId}
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
              <button className="icon-button library-delete" aria-label={`Delete ${entry.title} from library`} data-tip="Delete from library" onClick={() => onDelete(entry)}>
                <Trash size={17} />
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
          title={chat.pinned ? "Drag to reorder this chat" : undefined}
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
  phone = false,
  collapsed,
  workroomOpen = false,
  user,
  onClose,
  onNew,
  onSelect,
  onDelete,
  onPin,
  onSettings,
  onSignOut,
  onOpenWork,
  onDeleteWork,
  onWorkroom,
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
  const orderKey = `vaelo-pin-order:${user?.sub || 'guest'}`;
  const [pinOrder, setPinOrder] = useState([]);
  const [arranging, setArranging] = useState(false);
  useEffect(() => { try { const ids = JSON.parse(localStorage.getItem(orderKey) || '[]'); setPinOrder(Array.isArray(ids) ? ids.filter(x => typeof x === 'string').slice(0, 500) : []); } catch { setPinOrder([]); } }, [orderKey]);
  const groups = groupChats(chats).map(group => group.label !== 'Pinned' ? group : { ...group, items: [...group.items].sort((a, b) => { const ai = pinOrder.indexOf(a.id), bi = pinOrder.indexOf(b.id); return (ai < 0 ? 10000 : ai) - (bi < 0 ? 10000 : bi); }) });
  const pinned = groups.find(g => g.label === 'Pinned')?.items.map(c => c.id) || [];
  function saveOrder(ids, focusId) { setPinOrder(ids); if (focusId) requestAnimationFrame(() => [...(aside.current?.querySelectorAll('[data-pin-id]') || [])].find(el => el.dataset.pinId === focusId)?.focus()); try { localStorage.setItem(orderKey, JSON.stringify(ids)); } catch {} }

  const pristine = chats.length === 1 && !chats[0].messages.length;

  /* On a phone the rail is a drawer: closed, it is out of the tab order
     and hidden from screen readers; opened, focus moves into it; closed
     again, focus goes back to the button that opens it, unless choosing
     something in it already moved focus on. */
  const aside = useRef(null);
  const reorder = usePinnedReorder({ aside, ids: pinned, setOrder: setPinOrder, saveOrder, chats, disabled: busy || !!query || view !== 'chats' });
  const close = useRef(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (!phone || open === wasOpen.current) return;
    wasOpen.current = open;
    if (open) close.current?.focus({ preventScroll: true });
    else {
      const focus = document.activeElement;
      if (!focus || focus === document.body || aside.current?.contains(focus))
        document.querySelector(".header-rail-mobile")?.focus({ preventScroll: true });
    }
  }, [open, phone]);

  return (
    <aside
      ref={aside}
      className="rail"
      data-open={open}
      data-collapsed={collapsed}
      aria-label="Conversations"
      {...reorder.handlers}
      inert={phone && !open ? true : undefined}
    >
      <div className="rail-head">
        <span className="rail-brand">
          <BrandWordmark size={32} />
        </span>
        <button
          ref={close}
          className="icon-button rail-close"
          aria-label="Close conversations"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>

      <button className="rail-new rail-new-conversation" onClick={onNew} disabled={busy || pristine}>
        <Plus size={16} />
        <span>New conversation</span>
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
          <Library items={work} query={query} activeId={activeId} busy={busy} onOpen={onOpenWork} onDelete={onDeleteWork} />
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
              <h2 className="label">{group.label}{group.label === 'Pinned' && group.items.length > 1 && <button className="pin-arrange" aria-pressed={arranging} onClick={() => setArranging(v => !v)}>{arranging ? 'Done' : 'Reorder'}</button>}</h2>
              {group.label === 'Pinned' && group.items.length > 1 && <p className="pin-hint">Drag a chat to reorder<span> · hold to drag on touch</span></p>}
              {group.items.map((chat, index) => (
                <div key={chat.id} className="pin-row" data-pin-row={group.label === 'Pinned' ? chat.id : undefined} data-moving={reorder.drag?.id === chat.id || undefined}>
                {group.label === 'Pinned' && arranging && <div className="pin-reorder">
                  <button data-pin-id={chat.id} aria-label={`Drag to reorder ${chat.title}`}>↕</button>
                  <button aria-label={`Move ${chat.title} up`} disabled={index === 0} onClick={() => saveOrder(movePinned(pinned, chat.id, -1), chat.id)}>Move up</button>
                  <button aria-label={`Move ${chat.title} down`} disabled={index === group.items.length - 1} onClick={() => saveOrder(movePinned(pinned, chat.id, 1), chat.id)}>Move down</button>
                </div>}
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
                </div>
              ))}
            </section>
          ))
        )}
      </nav>

      <p className="sr-only" role="status" aria-live="polite">{reorder.announcement}</p>
      {reorder.drag && <div className="pin-drag-ghost" aria-hidden="true" style={{left:Math.max(8, Math.min(window.innerWidth - 250, reorder.drag.x + 14)),top:Math.min(window.innerHeight - 70, reorder.drag.y + 14)}}>⠿ <span>{reorder.drag.title}</span></div>}
      <div className="rail-foot">
        {!user.guest && (
          <button className="rail-new rail-workroom" onClick={onWorkroom} aria-haspopup="dialog" aria-expanded={workroomOpen}>
            <WorkroomIcon open={workroomOpen} size={20} /><span>Workroom</span>
          </button>
        )}
        <p className="rail-note">
          {user.guest ? "Guest chat. Nothing is saved after you close this tab." : "Private conversations and saved work."}
        </p>
        <div className="rail-account">
          <span className="rail-avatar" aria-hidden="true">
            <User size={22} weight="duotone" />
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
            aria-label={user.guest ? "Leave guest mode" : "Sign out"}
            data-tip={user.guest ? "Leave guest mode" : "Sign out"}
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
