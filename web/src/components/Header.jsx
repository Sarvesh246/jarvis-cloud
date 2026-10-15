import React, { useEffect, useRef, useState } from "react";
import { FolderSimplePlus, List, SidebarSimple } from "@phosphor-icons/react";
import "./header.css";

/* The header only names the conversation. What Vaelo is doing is shown
   where it is happening: in the reply itself. Its one action keeps a
   conversation that went well as a workspace to reuse. */
export function Header({ title, canRename, onRename, onOpenRail, onToggleRail, onSaveAsWorkspace }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const input = useRef(null);

  useEffect(() => setValue(title), [title]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  function commit() {
    setEditing(false);
    const next = value.trim().slice(0, 80);
    if (next && next !== title) onRename(next);
    else setValue(title);
  }

  return (
    <header className="header">
      <div className="header-left">
        <button
          className="icon-button header-rail-mobile"
          aria-label="Open conversations"
          onClick={onOpenRail}
        >
          <List size={22} />
        </button>
        <button
          className="icon-button header-rail-desktop"
          aria-label="Toggle conversations"
          onClick={onToggleRail}
        >
          <SidebarSimple size={21} />
        </button>
        {editing ? (
          <input
            ref={input}
            className="header-title-input"
            value={value}
            aria-label="Conversation name"
            maxLength={80}
            onChange={(event) => setValue(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
              if (event.key === "Escape") {
                setValue(title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            className="header-title"
            disabled={!canRename}
            data-tip={canRename ? "Rename conversation" : undefined}
            onClick={() => setEditing(true)}
          >
            {title}
          </button>
        )}
      </div>
      {onSaveAsWorkspace && (
        <button
          className="icon-button header-save-work"
          aria-label="Save this conversation as a workspace"
          data-tip="Save as a workspace"
          onClick={onSaveAsWorkspace}
        >
          <FolderSimplePlus size={21} />
        </button>
      )}
    </header>
  );
}
