import React, { useEffect, useRef, useState } from "react";
import {
  ArrowBendUpLeft,
  CaretLeft,
  CaretRight,
  Check,
  PencilSimple,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import { Rendered, useSources } from "./blocks/Blocks.jsx";
import { Contents } from "./Contents.jsx";
import { Rolling } from "./Rolling.jsx";
import { PASSAGE_LIMIT, addVersion, currentContent, spliceSource } from "../lib/library.js";
import { revisionProblem } from "../lib/revise.js";

/* A reply worth keeping becomes a document you can work on: read it, edit
   it directly, or select a passage and tell Vaelo how it should change.
   Every change is a version, so nothing is ever lost to an edit. */

const QUICK = ["Make it shorter", "Make it clearer", "More formal", "More detail"];

function byline(version, index) {
  if (!version) return "";
  const when = new Date(version.at).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  if (index === 0) return "As Vaelo wrote it";
  if (version.by === "you") return `Edited by you · ${when}`;
  return `Revised by Vaelo${version.note ? `: “${version.note}”` : ""} · ${when}`;
}

/* The selection, traced to whole blocks of the Markdown behind it */
function rangeFromSelection(article) {
  const selection = getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const element = (node) => (node?.nodeType === 1 ? node : node?.parentElement);
  const ends = [selection.anchorNode, selection.focusNode].map((node) =>
    element(node)?.closest("[data-src]"),
  );
  if (ends.some((el) => !el || !article.contains(el))) return null;
  const spans = ends.map((el) => el.dataset.src.split(":").map(Number));
  return {
    start: Math.min(spans[0][0], spans[1][0]),
    end: Math.max(spans[0][1], spans[1][1]),
  };
}

function Revise({ source, range, disabled, onRevise, onAccept, onClear }) {
  const [instruction, setInstruction] = useState("");
  const [state, setState] = useState({ phase: "ask" });
  const controller = useRef(null);
  const field = useRef(null);
  const passage = source.slice(range.start, range.end);
  const tooLong = passage.length > PASSAGE_LIMIT;

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    controller.current?.abort();
    setState({ phase: "ask" });
  }, [range.start, range.end]);

  async function run(text = instruction) {
    const asked = text.trim();
    if (!asked || disabled || tooLong) return;
    setInstruction(asked);
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setState({ phase: "working", text: "" });
    try {
      const revised = await onRevise({
        source,
        start: range.start,
        end: range.end,
        instruction: asked,
        signal: abort.signal,
        onText: (text) => setState({ phase: "working", text }),
      });
      setState({ phase: "proposal", text: revised, instruction: asked });
    } catch (error) {
      const problem = revisionProblem(error);
      setState(problem ? { phase: "ask", problem } : { phase: "ask" });
    }
  }

  return (
    <div className="revise" role="region" aria-label="Revise with Vaelo">
      <div className="revise-head">
        <span className="label">Revising</span>
        <span className="revise-quote">{passage.replace(/[#*_`>|]/g, "").trim()}</span>
        <button className="icon-button small" aria-label="Stop revising" onClick={onClear}>
          <X size={16} />
        </button>
      </div>

      {state.phase === "ask" && (
        <>
          {tooLong ? (
            <p className="revise-note" data-tone="problem">
              That’s a long passage. Select a few paragraphs at most.
            </p>
          ) : (
            <form
              className="revise-ask"
              onSubmit={(event) => {
                event.preventDefault();
                run();
              }}
            >
              <input
                ref={field}
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="How should this change?"
                aria-label="How should this passage change?"
                maxLength={500}
              />
              <button
                type="submit"
                className="revise-go"
                disabled={!instruction.trim() || disabled}
              >
                <Sparkle size={16} weight="fill" aria-hidden="true" /> Revise
              </button>
            </form>
          )}
          {!tooLong && (
            <div className="revise-quick">
              {QUICK.map((text) => (
                <button key={text} className="chip" disabled={disabled} onClick={() => run(text)}>
                  {text}
                </button>
              ))}
            </div>
          )}
          {disabled && (
            <p className="revise-note">Vaelo is busy with a reply. Revising opens up once it’s done.</p>
          )}
          {state.problem && (
            <p className="revise-note" data-tone="problem" role="alert">
              {state.problem}
            </p>
          )}
        </>
      )}

      {state.phase === "working" && (
        <div className="revise-preview" aria-busy="true">
          <p className="revise-status shimmer">Revising{state.text ? "" : "…"}</p>
          {state.text && <div className="prose revise-text">{state.text}</div>}
          <button className="text-button" onClick={() => controller.current?.abort()}>
            Stop
          </button>
        </div>
      )}

      {state.phase === "proposal" && (
        <div className="revise-preview">
          <p className="label">Proposed</p>
          <div className="prose revise-text">
            <Rendered content={state.text} sources={[]} onOpen={() => {}} />
          </div>
          <div className="revise-actions">
            <button className="revise-go" onClick={() => onAccept(state.text, state.instruction)}>
              <Check size={16} weight="bold" /> Accept
            </button>
            <button className="text-button" onClick={() => run(state.instruction)} disabled={disabled}>
              Try again
            </button>
            <button className="text-button" onClick={() => setState({ phase: "ask" })}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DocumentWork({ message, work, onWorkChange, onOpen, onReveal, canRevise, onRevise }) {
  const content = currentContent(work, message?.content ?? "");
  const original = work?.versions?.[0]?.content ?? message?.content ?? "";
  const sources = useSources(content);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [range, setRange] = useState(null);
  const article = useRef(null);
  const field = useRef(null);
  const versions = work?.versions || [];
  const at = work?.current ?? 0;

  /* Selecting inside the document picks the passage to revise. Leaving the
     selection (to type the instruction) keeps it. */
  useEffect(() => {
    if (editing) return;
    let timer = 0;
    const pick = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = article.current && rangeFromSelection(article.current);
        if (next) setRange(next);
      }, 220);
    };
    document.addEventListener("selectionchange", pick);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", pick);
    };
  }, [editing]);

  /* The picked blocks are marked in the page, so it's clear what will change */
  useEffect(() => {
    const root = article.current;
    if (!root) return;
    for (const el of root.querySelectorAll("[data-src]")) {
      const [start, end] = el.dataset.src.split(":").map(Number);
      const picked = range && start >= range.start && end <= range.end;
      if (picked) el.dataset.picked = "";
      else delete el.dataset.picked;
    }
  }, [range, content, editing]);

  useEffect(() => {
    setRange(null);
    setEditing(false);
  }, [message?.id, at]);

  useEffect(() => {
    if (!editing) return;
    const el = field.current;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing, draft]);

  function commit(next, by, note) {
    if (next === content) return;
    onWorkChange(addVersion(work, original, next, by, note));
  }

  if (!message && !work)
    return <p className="ws-empty">This reply is no longer in the conversation.</p>;

  return (
    <>
      <div className="doc-bar">
        {versions.length > 1 ? (
          <span className="doc-versions" aria-label="Versions of this document">
            <button
              className="icon-button small"
              aria-label="Earlier version"
              data-tip="Earlier version"
              disabled={editing || at === 0}
              onClick={() => onWorkChange({ ...work, current: at - 1 })}
            >
              <CaretLeft size={14} />
            </button>
            <span className="doc-version-count">
              <Rolling value={at + 1} /> / {versions.length}
            </span>
            <button
              className="icon-button small"
              aria-label="Later version"
              data-tip="Later version"
              disabled={editing || at === versions.length - 1}
              onClick={() => onWorkChange({ ...work, current: at + 1 })}
            >
              <CaretRight size={14} />
            </button>
            <span className="doc-byline">{byline(versions[at], at)}</span>
          </span>
        ) : (
          <span className="doc-byline">Select a passage to revise it, or edit it yourself.</span>
        )}
        <span className="doc-tools">
          {!editing && message && onReveal && (
            <button className="block-tool" onClick={onReveal} data-tip="Show this reply in its conversation">
              <ArrowBendUpLeft size={15} /> <span>In conversation</span>
            </button>
          )}
          {!editing && (
            <button
              className="block-tool"
              onClick={() => {
                setDraft(content);
                setRange(null);
                setEditing(true);
              }}
            >
              <PencilSimple size={15} /> <span>Edit</span>
            </button>
          )}
        </span>
      </div>

      {editing ? (
        <form
          className="doc-edit"
          onSubmit={(event) => {
            event.preventDefault();
            commit(draft.trim(), "you");
            setEditing(false);
          }}
        >
          <textarea
            ref={field}
            value={draft}
            aria-label="Document text, in Markdown"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setEditing(false);
              }
              if (event.key === "s" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                event.currentTarget.form.requestSubmit();
              }
            }}
            autoFocus
          />
          <div className="doc-edit-actions">
            <span className="doc-byline">Markdown · saving keeps the earlier version</span>
            <button type="button" className="text-button" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="revise-go" disabled={!draft.trim() || draft.trim() === content}>
              Save version
            </button>
          </div>
        </form>
      ) : (
        <div className="doc-page">
          <article className="ws-document prose" ref={article}>
            <Rendered content={content} sources={sources} onOpen={onOpen} mapped />
          </article>
          <Contents article={article} content={content} />
        </div>
      )}

      {!editing && range && (
        <Revise
          source={content}
          range={range}
          disabled={!canRevise}
          onRevise={onRevise}
          onClear={() => {
            setRange(null);
            getSelection()?.removeAllRanges();
          }}
          onAccept={(text, instruction) => {
            commit(spliceSource(content, range.start, range.end, text), "vaelo", instruction);
            setRange(null);
            getSelection()?.removeAllRanges();
          }}
        />
      )}
    </>
  );
}
