import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
  DotsThree,
  BookmarkSimple,
  Quotes,
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
import { Rolling } from "./Rolling.jsx";
import { Rendered, SourceStrip, imageTiles, useCopy, useSources } from "./blocks/Blocks.jsx";
import { summarizeSteps, toolDetail, toolInfo } from "../lib/tools.js";
import { LONG_QUIET_MS, QUIET_MS, afterStep, clock, stillLine } from "../lib/live.js";
import { formatSize } from "../lib/attachments.js";
import { isLongReply } from "../lib/library.js";
import { orderPlan, planSummary } from "../lib/plan.js";
import { buzz } from "../lib/haptics.js";
import { Sheet } from "./Sheet.jsx";
import "./message.css";
import { HoldButton } from "./HoldButton.jsx";
import { FileBadge, ContextMeter, UsageMeter, VersionTree } from './EverydayUI.jsx';
import { measuredUsage } from '../lib/everyday-ui.js';

/* Seconds since `from`, ticking once a second while `live`. */
function useNow(live) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  return now;
}

/* How long nothing on screen has changed, given what is on screen. */
function useQuiet(signature, now) {
  const [changedAt, setChangedAt] = useState(Date.now());
  useEffect(() => setChangedAt(Date.now()), [signature]);
  return Math.max(0, now - changedAt);
}

/* Making a picture, as opposed to looking at one */
const IMAGE_MAKERS = /image_gen|generate_image|create_image|imagine|text_to_image/i;

