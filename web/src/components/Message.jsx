import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowRight,
  ArrowsOut,
  BookOpenText,
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
  ClockCounterClockwise,
  Copy,
  File,
  FolderOpen,
  GitBranch,
  ImageSquare,
  ListChecks,
  MagnifyingGlass,
  PencilLine,
  PencilSimple,
  ShieldWarning,
  SignIn,
  TerminalWindow,
  Toolbox,
  UsersThree,
  Wrench,
} from "@phosphor-icons/react";
import { Mark } from "./Mark.jsx";
import { Rendered, SourceStrip, useCopy, useSources } from "./blocks/Blocks.jsx";
import { summarizeSteps, toolDetail, toolInfo } from "../lib/tools.js";
import { formatSize } from "../lib/attachments.js";
import "./message.css";

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

const STEP_ICONS = {
  search: MagnifyingGlass,
  read: BookOpenText,
  run: TerminalWindow,
  file: FolderOpen,
  write: PencilLine,
  memory: ClockCounterClockwise,
  skill: Toolbox,
  image: ImageSquare,
  delegate: UsersThree,
  plan: ListChecks,
  tool: Wrench,
};

/* What Vaelo did, step by step: what kind of thing, what it was about, and
   how long it took. Status is said in words and shape, never colour alone. */
