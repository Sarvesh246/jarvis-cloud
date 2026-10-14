import React, { forwardRef, useEffect } from "react";
import { ArrowUp, Stop } from "@phosphor-icons/react";
import "./composer.css";

export const Composer = forwardRef(function Composer(
  { draft, busy, onChange, onSend, onStop },
  textarea,
) {
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
  }, [draft, textarea]);

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <textarea
        ref={textarea}
        value={draft}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Write to Vaelo"
        aria-label="Message Vaelo"
        rows={1}
        maxLength={16000}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            !matchMedia("(pointer: coarse)").matches
          ) {
            event.preventDefault();
            onSend();
          }
        }}
      />
      <div className="composer-end">
        <span className="composer-hint">Enter to send · Shift+Enter for a new line</span>
        <button
          type={busy ? "button" : "submit"}
          className="send"
          data-mode={busy ? "stop" : "send"}
          aria-label={busy ? "Stop" : "Send"}
          disabled={!busy && !draft.trim()}
          onClick={busy ? onStop : undefined}
        >
          <ArrowUp className="send-arrow" size={20} weight="bold" />
          <Stop className="send-stop" size={16} weight="fill" />
        </button>
      </div>
    </form>
  );
});
