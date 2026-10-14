import React, { useEffect, useRef, useState } from "react";
import { List, SidebarSimple } from "@phosphor-icons/react";
import { Halo } from "./Halo.jsx";
import { statusText } from "../lib/format.js";
import "./header.css";

export function Header({
  title,
  canRename,
  phase,
  cloud,
  tool,
  onRename,
  onOpenRail,
  onToggleRail,
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const input = useRef(null);
  const label = statusText({ phase, cloud, tool });
  const tone =
    phase === "concern" || cloud === "Unavailable"
      ? "clay"
      : phase === "idle" && cloud === "Connected"
        ? "ready"
        : "active";

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
            title={canRename ? "Rename conversation" : undefined}
            onClick={() => setEditing(true)}
          >
            {title}
          </button>
        )}
      </div>

      <div className="presence" data-tone={tone} role="status" aria-live="polite">
        <Halo size={22} state={phase} />
        <span>{label}</span>
      </div>
    </header>
  );
}
