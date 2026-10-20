import { readEvents } from "../stream.js";
import { classifyError } from "./errors.js";
import { cleanRevision, revisionPrompt } from "./library.js";
import { normalizeReplySpacing } from "./reply-spacing.js";
import { JOIN_WINDOW, joinOnto } from "./continuation.js";

/* Ask Vaelo to rewrite one passage. Each revision is its own short exchange
   with a fresh reference, so it never becomes part of the conversation's
   memory; the document's version history is where it lives. */
export async function requestRevision({ csrf, source, start, end, instruction, signal, onText }) {
  const response = await fetch("/api/chat", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf || "" },
    body: JSON.stringify({
      conversationId: crypto.randomUUID(),
      messages: [
        {
          role: "user",
          content: revisionPrompt({ source, start, end, instruction }),
          mode: { style: "concise", research: false },
        },
      ],
    }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw Object.assign(new Error(result.error || "Vaelo couldn’t revise that."), {
      status: response.status,
    });
  }
  let text = "";
  let completed = false;
  let joining = false, held = "";
  const release = () => {
    if (joining) text += joinOnto(text, held);
    joining = false;
    held = "";
  };
  await readEvents(response.body, (name, data) => {
    if (name === "jarvis.complete") { release(); completed = true; return false; }
    // The relay numbers every frame, so "[DONE]" arrives as data that isn't JSON.
    if (data == null) return;
    if (name === "jarvis.error") throw new Error(data.message || "Vaelo couldn’t revise that.");
    if (name === "jarvis.stopped") throw new Error("The revision was stopped before it finished.");
    if (name === "jarvis.retry") {
      text = "";
      held = "";
      joining = false;
      completed = false;
      onText?.("");
      return;
    }
    if (name === "jarvis.continue") { release(); joining = true; return; }
    const choice = data.choices?.[0];
    if (choice?.delta?.content) {
      if (joining) {
        held += choice.delta.content;
        if (held.length >= JOIN_WINDOW || choice.finish_reason) release();
      } else text += choice.delta.content;
      onText?.(normalizeReplySpacing(text));
    }
    if (choice?.finish_reason === "error" || (data.error && choice?.finish_reason !== "length"))
      throw new Error(data.error?.message || "Vaelo stopped before finishing.");
  }, undefined, signal);
  const revised = cleanRevision(normalizeReplySpacing(text));
  if (!completed || !revised) throw new Error("Vaelo didn’t send a revision back. Try again.");
  return revised;
}

export function revisionProblem(error) {
  if (error?.name === "AbortError") return "";
  return classifyError({ name: error?.name, message: error?.message, status: error?.status }).text;
}
