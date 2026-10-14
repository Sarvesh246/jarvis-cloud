import React, { useRef, useState } from "react";
import {
  MagnifyingGlass,
  Plus,
  PushPin,
  PushPinSlash,
  SignOut,
  Trash,
  X,
} from "@phosphor-icons/react";
import { BrandWordmark } from "./Mark.jsx";
import { groupChats, searchChats } from "../lib/format.js";
import "./rail.css";

function Row({ chat, active, busy, excerpt, onSelect, onDelete, onPin }) {
  return (
    <div className="rail-row" data-active={active} data-excerpt={excerpt ? true : undefined}>
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
        title={chat.pinned ? "Unpin" : "Pin"}
        data-on={chat.pinned || undefined}
        onClick={() => onPin(chat.id)}
      >
        {chat.pinned ? <PushPinSlash size={16} /> : <PushPin size={16} />}
      </button>
      <button
        className="rail-act rail-delete"
        aria-label={`Remove ${chat.title}`}
        title="Remove"
        disabled={busy}
        onClick={() => onDelete(chat.id)}
      >
        <Trash size={16} />
      </button>
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
  onSignOut,
}) {
  const [query, setQuery] = useState("");
  const field = useRef(null);
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
          placeholder="Search conversations"
          aria-label="Search conversations"
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

      <nav className="rail-list" aria-label={results ? "Search results" : "Past conversations"}>
        {results ? (
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
            aria-label="Sign out"
            title="Sign out"
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
