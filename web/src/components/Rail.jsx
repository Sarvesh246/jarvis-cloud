import React from "react";
import { Plus, SignOut, Trash, X } from "@phosphor-icons/react";
import { Wordmark } from "./Halo.jsx";
import { groupChats } from "../lib/format.js";
import "./rail.css";

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
  onSignOut,
}) {
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
          <Wordmark size={32} />
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

      <nav className="rail-list" aria-label="Past conversations">
        {groups.map((group) => (
          <section key={group.label}>
            <h2 className="label">{group.label}</h2>
            {group.items.map((chat) => (
              <div
                key={chat.id}
                className="rail-row"
                data-active={chat.id === activeId}
              >
                <button
                  className="rail-link"
                  disabled={busy}
                  aria-current={chat.id === activeId ? "page" : undefined}
                  onClick={() => onSelect(chat.id)}
                >
                  {chat.title}
                </button>
                <button
                  className="rail-delete"
                  aria-label={`Remove ${chat.title}`}
                  disabled={busy}
                  onClick={() => onDelete(chat.id)}
                >
                  <Trash size={16} />
                </button>
              </div>
            ))}
          </section>
        ))}
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
