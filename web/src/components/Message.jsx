import React, { useState } from "react";
import Markdown from "react-markdown";
import { ArrowClockwise, Check, Copy } from "@phosphor-icons/react";
import { Halo } from "./Halo.jsx";
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

/* What Vaelo reached for, shown as a quiet line of record rather than a log. */
function Activity({ items }) {
  if (!items?.length) return null;
  return (
    <ul className="activity" aria-label="What Vaelo did">
      {items.map((item) => (
        <li key={item.id} data-state={item.done ? "done" : "running"}>
          <span className="activity-mark" aria-hidden="true">
            {item.done ? <Check size={12} weight="bold" /> : null}
          </span>
          {humanizeTool(item.name)}
          <span className="activity-state">
            {item.done ? "done" : "in progress"}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Message({
  message,
  fresh,
  busy,
  streaming,
  phase,
  isLast,
  onRetry,
}) {
  const [copied, copy] = useCopy();
  const mine = message.role === "user";
  const waiting = !mine && !message.content && busy;

  return (
    <article
      className="message"
      data-role={message.role}
      data-fresh={fresh || undefined}
      data-last={isLast || undefined}
      data-failed={message.failed || undefined}
      aria-label={mine ? "Your message" : "Vaelo"}
    >
      <div className="message-label">
        {!mine && (
          <Halo
            size={22}
            state={streaming ? "speaking" : waiting ? phase : "idle"}
          />
        )}
        <span className="label">{mine ? "You" : "Vaelo"}</span>
      </div>
      <div className="message-body">
        <Activity items={message.activity} />
        {message.content ? (
          <div className="prose">
            <Markdown components={markdown}>{message.content}</Markdown>
            {streaming && <span className="caret" aria-hidden="true" />}
          </div>
        ) : waiting ? (
          <p className="message-waiting">
            {phase === "waking"
              ? "Vaelo is waking up. This can take a minute."
              : "One moment."}
          </p>
        ) : null}

        {message.truncated && (
          <p className="message-note">
            That reached the length limit. Ask Vaelo to continue and it will
            pick up from there.
          </p>
        )}
        {message.failed && <p className="message-note error">{message.note}</p>}

        {!mine && message.content && !streaming && (
          <div className="message-actions">
            <button
              className="text-button"
              onClick={() => copy(message.content)}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Copied" : "Copy"}
            </button>
            {isLast && !busy && (
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