function makingImage(message) {
  return !!message.activity?.some((step) => !step.done && IMAGE_MAKERS.test(step.tool ?? step.name ?? ""));
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
function Steps({ items, now }) {
  return (
    <ol className="steps">
      {items.map((item) => {
        const tool = item.tool ?? item.name;
        const info = toolInfo(tool);
        const Icon = STEP_ICONS[info.kind] || Wrench;
        const detail = toolDetail(item);
        return (
          <li key={item.id} data-state={item.done ? "done" : "running"} title={item.label || tool}>
            <span className="steps-mark" aria-hidden="true" />
            <Icon size={15} aria-hidden="true" className="steps-icon" />
            <details className="steps-text tool-call-card">
              <summary>{item.done ? info.past : info.now}{detail && <span className="steps-detail"> · {detail.length > 90 ? `${detail.slice(0, 90)}…` : detail}</span>}</summary>
              <p>{detail || item.label || info.past}</p>
              <small>{item.done ? 'Finished' : 'In progress'}{item.done && item.endedAt && item.startedAt ? ` · ${seconds(item.endedAt - item.startedAt)}` : ''}</small>
            </details>
            <span className="sr-only">{item.done ? ", done" : ", in progress"}</span>
            {item.done && item.endedAt && item.startedAt && (
              <span className="steps-time">{seconds(item.endedAt - item.startedAt)}</span>
            )}
            {/* The running step keeps its own clock, so a slow page visibly
                ticks instead of sitting still. */}
            {!item.done && now && item.startedAt && now - item.startedAt >= 3000 && (
              <span className="steps-time" aria-hidden="true">
                {clock((now - item.startedAt) / 1000)}
              </span>
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
  if (context.work) parts.push(`workspace: ${context.work}`);
  const mode = [
    context.role && context.role !== "none" && `as ${context.role}`,
    context.research && "research",
    context.style && context.style !== "balanced" && `${context.style} style`,
  ]
    .filter(Boolean)
    .join(", ");
  const tokens =
    usage && (usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0));
  return (
    <>
      <ContextMeter context={context} />
      <UsageMeter usage={usage} />
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
      {tokens > 0 && !measuredUsage(usage) && (
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

function LiveReasoning({ text }) {
  const panel = useRef(null);
  const following = useRef(true);
  useLayoutEffect(() => {
    if (following.current && panel.current) panel.current.scrollTop = panel.current.scrollHeight;
  }, [text]);
  return <p ref={panel} className="reasoning-text" tabIndex={0} onScroll={() => {
    const element = panel.current;
    following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
  }}>{text}</p>;
}

/* The one plain sentence for what Vaelo is doing right now. Shared by the
   reply's live line and the "jump to latest" pill, so status reads the same
   wherever you are looking. */
export function liveLine(message, phase, quietMs = 0) {
  const steps = message?.activity || [];
  const running = steps.findLast?.((item) => !item.done);
  const quiet = quietMs >= QUIET_MS;
  if (message?.approval?.state === "pending") return "Waiting for your answer";
  if (phase === "waking") return "Waking up. This can take a minute";
  if (message?.content && phase === "speaking") return "Writing";
  if (running) {
    if (quiet) return stillLine(running);
    const detail = toolDetail(running);
    return `${toolInfo(running.tool ?? running.name).now}${detail ? ` · ${detail}` : ""}`;
  }
  if (message?.live) return message.live;
  const line = steps.length ? afterStep(steps.at(-1)) : message?.reasoning ? "Thinking it through" : "Thinking";
  return quiet ? `Still ${line[0].toLowerCase()}${line.slice(1)}` : line;
}

/* The live line changes in place: the new words rise in as the old ones
   leave, and the line's width eases to fit, so the timer beside it glides
   rather than jumps. */
function LiveLine({ text }) {
  const [lines, setLines] = useState([{ text, key: 0 }]);
  const [width, setWidth] = useState();
  const current = useRef(null);

  useEffect(() => {
    setLines((list) => {
      const top = list[list.length - 1];
      if (top.text === text) return list;
      return [{ ...top, leaving: true }, { text, key: top.key + 1 }];
    });
  }, [text]);

  useEffect(() => {
    if (lines.length < 2) return;
    const timer = setTimeout(() => setLines((list) => list.filter((line) => !line.leaving)), 340);
    return () => clearTimeout(timer);
  }, [lines]);

  useLayoutEffect(() => {
    /* Measure the intrinsic text, rather than its stretched grid cell. */
    if (current.current) setWidth(current.current.getBoundingClientRect().width + 1);
  }, [lines]);

  return (
    <span className="live-line" style={{ width }} title={text}>
      {lines.map((line) => (
        <span
          key={line.key}
          ref={line.leaving ? undefined : current}
          className="process-line shimmer"
          data-leaving={line.leaving || undefined}
          aria-hidden={line.leaving || undefined}
        >
          {line.text}
        </span>
      ))}
    </span>
  );
}

/* What Vaelo is doing, said once, in the place it is happening. While it
   works this is a live line; afterwards it folds into a quiet receipt
   ("Worked for 12s · Searched the web 3×") that opens to the steps. */
function Process({ message, live, phase }) {
  const [open, setOpen] = useState(false);
  const now = useNow(live);
  const elapsed = message.startedAt ? Math.max(0, Math.round((now - message.startedAt) / 1000)) : 0;
  const steps = message.activity || [];
  const running = steps.findLast?.((item) => !item.done);
  /* Anything new on screen (a step, a thought, a word, a note) resets the
     quiet clock; only a real lull turns the line into "Still …". */
  const signature = [
    liveLine(message, phase),
    steps.length,
    steps.filter((item) => item.done).length,
    message.reasoning?.length || 0,
    message.content?.length || 0,
    message.notes?.length || 0,
  ].join("|");
  const quietMs = useQuiet(signature, now);

  if (live) {
    const line = liveLine(message, phase, quietMs);
    const sub =
      running && message.live
        ? message.live
        : (quietMs >= LONG_QUIET_MS && phase !== "waking" && message.approval?.state !== "pending"
            ? "Some steps take a minute or two on the free models. Vaelo is still connected and working."
            : "");
    return (
      <div className="process" data-live="true">
        <button className="process-head process-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
          <LiveLine text={line} />
          {elapsed >= 3 && <span className="process-time">{clock(elapsed)}</span>}
          <CaretDown size={13} />
        </button>
        {sub && (
          <span className="process-sub" key={sub}>
            {sub}
          </span>
        )}
        {open && <div className="process-detail">
          {message.reasoning ? <LiveReasoning text={message.reasoning} /> : <p className="process-sub">Waiting for thinking updates…</p>}
          {steps.length > 0 && <Steps items={steps} now={now} />}
        </div>}
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
        <span className="process-receipt-text">{parts.join(" · ")}</span>
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

const still = () =>
  document.documentElement.dataset.motion === "reduce" ||
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Said in words as well as shape: the visible word where the state is
   unusual, a spoken one where the mark and the strike already show it. */
const PLAN_WORDS = {
  pending: { spoken: ", to do" },
  in_progress: { shown: "now" },
  completed: { spoken: ", done" },
  cancelled: { shown: "dropped" },
};

/* Hermes's plan for this reply, kept as a ledger. Finished items are struck
   through and settle beneath the open ones; each row glides to its new place
   rather than jumping (FLIP, measured against the list itself). */
function Plan({ plan }) {
  const items = orderPlan(plan?.items);
  const rows = useRef(new Map());
  const places = useRef(new Map());

  useLayoutEffect(() => {
    const moving = !still();
    const ease = getComputedStyle(document.documentElement).getPropertyValue("--ease").trim() || "ease";
    for (const [id, row] of rows.current) {
      const top = row.offsetTop;
      const before = places.current.get(id);
      places.current.set(id, top);
      if (moving && before !== undefined && before !== top)
        row.animate([{ transform: `translateY(${before - top}px)` }, { transform: "none" }], {
          duration: 520,
          easing: ease,
        });
    }
  });

  if (!items.length) return null;
  const done = items.filter((item) => item.status === "completed").length;
  return (
    <section className="plan" aria-label={`Plan, ${planSummary(items)}`}>
      <p className="plan-head" aria-hidden="true">
        <span className="label">Plan</span>
        <span className="plan-count">
          <Rolling value={done} /> of {items.length} done
        </span>
      </p>
      <ol className="plan-list">
        {items.map((item) => {
          const words = PLAN_WORDS[item.status];
          return (
            <li
              key={item.id}
              ref={(row) => (row ? rows.current.set(item.id, row) : rows.current.delete(item.id))}
              data-state={item.status}
              data-nested={item.parent ? "true" : undefined}
            >
              <span className="plan-mark" aria-hidden="true">
                {item.status === "completed" && <Check size={10} weight="bold" />}
              </span>
              <span className="plan-text">
                <span className="plan-words">{item.content}</span>
              </span>
              {words.shown && <span className="plan-state">{words.shown}</span>}
              {words.spoken && <span className="sr-only">{words.spoken}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Edit({ initial, onSave, onCancel }) {
  const [value, setValue] = useState(initial);
  const field = useRef(null);
  useLayoutEffect(() => {
    const el = field.current;
    const scrollTop = el.scrollTop;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    el.scrollTop = scrollTop;
  }, [value]);
  useEffect(() => {
    const el = field.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // The bounded editor opens at the caret, including for long messages.
    el.scrollTop = el.scrollHeight;
    // Include the actions when the surrounding conversation scrolls into view.
    el.form.scrollIntoView({ block: "end", behavior: "instant" });
  }, []);
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
        dir="auto"
        aria-label="Edit your message"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // Enter that confirms an input method's candidate belongs to it.
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
          /* As in the composer: on a touch screen return is a new line, and
             Send is the button. */
          if (event.key === "Enter" && !event.shiftKey && !matchMedia("(pointer: coarse)").matches) {
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

export const AttachmentList = memo(function AttachmentList({ items, onRemove }) {
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
            <FileBadge name={file.name} kind={file.kind} />
          )}
          <span className="attachment-name" title={file.name}>{file.name}</span>
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
              data-tip="Remove"
              onClick={() => onRemove(file.id)}
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
});

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
          {(approval.choices?.length ? approval.choices : ["once", "deny"]).map((choice) =>
            /* Allowing for the whole conversation reaches further than one
               action, so it asks for a held press rather than a click */
            choice === "session" ? (
              <HoldButton
                key={choice}
                className="approval-allow"
                disabled={state === "sending"}
                holding="Keep holding to allow…"
                onConfirm={() => onAnswer(choice)}
              >
                {state === "sending" && approval.choice === choice ? "Sending…" : APPROVAL_LABELS[choice]}
              </HoldButton>
            ) : (
            <button
              key={choice}
              className={choice === "deny" ? "approval-deny" : "approval-allow"}
              disabled={state === "sending"}
              onClick={() => onAnswer(choice)}
            >
              {state === "sending" && approval.choice === choice ? "Sending…" : APPROVAL_LABELS[choice]}
            </button>
            ),
          )}
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

/* Holding a message for half a second opens what can be done with it; a
   finger that moves more than a few pixels is scrolling instead. Links,
   buttons and fields keep their own touch. Right-click does the same. */
const HOLD_MS = 480;
const HOLD_SLOP = 8;
const OWN_TOUCH = "a, button, input, textarea, select, summary, label, pre, [contenteditable], .table-scroll";

function useHold(enabled, onHold) {
  const timer = useRef(0);
  const origin = useRef(null);
  const hold = useRef(onHold);
  hold.current = onHold;
  const stop = () => clearTimeout(timer.current);
  useEffect(() => stop, []);
  if (!enabled) return {};
  return {
    onPointerDown(event) {
      /* A sheet rises from inside the message but is not part of it */
      if (event.button > 0 || !event.currentTarget.contains(event.target) || event.target.closest?.(OWN_TOUCH)) return;
      origin.current = [event.clientX, event.clientY];
      stop();
      timer.current = setTimeout(() => {
        buzz();
        hold.current();
      }, HOLD_MS);
    },
    onPointerMove(event) {
      const from = origin.current;
      if (from && Math.hypot(event.clientX - from[0], event.clientY - from[1]) > HOLD_SLOP) stop();
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onContextMenu(event) {
      if (!event.currentTarget.contains(event.target) || event.target.closest?.("a, input, textarea")) return;
      event.preventDefault();
      stop();
      hold.current();
    },
  };
}

/* Words with their Markdown marks taken off, for quoting a message */
function plainWords(text = "") {
  return String(text)
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/\s*\[\[?\d+\]?\]\([^)]*\)/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* The reply's sources as one pill: up to three overlapping initials and a
   count. Tapping it opens them in a sheet. */
function SourcesPill({ sources, onOpen }) {
  return (
    <button className="sources-pill" onClick={onOpen} aria-label={`Show ${sources.length} ${sources.length === 1 ? "source" : "sources"}`}>
      <span className="sources-pill-dots" aria-hidden="true">
        {sources.slice(0, 3).map((source) => (
          <span key={source.id}>{source.domain.charAt(0).toUpperCase()}</span>
        ))}
      </span>
      <span>
        {sources.length} {sources.length === 1 ? "source" : "sources"}
      </span>
    </button>
  );
}

function MessageView({ message, requestText = "", requestImages, fresh, busy, live, streaming, phase, isLast, edited, onAction, phone = false, offline = false }) {
  const [copied, copy] = useCopy();
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const editButton = useRef(null);
  const leftEditing = useRef(false);
  /* Leaving the editor returns focus to Edit, not to the top of the page. */
  useEffect(() => {
    if (editing) leftEditing.current = true;
    else if (leftEditing.current) {
      leftEditing.current = false;
      editButton.current?.focus();
    }
  }, [editing]);
  const mine = message.role === "user";
  const waiting = live && !message.content;
  const versions = message.versions?.length > 1 ? message.versions : null;
  const sources = useSources(mine ? "" : message.content);
  const act = useCallback((type, payload) => onAction(type, message.id, payload), [onAction, message.id]);
  const open = useCallback((item) => act("open", item), [act]);
  const canAct = isLast && !busy;
  const long = !mine && isLongReply(message.content || "");
  const face = streaming
    ? "speaking"
    : waiting
      ? phase
      : message.failed || message.interrupted
        ? "concern"
        : "idle";
  const action = message.failed && ERROR_ACTION[message.errorKind || "unknown"];
  const shown = mine ? (message.text ?? message.content) : message.content;
  const holdable = phone && !live && !editing && !!shown;
  const hold = useHold(holdable, () => setMenu(true));
  const savedWork = long || edited;

  return (
    <article
      id={`m-${message.id}`}
      className="message"
      data-role={message.role}
      data-fresh={fresh || undefined}
      data-last={isLast || undefined}
      data-failed={message.failed || undefined}
      data-editing={editing || undefined}
      data-phone={phone || undefined}
      aria-label={mine ? "Your message" : "Vaelo"}
      {...hold}
    >
      <div className="message-label">
        {!mine && <Mark size={phone ? 20 : 22} state={face} />}
        <span className="label">{mine ? "You" : "Vaelo"}</span>
      </div>
      <div className="message-body">
        {!mine && <Process message={message} live={live && !streaming} phase={phase} />}
        {!mine && <Plan plan={message.plan} />}
        {!mine && live && makingImage(message) && (
          <>
            <div className="image-pending" role="img" aria-label="Making the image">
              {imageTiles("image-pending-tile")}
            </div>
            <p className="image-pending-caption" aria-hidden="true">
              Making the image
            </p>
          </>
        )}

        {message.approval && (
          <Approval
            approval={message.approval}
            canAct={canAct}
            onAnswer={(choice) => act("approve", choice)}
            onAlternative={() => act("alternative")}
          />
        )}


        {/* On a phone a file sits above the slip it was sent with */}
        {mine && phone && !editing && <AttachmentList items={message.attachments} />}

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
              <div className="prose" dir={mine ? "auto" : undefined}>
                {mine ? (
                  shown
                ) : (
                  <Rendered requestText={requestText} attached={requestImages} stateKey={message.id} content={message.content} sources={sources} onOpen={open} onAnswer={canAct ? text => act('answer', text) : undefined} live={live} />
                )}
                {streaming && <span className="caret" aria-hidden="true" />}
              </div>
            )
          )}

          {mine && (!phone || editing) && <AttachmentList items={message.attachments} />}
        </Slip>

        {!mine && !phone && sources.length > 0 && (
          <SourceStrip
            sources={sources}
            arriving={live || fresh}
            onOpen={() => open({ kind: "sources" })}
          />
        )}

        {message.stopped && (
          <p className="message-note">
            {message.content
              ? "You stopped this reply."
              : "You stopped this before Vaelo answered."}
            {canAct && message.content && (
              <button className="text-button" disabled={offline} onClick={() => act("continue")}>
                Continue <ArrowRight size={14} />
              </button>
            )}
          </p>
        )}
        {message.truncated && (
          <p className="message-note">
            This reply reached its length limit.
            {canAct && (
              <button className="text-button" disabled={offline} onClick={() => act("continue")}>
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
                <button className="text-button" disabled={offline} onClick={() => act("continue")}>
                  Continue from here <ArrowRight size={14} />
                </button>
                <button className="text-button" disabled={offline} onClick={() => act("retry")}>
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
              <button className="text-button" disabled={offline && action.type === "retry"} onClick={() => act(action.type)}>
                <action.icon size={15} />
                {action.label}
              </button>
            )}
          </div>
        )}

        {/* On a phone a reply ends with its sources, then three round buttons;
            everything else is behind the long press or the third one. Your
            own message has no row: hold it. */}
        {phone && !mine && !editing && !live && shown && (
          <div className="message-actions message-actions-phone">
            {versions && (
              <span className="versions" aria-label="Versions of this reply">
                <button
                  className="icon-button small"
                  aria-label="Previous version"
                  disabled={busy || message.version === 0}
                  onClick={() => act("version", message.version - 1)}
                >
                  <CaretLeft size={14} />
                </button>
                <span>
                  <Rolling value={message.version + 1} /> / {versions.length}
                </span>
                <button
                  className="icon-button small"
                  aria-label="Next version"
                  disabled={busy || message.version === versions.length - 1}
                  onClick={() => act("version", message.version + 1)}
                >
                  <CaretRight size={14} />
                </button>
              </span>
            )}
            {sources.length > 0 && <SourcesPill sources={sources} onOpen={() => open({ kind: "sources" })} />}
            <button className="round-action" aria-label={copied ? "Copied" : "Copy"} onClick={() => copy(shown)}>
              {copied ? <Check size={19} /> : <Copy size={19} />}
            </button>
            {isLast && !busy && !message.failed && !message.interrupted && (
              <button className="round-action" aria-label="Try again" disabled={offline} onClick={() => act("retry")}>
                <ArrowClockwise size={19} />
              </button>
            )}
            <button className="round-action" aria-label="More" aria-haspopup="dialog" onClick={() => setMenu(true)}>
              <DotsThree size={19} />
            </button>
          </div>
        )}

        {!mine && !editing && !live && versions && <VersionTree versions={versions} current={message.version} onSelect={index => act('version', index)} disabled={busy} />}
        {!phone && !editing && !live && (shown || versions) && (
          <div className="message-actions">
            {versions && (
              <span className="versions" aria-label="Versions of this reply">
                <button
                  className="icon-button small"
                  aria-label="Previous version"
                  data-tip="Previous version"
                  disabled={busy || message.version === 0}
                  onClick={() => act("version", message.version - 1)}
                >
                  <CaretLeft size={14} />
                </button>
                <span>
                  <Rolling value={message.version + 1} /> / {versions.length}
                </span>
                <button
                  className="icon-button small"
                  aria-label="Next version"
                  data-tip="Next version"
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
              <button ref={editButton} className="text-button" onClick={() => setEditing(true)}>
                <PencilSimple size={15} />
                Edit
              </button>
            )}
            {!mine && (long || edited) && (
              <button
                className="text-button"
                onClick={() => open({ kind: "document" })}
                data-tip={edited ? "Open the edited document" : "Open as a document you can edit"}
              >
                <ArrowsOut size={15} />
                {edited ? "Open · edited" : "Open"}
              </button>
            )}
            {!mine && message.content && !busy && (
              <button
                className="text-button"
                onClick={() => act("branch")}
                data-tip="Start a new conversation from this point"
              >
                <GitBranch size={15} />
                Branch
              </button>
            )}
            {!mine && isLast && !busy && !message.failed && !message.interrupted && (
              <button className="text-button" disabled={offline} onClick={() => act("retry")}>
                <ArrowClockwise size={15} />
                Try again
              </button>
            )}
          </div>
        )}
      </div>

      {phone && (
        <Sheet open={menu} onClose={() => setMenu(false)} label={mine ? "Your message" : "Reply"}>
          {shown && <p className="sh-quote">{plainWords(shown)}</p>}
          <div className="sh-rows">
            <button
              className="sh-row"
              onClick={() => {
                copy(shown);
                setMenu(false);
              }}
            >
              <Copy size={22} />
              <span className="sh-row-text">Copy</span>
            </button>
            {mine && !busy && (
              <button
                className="sh-row"
                onClick={() => {
                  setMenu(false);
                  setEditing(true);
                }}
              >
                <PencilSimple size={22} />
                <span className="sh-row-text">Edit and resend</span>
              </button>
            )}
            {!mine && isLast && !busy && !message.failed && !message.interrupted && (
              <button
                className="sh-row"
                disabled={offline}
                onClick={() => {
                  setMenu(false);
                  act("retry");
                }}
              >
                <ArrowClockwise size={22} />
                <span className="sh-row-text">
                  Retry
                  <span className="sh-row-note">Keeps this version</span>
                </span>
              </button>
            )}
            {!mine && message.content && (
              <button
                className="sh-row"
                onClick={() => {
                  setMenu(false);
                  open({ kind: "document" });
                }}
              >
                <BookOpenText size={22} />
                <span className="sh-row-text">{edited ? "Open the edited document" : "Open as a document"}</span>
              </button>
            )}
            {!mine && message.content && !savedWork && (
              <button
                className="sh-row"
                onClick={() => {
                  setMenu(false);
                  act("keep");
                }}
              >
                <BookmarkSimple size={22} />
                <span className="sh-row-text">Save to Library</span>
              </button>
            )}
            {!mine && sources.length > 0 && (
              <button
                className="sh-row"
                onClick={() => {
                  setMenu(false);
                  open({ kind: "sources" });
                }}
              >
                <Quotes size={22} />
                <span className="sh-row-text">Show sources</span>
              </button>
            )}
            {!mine && message.content && !busy && (
              <button
                className="sh-row"
                onClick={() => {
                  setMenu(false);
                  act("branch");
                }}
              >
                <GitBranch size={22} />
                <span className="sh-row-text">
                  Branch from here
                  <span className="sh-row-note">A new conversation that starts at this point</span>
                </span>
              </button>
            )}
          </div>
        </Sheet>
      )}
    </article>
  );
}

/* Only the message that changed re-renders while words stream in. */
export const Message = memo(MessageView);
