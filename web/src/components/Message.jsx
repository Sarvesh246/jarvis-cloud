import React, { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import {
  ArrowClockwise,
  ArrowRight,
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
  Copy,
  PencilSimple,
} from "@phosphor-icons/react";
import { Mark } from "./Mark.jsx";
import { humanizeTool } from "../lib/format.js";
import "./message.css";

function textOf(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
}

function useCopy() {
  const [done, setDone] = useState(false);
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      /* clipboard can be blocked; the text stays selectable */
    }
  };
  return [done, copy];
}

/* Seconds since `from`, ticking once a second while `live`. */
function useElapsed(from, live) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  return from ? Math.max(0, Math.round((now - from) / 1000)) : 0;
}

function seconds(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function CodeBlock({ children }) {
  const [done, copy] = useCopy();
  return (
    <div className="code">
      <button
        className="code-copy"
        onClick={() => copy(textOf(children))}
        aria-label={done ? "Copied" : "Copy code"}
      >
        {done ? <Check size={15} /> : <Copy size={15} />}
        <span>{done ? "Copied" : "Copy"}</span>
      </button>
      <pre>{children}</pre>
    </div>
  );
}

const markdown = {
  a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  img: ({ alt }) => <span>[Image: {alt || "external image"}]</span>,
  pre: CodeBlock,
};

function Steps({ items }) {
  return (
    <ol className="steps">
      {items.map((item) => (
        <li key={item.id} data-state={item.done ? "done" : "running"}>
          <span className="steps-mark" aria-hidden="true" />
          {humanizeTool(item.name)}
        </li>
      ))}
    </ol>
  );
}

/* What Vaelo is doing, said once, in the place it is happening. While it
   works this is a live line; afterwards it folds into a quiet receipt
   ("Thought for 8s · 2 steps") that opens to show the steps. */
function Process({ message, live, phase }) {
  const [open, setOpen] = useState(false);
  const elapsed = useElapsed(message.startedAt, live);
  const steps = message.activity || [];
  const running = steps.findLast?.((item) => !item.done);

  if (live) {
    let line = "Thinking";
    if (phase === "waking") line = "Waking up. This can take a minute";
    else if (running) line = humanizeTool(running.name);
    return (
      <div className="process" data-live="true" role="status" aria-live="polite">
        <span className="process-line shimmer">{line}</span>
        {elapsed >= 3 && <span className="process-time">{elapsed}s</span>}
        {steps.length > 1 && <Steps items={steps} />}
      </div>
    );
  }

  const thought = message.thoughtMs || 0;
  if (!steps.length && thought < 2000) return null;
  const parts = [`Thought for ${seconds(thought)}`];
  if (steps.length)
    parts.push(`${steps.length} ${steps.length === 1 ? "step" : "steps"}`);
  return (
    <div className="process" data-open={open}>
      <button
        className="process-receipt"
        aria-expanded={open}
        disabled={!steps.length}
        onClick={() => setOpen((value) => !value)}
      >
        {parts.join(" · ")}
        {steps.length > 0 && <CaretDown size={13} />}
      </button>
      {open && <Steps items={steps} />}
    </div>
  );
}

function Edit({ initial, onSave, onCancel }) {
  const [value, setValue] = useState(initial);
  const field = useRef(null);
  useEffect(() => {
    const el = field.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    const el = field.current;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <form
      className="edit"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onSave(value.trim());
      }}
    >
      <textarea
        ref={field}
        value={value}
        aria-label="Edit your message"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (value.trim()) onSave(value.trim());
          }
        }}
      />
      <div className="edit-actions">
        <button type="button" className="text-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="edit-send" disabled={!value.trim()}>
          Send
        </button>
      </div>
    </form>
  );
}

export function Message({
  message,
  fresh,
  busy,
  live,
  streaming,
  phase,
  isLast,
  onRetry,
  onContinue,
  onEdit,
  onVersion,
}) {
  const [copied, copy] = useCopy();
  const [editing, setEditing] = useState(false);
  const mine = message.role === "user";
  const waiting = live && !message.content;
  const versions = message.versions?.length > 1 ? message.versions : null;
  const face = streaming
    ? "speaking"
    : waiting
      ? phase
      : message.failed
        ? "concern"
        : "idle";

  return (
    <article
      className="message"
      data-role={message.role}
      data-fresh={fresh || undefined}
      data-last={isLast || undefined}
      data-failed={message.failed || undefined}
      data-editing={editing || undefined}
      aria-label={mine ? "Your message" : "Vaelo"}
    >
      <div className="message-label">
        {!mine && <Mark size={22} state={face} />}
        <span className="label">{mine ? "You" : "Vaelo"}</span>
      </div>
      <div className="message-body">
        {!mine && (
          <Process
            message={message}
            live={live && !streaming}
            phase={phase}
          />
        )}

        {editing ? (
          <Edit
            initial={message.content}
            onCancel={() => setEditing(false)}
            onSave={(text) => {
              setEditing(false);
              onEdit(text);
            }}
          />
        ) : (
          message.content && (
            <div className="prose">
              {mine ? (
                message.content
              ) : (
                <Markdown components={markdown}>{message.content}</Markdown>
              )}
              {streaming && <span className="caret" aria-hidden="true" />}
            </div>
          )
        )}

        {message.stopped && (
          <p className="message-note">
            {message.content
              ? "You stopped this reply."
              : "You stopped this before Vaelo answered."}
            {isLast && !busy && message.content && (
              <button className="text-button" onClick={onContinue}>
                Continue <ArrowRight size={14} />
              </button>
            )}
          </p>
        )}
        {message.truncated && (
          <p className="message-note">
            This reply reached its length limit.
            {isLast && !busy && (
              <button className="text-button" onClick={onContinue}>
                Continue <ArrowRight size={14} />
              </button>
            )}
          </p>
        )}
        {message.failed && (
          <div className="message-error" role="alert">
            <p>{message.note}</p>
            {isLast && !busy && (
              <button className="text-button" onClick={onRetry}>
                <ArrowClockwise size={15} />
                Try again
              </button>
            )}
          </div>
        )}

        {!editing && !live && (message.content || versions) && (
          <div className="message-actions">
            {versions && (
              <span className="versions" aria-label="Versions of this reply">
                <button
                  className="icon-button small"
                  aria-label="Previous version"
                  disabled={busy || message.version === 0}
                  onClick={() => onVersion(message.version - 1)}
                >
                  <CaretLeft size={14} />
                </button>
                <span>
                  {message.version + 1} / {versions.length}
                </span>
                <button
                  className="icon-button small"
                  aria-label="Next version"
                  disabled={busy || message.version === versions.length - 1}
                  onClick={() => onVersion(message.version + 1)}
                >
                  <CaretRight size={14} />
                </button>
              </span>
            )}
            {message.content && (
              <button
                className="text-button"
                onClick={() => copy(message.content)}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? "Copied" : "Copy"}
              </button>
            )}
            {mine && !busy && (
              <button className="text-button" onClick={() => setEditing(true)}>
                <PencilSimple size={15} />
                Edit
              </button>
            )}
            {!mine && isLast && !busy && !message.failed && (
              <button className="text-button" onClick={onRetry}>
                <ArrowClockwise size={15} />
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
