import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fitTitle } from '../lib/titles.js';
import { DotsThreeCircle, FolderSimplePlus, List, SidebarSimple } from "@phosphor-icons/react";
import "./header.css";

/* The header only names the conversation. What Vaelo is doing is shown
   where it is happening: in the reply itself. Its one action keeps a
   conversation that went well as a workspace to reuse. On a phone it is
   a menu on the left, the name in the middle and the conversation's own
   options on the right. */
export function Header({ title, canRename, onRename, onOpenRail, onToggleRail, onSaveAsWorkspace, onFind, onMenu }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const input = useRef(null);
  const name = useRef(null);
  const wasEditing = useRef(false);
  const [fitted, setFitted] = useState(title);

  useLayoutEffect(() => {
    const element = name.current;
    if (!element) return;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const style = getComputedStyle(element);
      const context = document.createElement('canvas').getContext('2d');
      if (!context) return;
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2;
      const spacing = parseFloat(style.letterSpacing) || 0;
      setFitted(fitTitle(title, text => context.measureText(text).width + Math.max(0, Array.from(text).length - 1) * spacing <= width));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(measure);
    return () => { disposed = true; observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [title, editing]);

  useEffect(() => setValue(title), [title]);
  useEffect(() => {
    if (editing) input.current?.select();
    // Done renaming: focus goes back to the name, not to the top of the page.
    else if (wasEditing.current && document.activeElement === document.body) name.current?.focus();
    wasEditing.current = editing;
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
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "Enter") {
                // Otherwise the same Enter would press the name once focus returns to it.
                event.preventDefault();
                commit();
              }
              if (event.key === "Escape") {
                setValue(title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            ref={name}
            className="header-title"
            title={title}
            aria-label={canRename ? `Rename conversation: ${title}` : title}
            disabled={!canRename}
            data-tip={canRename ? "Rename conversation" : undefined}
            onClick={() => setEditing(true)}
          >
            {fitted}
          </button>
        )}
      </div>
      {onFind && <button className="block-tool header-find" onClick={onFind} aria-label="Find actions, conversations and saved outputs" aria-keyshortcuts="Control+k Meta+k">Find <kbd>⌘/Ctrl K</kbd></button>}
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
      {onMenu && (
        <button className="icon-button header-more" aria-label="Conversation options" aria-haspopup="dialog" onClick={onMenu}>
          <DotsThreeCircle size={22} />
        </button>
      )}
    </header>
  );
}
