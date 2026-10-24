import { usePinnedReorder } from "../lib/use-pinned-reorder.js";
import { movePinned } from "../lib/rich-ui.js";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BookmarkSimple,
  GearSix,
  House,
  MagnifyingGlass,
  Plus,
  PushPin,
  PushPinSlash,
  SidebarSimple,
  SignOut,
  Trash,
  X,
} from "@phosphor-icons/react";
import { BrandWordmark, Mark } from "./Mark.jsx";
import { WorkroomIcon } from "./WorkroomIcon.jsx";
import { PhoneRail } from "./RailPhone.jsx";
import { groupChats } from "../lib/format.js";
import { collectWork } from "../lib/library.js";
import "./rail.css";
import "./rail-fluid.css";
import "./rail-desk.css";

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

function Row({ chat, active, busy, running, excerpt, openId, setOpenId, onSelect, onDelete, onPin }) {
  const swipe = useSwipe(chat.id, openId, setOpenId);
  const titleRef = useRef(null);
  const [overflow, setOverflow] = useState(0);
  useLayoutEffect(() => {
    const element = titleRef.current;
    const measure = () => setOverflow(Math.max(0, element.scrollWidth - element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [chat.title]);
  const settle = () => setOpenId(null);
  return (
    <div
      className="rail-row"
      data-active={active}
      data-running={running || undefined}
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
          aria-current={active ? "page" : undefined}
          onClick={() => onSelect(chat.id)}
        >
          <span ref={titleRef} className="rail-title" data-overflow={overflow > 0 || undefined} style={{ '--title-travel': `${-overflow}px`, '--title-duration': `${Math.max(3, overflow / 32)}s` }}><span className="rail-title-text">{chat.title}</span></span>
          {running && <span className="rail-running" role="img" aria-label="Vaelo is replying here" />}
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

/* On a phone the index is a drawer of its own design (RailPhone.jsx); on
   anything wider it is the rail beside the conversation. */
export function Rail(props) {
  return props.phone ? <PhoneRail {...props} /> : <WideRail {...props} />;
}

function WideRail({
  chats,
  activeId,
  busy,
  running = {},
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
  onWorkroom,
  onToggle,
  onFind,
  page = "chat",
  onDesk,
  onSaved,
  projects = [],
  onProject,
}) {
  const [openRow, setOpenRow] = useState(null);
  const work = useMemo(() => collectWork(chats), [chats]);
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
  const reorder = usePinnedReorder({ aside, ids: pinned, setOrder: setPinOrder, saveOrder, chats, owner: orderKey, disabled: !!collapsed });
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
      className="rail rail-wide"
      data-open={open}
      data-collapsed={collapsed}
      aria-label="Conversations"
      {...reorder.handlers}
      inert={phone && !open ? true : undefined}
    >
      {/* The strip that stays when the rail folds away: the same doors, as
          icons. It fades in as the body fades out, so the width is the only
          thing that moves. */}
      <div className="rail-mini" aria-label="Quick actions" role="toolbar">
        <button className="rail-mini-mark" onClick={onToggle} aria-label="Open the sidebar" data-tip="Open the sidebar">
          <Mark size={30} />
        </button>
        <button className="rail-mini-btn rail-mini-new" onClick={onNew} disabled={pristine} aria-label="New conversation" data-tip="New conversation">
          <Plus size={19} />
        </button>
        {onFind && (
          <button className="rail-mini-btn" onClick={onFind} aria-label="Find or do something" data-tip="Find or do something">
            <MagnifyingGlass size={20} />
          </button>
        )}
        <button className="rail-mini-btn" onClick={onSaved} aria-label="Saved work" data-tip="Saved work">
          <BookmarkSimple size={20} />
        </button>
        {!user.guest && (
          <button className="rail-mini-btn" onClick={onWorkroom} aria-label="Workroom" data-tip="Workroom" aria-haspopup="dialog">
            <WorkroomIcon open={workroomOpen} size={20} />
          </button>
        )}
        <span className="rail-mini-fill" />
        <button className="rail-mini-btn" onClick={onSettings} aria-label="Settings" data-tip="Settings" aria-haspopup="dialog">
          <GearSix size={20} />
        </button>
      </div>

      <div className="rail-body">
      <div className="rail-head">
        <span className="rail-brand">
          <BrandWordmark size={32} />
        </span>
        {onToggle && (
          <button className="icon-button rail-collapse" aria-label="Collapse the sidebar" data-tip="Collapse the sidebar" onClick={onToggle}>
            <SidebarSimple size={20} />
          </button>
        )}
        <button
          ref={close}
          className="icon-button rail-close"
          aria-label="Close conversations"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>

      <div className="rail-actions">
        <button className="rail-new rail-new-conversation" onClick={onNew} disabled={pristine}>
          <Plus size={16} />
          <span>New conversation</span>
        </button>
        {onFind && (
          <button className="rail-find" onClick={onFind} aria-keyshortcuts="Control+k Meta+k">
            <MagnifyingGlass size={16} aria-hidden="true" />
            <span>Find or do something</span>
          </button>
        )}
      </div>

      <nav className="rail-nav" aria-label="Sections">
        <button className="rail-nav-item" aria-current={page === "chat" && chats.find((chat) => chat.id === activeId)?.messages.length === 0 ? "page" : undefined} onClick={onDesk}>
          <House size={19} aria-hidden="true" />
          <span>Desk</span>
        </button>
        <button className="rail-nav-item" aria-current={page === "saved" ? "page" : undefined} onClick={onSaved}>
          <BookmarkSimple size={19} aria-hidden="true" />
          <span>Saved work</span>
          {work.length > 0 && <span className="rail-nav-count">{work.length}</span>}
        </button>
        {!user.guest && (
          <button className="rail-nav-item" onClick={onWorkroom} aria-haspopup="dialog" aria-expanded={workroomOpen}>
            <WorkroomIcon open={workroomOpen} size={19} />
            <span>Workroom</span>
          </button>
        )}
      </nav>

      {projects.length > 0 && (
        <section className="rail-projects" aria-label="Projects">
          <h2 className="label">Projects</h2>
          {projects.map((project, index) => (
            <button key={project.id} className="rail-project" onClick={() => onProject?.(project)}>
              <span className="rail-project-dot" data-tone={index % 3} aria-hidden="true" />
              <span className="rail-project-name">{project.title}</span>
              {project.count > 0 && <span className="rail-nav-count">{project.count}</span>}
            </button>
          ))}
        </section>
      )}

      <nav className="rail-list" aria-label="Past conversations">
        {groups.map((group) => (
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
                  busy={Boolean(running[chat.id])}
                  running={Boolean(running[chat.id])}
                  onSelect={onSelect}
                  openId={openRow}
                  setOpenId={setOpenRow}
                  onDelete={onDelete}
                  onPin={onPin}
                />
                </div>
              ))}
            </section>
          ))}
      </nav>

      <p className="sr-only" role="status" aria-live="polite">{reorder.announcement}</p>
      {reorder.drag && <div className="pin-drag-ghost" aria-hidden="true" style={{left:Math.max(8, Math.min(window.innerWidth - 250, reorder.drag.x + 14)),top:Math.min(window.innerHeight - 70, reorder.drag.y + 14)}}>⠿ <span>{reorder.drag.title}</span></div>}
      <div className="rail-foot">
        {user.guest && <p className="rail-note">Guest chat. Nothing is saved after you close this tab.</p>}
        <div className="rail-account">
          <span className="rail-avatar" aria-hidden="true">
            {(user.name || "?").trim().charAt(0).toUpperCase()}
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
      </div>
    </aside>
  );
}