function Steps({ items }) {
  return (
    <ol className="steps">
      {items.map((item) => {
        const tool = item.tool ?? item.name;
        const info = toolInfo(tool);
        const Icon = STEP_ICONS[info.kind] || Wrench;
        const detail = toolDetail(item);
        return (
          <li key={item.id} data-state={item.done ? "done" : "running"} title={tool}>
            <span className="steps-mark" aria-hidden="true" />
            <Icon size={15} aria-hidden="true" className="steps-icon" />
            <span className="steps-text">
              {item.done ? info.past : info.now}
              {detail && <span className="steps-detail"> · {detail}</span>}
            </span>
            <span className="sr-only">{item.done ? ", done" : ", in progress"}</span>
            {item.done && item.endedAt && item.startedAt && (
              <span className="steps-time">{seconds(item.endedAt - item.startedAt)}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* What Vaelo drew on for this reply, so memory and files are never a mystery. */
function Context({ context, usage }) {
  if (!context) return null;
  const parts = [];
  if (context.turns > 0)
    parts.push(`this conversation (${context.turns} earlier ${context.turns === 1 ? "message" : "messages"})`);
  else parts.push("your message");
  if (context.files?.length) parts.push(context.files.join(", "));
  const mode = [context.research && "research", context.style && context.style !== "balanced" && `${context.style} style`]
    .filter(Boolean)
    .join(", ");
  const tokens =
    usage && (usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0));
  return (
    <>
      <p className="context-line">
        <span className="label">Drew on</span> {parts.join(" · ")}
        {mode && <span className="context-mode"> — {mode}</span>}
      </p>
      {context.dropped > 0 && (
        <p className="context-line">
          <span className="label">Left out</span> {context.dropped} earlier{" "}
          {context.dropped === 1 ? "message" : "messages"}, to stay within what the cloud can
          read at once
        </p>
      )}
      {tokens > 0 && (
        <p className="context-line">
          <span className="label">Used</span> {tokens.toLocaleString()} tokens
          {usage.completion_tokens ? ` (${usage.completion_tokens.toLocaleString()} written)` : ""}
        </p>
      )}
    </>
  );
}

/* Hermes says why a stream has gone quiet: a slow provider, a retry, a
   switch to a fallback model. Those notes are kept with the reply. */
function Notes({ notes }) {
  if (!notes?.length) return null;
  return (
    <ul className="process-notes">
      {notes.map((note, i) => (
        <li key={i} data-kind={note.kind}>
          {note.text}
        </li>
      ))}
    </ul>
  );
}

/* The model's own reasoning, when the provider shares it. Closed by default:
   trust should never depend on reading it. */
function Reasoning({ text }) {
  const [open, setOpen] = useState(false);
  if (!text?.trim()) return null;
  return (
    <div className="reasoning">
      <button className="reasoning-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide reasoning" : "Show reasoning"} <CaretDown size={13} />
      </button>
      {open && <p className="reasoning-text">{text}</p>}
    </div>
  );
}

/* What Vaelo is doing, said once, in the place it is happening. While it
   works this is a live line; afterwards it folds into a quiet receipt
   ("Worked for 12s · Searched the web 3×") that opens to the steps. */
function Process({ message, live, phase }) {
  const [open, setOpen] = useState(false);
  const elapsed = useElapsed(message.startedAt, live);
  const steps = message.activity || [];
  const running = steps.findLast?.((item) => !item.done);

  if (live) {
    let line = "Thinking";
    if (message.approval?.state === "pending") line = "Waiting for your answer";
    else if (phase === "waking") line = "Waking up. This can take a minute";
    else if (running) {
      const detail = toolDetail(running);
      line = `${toolInfo(running.tool ?? running.name).now}${detail ? ` · ${detail}` : ""}`;
    } else if (message.live) line = message.live;
    else if (message.reasoning) line = "Thinking it through";
    return (
      <div className="process" data-live="true">
        <span className="process-line shimmer">{line}</span>
        {elapsed >= 3 && <span className="process-time">{elapsed}s</span>}
        {running && message.live && <span className="process-sub">{message.live}</span>}
        {steps.length > 1 && <Steps items={steps} />}
      </div>
    );
  }

  const thought = message.thoughtMs || 0;
  const extra = !!(message.context || message.reasoning || message.notes?.length);
  const expandable = steps.length > 0 || extra;
  if (!steps.length && thought < 2000 && !extra) return null;
  const summary = summarizeSteps(steps);
  const parts = [`${steps.length ? "Worked" : "Thought"} for ${seconds(thought)}`];
  parts.push(...summary.slice(0, 2));
  if (summary.length > 2) parts.push(`${summary.length - 2} more`);
  return (
    <div className="process" data-open={open}>
      <button
        className="process-receipt"
        aria-expanded={open}
        disabled={!expandable}
        onClick={() => setOpen((value) => !value)}
      >
        {parts.join(" · ")}
        {expandable && <CaretDown size={13} />}
      </button>
      {open && (
        <div className="process-detail">
          {steps.length > 0 && <Steps items={steps} />}
          <Notes notes={message.notes} />
          <Context context={message.context} usage={message.usage} />
          <Reasoning text={message.reasoning} />
        </div>
      )}
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

export function AttachmentList({ items, onRemove }) {
  if (!items?.length) return null;
  return (
    <ul className="attachments" aria-label="Attached files">
      {items.map((file) => (
        <li key={file.id} className="attachment" data-state={file.state} data-kind={file.kind}>
          {file.kind === "image" && file.thumb ? (
            <img className="attachment-thumb" src={file.thumb} alt="" />
          ) : file.kind === "image" ? (
            <ImageSquare size={16} aria-hidden="true" />
          ) : (
            <File size={16} aria-hidden="true" />
          )}
          <span className="attachment-name">{file.name}</span>
          <span className="attachment-meta">
            {file.state === "reading"
              ? "Reading…"
              : file.state === "ready" && file.kind === "image"
                ? `Image · ${formatSize(file.size)}`
                : file.state === "ready"
                ? `${formatSize(file.size)}${file.chars ? ` · ${file.chars.toLocaleString()} characters` : ""}`
                : file.note}
          </span>
          {onRemove && (
            <button
              type="button"
              className="attachment-remove"
              aria-label={`Remove ${file.name}`}
              title="Remove"
              onClick={() => onRemove(file.id)}
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/* A request that needs a person's say-so is shown for what it is: exactly
   what Vaelo wants to run, with the answers Hermes accepts. The reply waits
   while you decide. */
const APPROVAL_LABELS = {
  once: "Allow once",
  session: "Allow for this conversation",
  deny: "Deny",
};

function Approval({ approval, canAct, onAnswer, onAlternative }) {
  const state = approval.state || "expired";
  const pending = state === "pending" || state === "sending";
  return (
    <div className="approval" role="group" aria-label="Approval needed" data-state={state}>
      <p className="approval-head">
        <ShieldWarning size={18} aria-hidden="true" />
        {pending
          ? "Vaelo wants to do something that needs your approval."
          : state === "approved"
            ? approval.choice === "session"
              ? "Allowed for this conversation."
              : "Allowed once."
            : state === "denied"
              ? "You denied this."
              : "This request is no longer waiting."}
      </p>
      {approval.description && <p className="approval-what">{approval.description}</p>}
      {approval.command && (
        <pre className="approval-command">
          <code>{approval.command}</code>
        </pre>
      )}
      {pending && approval.runId && (
        <div className="approval-actions">
          {(approval.choices?.length ? approval.choices : ["once", "deny"]).map((choice) => (
            <button
              key={choice}
              className={choice === "deny" ? "approval-deny" : "approval-allow"}
              disabled={state === "sending"}
              onClick={() => onAnswer(choice)}
            >
              {state === "sending" && approval.choice === choice ? "Sending…" : APPROVAL_LABELS[choice]}
            </button>
          ))}
        </div>
      )}
      {approval.note && <p className="approval-note" role="alert">{approval.note}</p>}
      {pending && (
        <p className="approval-note">
          Permanent rules can only be added from a Hermes app on your own device.
        </p>
      )}
      {state === "expired" && canAct && (
        <button className="text-button" onClick={onAlternative}>
          Ask for another way <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}

/* Your side of the exchange, set on its own slip of paper */
function Slip({ mine, editing, children }) {
  if (!mine) return children;
  return (
    <div className="slip" data-editing={editing || undefined}>
      {children}
    </div>
  );
}

const ERROR_ACTION = {
  offline: { label: "Try again", icon: ArrowClockwise, type: "retry" },
  busy: { label: "Try again", icon: ArrowClockwise, type: "retry" },
  unknown: { label: "Try again", icon: ArrowClockwise, type: "retry" },
  limit: { label: "Continue in a new conversation", icon: ArrowRight, type: "carry" },
  auth: { label: "Sign in again", icon: SignIn, type: "signin" },
};

function MessageView({ message, fresh, busy, live, streaming, phase, isLast, onAction }) {
  const [copied, copy] = useCopy();
  const [editing, setEditing] = useState(false);
  const mine = message.role === "user";
  const waiting = live && !message.content;
  const versions = message.versions?.length > 1 ? message.versions : null;
  const sources = useSources(mine ? "" : message.content);
  const act = useCallback((type, payload) => onAction(type, message.id, payload), [onAction, message.id]);
  const open = useCallback((item) => act("open", item), [act]);
  const canAct = isLast && !busy;
  const long = !mine && (message.content?.length > 1400 || /^#{1,3} /m.test(message.content || ""));
  const face = streaming
    ? "speaking"
    : waiting
      ? phase
      : message.failed || message.interrupted
        ? "concern"
        : "idle";
  const action = message.failed && ERROR_ACTION[message.errorKind || "unknown"];
  const shown = mine ? (message.text ?? message.content) : message.content;

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
        {!mine && <Process message={message} live={live && !streaming} phase={phase} />}

        {message.approval && (
          <Approval
            approval={message.approval}
            canAct={canAct}
            onAnswer={(choice) => act("approve", choice)}
            onAlternative={() => act("alternative")}
          />
        )}


        <Slip mine={mine} editing={editing}>
          {editing ? (
            <Edit
              initial={shown}
              onCancel={() => setEditing(false)}
              onSave={(text) => {
                setEditing(false);
                act("edit", text);
              }}
            />
          ) : (
            shown && (
              <div className="prose">
                {mine ? (
                  shown
                ) : (
                  <Rendered content={message.content} sources={sources} onOpen={open} />
                )}
                {streaming && <span className="caret" aria-hidden="true" />}
              </div>
            )
          )}

          {mine && <AttachmentList items={message.attachments} />}
        </Slip>

        {!mine && !live && sources.length > 0 && (
          <SourceStrip sources={sources} onOpen={() => open({ kind: "sources" })} />
        )}

        {message.stopped && (
          <p className="message-note">
            {message.content
              ? "You stopped this reply."
              : "You stopped this before Vaelo answered."}
            {canAct && message.content && (
              <button className="text-button" onClick={() => act("continue")}>
                Continue <ArrowRight size={14} />
              </button>
            )}
          </p>
        )}
        {message.truncated && (
          <p className="message-note">
            This reply reached its length limit.
            {canAct && (
              <button className="text-button" onClick={() => act("continue")}>
                Continue <ArrowRight size={14} />
              </button>
            )}
          </p>
        )}
        {message.interrupted && (
          <div className="message-error" role="alert">
            <p>{message.note}</p>
            {canAct && (
              <span className="message-error-actions">
                <button className="text-button" onClick={() => act("continue")}>
                  Continue from here <ArrowRight size={14} />
                </button>
                <button className="text-button" onClick={() => act("retry")}>
                  <ArrowClockwise size={15} /> Start over
                </button>
              </span>
            )}
          </div>
        )}
        {message.failed && (
          <div className="message-error" role="alert">
            <p>{message.note}</p>
            {(canAct || action.type === "signin") && (
              <button className="text-button" onClick={() => act(action.type)}>
                <action.icon size={15} />
                {action.label}
              </button>
            )}
          </div>
        )}

        {!editing && !live && (shown || versions) && (
          <div className="message-actions">
            {versions && (
              <span className="versions" aria-label="Versions of this reply">
                <button
                  className="icon-button small"
                  aria-label="Previous version"
                  title="Previous version"
                  disabled={busy || message.version === 0}
                  onClick={() => act("version", message.version - 1)}
                >
                  <CaretLeft size={14} />
                </button>
                <span>
                  {message.version + 1} / {versions.length}
                </span>
                <button
                  className="icon-button small"
                  aria-label="Next version"
                  title="Next version"
                  disabled={busy || message.version === versions.length - 1}
                  onClick={() => act("version", message.version + 1)}
                >
                  <CaretRight size={14} />
                </button>
              </span>
            )}
            {shown && (
              <button className="text-button" onClick={() => copy(shown)}>
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
            {!mine && long && (
              <button className="text-button" onClick={() => open({ kind: "document" })}>
                <ArrowsOut size={15} />
                Open
              </button>
            )}
            {!mine && message.content && !busy && (
              <button
                className="text-button"
                onClick={() => act("branch")}
                title="Start a new conversation from this point"
              >
                <GitBranch size={15} />
                Branch
              </button>
            )}
            {!mine && isLast && !busy && !message.failed && !message.interrupted && (
              <button className="text-button" onClick={() => act("retry")}>
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

/* Only the message that changed re-renders while words stream in. */
export const Message = memo(MessageView);
