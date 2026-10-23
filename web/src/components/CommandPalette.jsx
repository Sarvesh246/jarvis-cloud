import React, { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { collectWork } from "../lib/library.js";
import { searchChats } from "../lib/format.js";
import { displayChatTitle } from "../lib/titles.js";
import "./ui-tools.css";
import { usePhone } from "../lib/use-phone.js";
import "./palette-desk.css";

/* The kinds of result, as the section headings a person reads */
const GROUPS = { Action: "Do", Conversation: "Go to", "Saved output": "Saved work" };

export function CommandPalette({
  open,
  onClose,
  chats,
  onSelect,
  onOpenWork,
  actions,
}) {
  const phone = usePhone();
  const dialog = useRef(null),
    input = useRef(null);
  const previousResults = useRef([]);
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(0);
  const results = useMemo(() => {
    if (!open) return previousResults.current;
    const needle = query.trim().toLowerCase();
    const commands = actions.filter((a) =>
      a.label.toLowerCase().includes(needle),
    );
    const matches = needle
      ? (searchChats(chats, needle) || []).map((x) => x.chat)
      : chats.filter((c) => c.messages.length).slice(0, 8);
    const work = collectWork(chats).filter(
      (x) => !needle || `${x.title} ${x.kind}`.toLowerCase().includes(needle),
    );
    return [
      ...commands.map((a) => ({ ...a, kind: "Action" })),
      ...matches.map((chat) => ({
        id: chat.id,
        kind: "Conversation",
        label: displayChatTitle(chat),
        run: () => onSelect(chat.id),
      })),
      ...work
        .slice(0, 12)
        .map((item, i) => ({
          id: `work-${i}`,
          kind: "Saved output",
          label: item.title,
          run: () => onOpenWork(item),
        })),
    ].slice(0, 40);
  }, [open, query, chats, actions, onSelect, onOpenWork]);
  useEffect(() => { if (open) previousResults.current = results; }, [open, results]);
  useEffect(() => {
    const el = dialog.current;
    delete el.dataset.closing;
    if (open && !el.open) {
      setQuery("");
      setSelected(0);
      el.showModal();
      input.current?.focus();
    } else if (!open && el.open) {
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduce";
      if (reduced) el.close();
      else {
        el.dataset.closing = "true";
        const timer = setTimeout(() => el.close(), 160);
        return () => clearTimeout(timer);
      }
    }
  }, [open]);
  useEffect(() => setSelected(0), [query]);
  useEffect(() => setSelected(index => Math.min(index, Math.max(0, results.length - 1))), [results.length]);
  useEffect(() => {
    dialog.current
      ?.querySelector(`[data-command-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  function choose(item) {
    if (!item) return;
    onClose();
    item.run();
  }
  return phone ? (
    <dialog
      ref={dialog}
      className="command-dialog"
      aria-labelledby="command-title"
      onClose={onClose}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <header className="rich-toolbar">
        <h2 id="command-title">Find or do something</h2>
        <button
          className="block-tool"
          onClick={onClose}
          aria-label="Close command palette"
        >
          Close
        </button>
      </header>
      <input
        ref={input}
        type="search"
        value={query}
        maxLength={200}
        placeholder="Search actions, conversations and saved outputs"
        aria-label="Search commands"
        aria-controls="command-results"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setSelected((i) =>
              Math.max(
                0,
                Math.min(
                  results.length - 1,
                  i + (e.key === "ArrowDown" ? 1 : -1),
                ),
              ),
            );
          }
          if (e.key === "Enter") {
            e.preventDefault();
            choose(results[selected]);
          }
        }}
      />
      <p className="local-note">↑ ↓ to choose · Enter to open · Esc to close</p>
      <div className="command-results" id="command-results">
        {results.map((x, i) => (
          <button
            key={`${x.kind}-${x.id}`}
            data-command-index={i}
            data-selected={i === selected || undefined}
            onPointerMove={() => setSelected(i)}
            onClick={() => choose(x)}
          >
            <span>{x.label}</span>
            <small>{x.kind}</small>
          </button>
        ))}
        {!results.length && (
          <p role="status">No matches. Try a shorter word.</p>
        )}
      </div>
      <p className="sr-only" role="status">
        {results[selected]
          ? `${results[selected].label}, ${results[selected].kind}`
          : "No results"}
      </p>
    </dialog>
  ) : (
    <dialog
      ref={dialog}
      className="command-dialog"
      aria-labelledby="command-title"
      onClose={onClose}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <h2 id="command-title" className="sr-only">Find or do something</h2>
      <div className="palette-search">
        <MagnifyingGlass size={20} aria-hidden="true" />
        <input
          ref={input}
          type="search"
          value={query}
          maxLength={200}
          placeholder="Find or do something"
          aria-label="Search commands"
          aria-controls="command-results"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) =>
                Math.max(
                  0,
                  Math.min(
                    results.length - 1,
                    i + (e.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              );
            }
            if (e.key === "Enter") {
              e.preventDefault();
              choose(results[selected]);
            }
          }}
        />
        <button className="palette-esc" onClick={onClose} aria-label="Close command palette">
          <kbd>Esc</kbd>
        </button>
      </div>
      <div className="command-results" id="command-results">
        {results.map((x, i) => (
          <React.Fragment key={`${x.kind}-${x.id}`}>
            {(i === 0 || results[i - 1].kind !== x.kind) && (
              <span className="palette-group" aria-hidden="true">{GROUPS[x.kind] || x.kind}</span>
            )}
            <button
              data-command-index={i}
              data-selected={i === selected || undefined}
              onPointerMove={() => setSelected(i)}
              onClick={() => choose(x)}
            >
              <span>{x.label}</span>
              <small>{x.kind === "Action" ? "" : x.kind}</small>
            </button>
          </React.Fragment>
        ))}
        {!results.length && (
          <p role="status">No matches. Try a shorter word.</p>
        )}
      </div>
      <p className="palette-foot">
        <span>↑↓ to move</span>
        <span>Enter to open</span>
        <span>Esc to close</span>
      </p>
      <p className="sr-only" role="status">
        {results[selected]
          ? `${results[selected].label}, ${results[selected].kind}`
          : "No results"}
      </p>
    </dialog>
  );
}
