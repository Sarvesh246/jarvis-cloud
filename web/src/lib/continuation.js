/* When a reply is cut off partway (a provider failing mid-answer, Vaelo
   restarting), the model is asked to carry on from where it stopped. These
   are the words for that request, and the stitching that makes the two
   halves read as one reply. */

import { clipReply, fitHistory } from './attachments.js';
import { CONTEXT_POLICY } from '../../shared/context-policy.js';

export const CONTINUE_NOTE =
  "[Vaelo request: your reply above was cut off partway. Continue it from exactly where it stops: don't repeat anything already written, don't start over, and don't mention the interruption. Use more tool calls only if the rest truly depends on them.]";

/* Enough of the continuation to recognise a repeated opening before any of
   it is shown. */
export const JOIN_WINDOW = 160;

/* Models told to continue often restate the last few words first. Whatever
   of `next` repeats the end of `text` is dropped, so the reader sees the
   sentence carry on rather than stutter. */
export function joinOnto(text, next) {
  const end = text.trimEnd();
  if (!end || !next) return next;
  const lead = next.length - next.trimStart().length;
  const body = next.slice(lead);
  /* The opening of `next` repeats the end of `text`, in whole words. */
  for (let k = Math.min(body.length, end.length, 400); k >= 4; k -= 1) {
    const repeat = body.slice(0, k);
    if (
      repeat.trim() === repeat &&
      end.endsWith(repeat) &&
      !/\w/.test(body[k] || " ") &&
      !/\w/.test(end[end.length - k - 1] || " ")
    )
      return body.slice(k);
  }
  /* Or it repeats the last stretch of `text` a little way in, after a
     short lead-in such as "…" or a restated heading. */
  const recent = end.slice(-48);
  const tail = recent.slice(recent.indexOf(" ") + 1);
  if (tail.length >= 20) {
    const at = body.indexOf(tail);
    if (at >= 0 && at < 300) return body.slice(at + tail.length);
  }
  return next;
}

/* `note` added to the end of a message's text, whatever its shape. */
export function addNote(content, note) {
  if (typeof content === "string") return `${content}\n\n${note}`;
  const parts = [...content];
  const at = parts.findIndex((part) => part.type === "text");
  if (at < 0) return [{ type: "text", text: note }, ...parts];
  parts[at] = { ...parts[at], text: `${parts[at].text}\n\n${note}` };
  return parts;
}

/* A new request that carries a cut-off reply on: the conversation, the
   partial answer in the assistant's own voice, then the request to go on. */
export function continueRequest(request, answer, runId) {
  const last = request.messages.findLast((message) => message.role === "user");
  return {
    ...request,
    runId,
    messages: fitHistory([
      ...request.messages,
      { role: "assistant", content: clipReply(answer, Math.min(CONTEXT_POLICY.replyChars,
        CONTEXT_POLICY.historyChars - (typeof last?.content === 'string' ? last.content.length : CONTEXT_POLICY.messageChars) - 2_000)) },
      {
        role: "user",
        content: CONTINUE_NOTE,
        ...(last?.mode && { mode: last.mode }),
      },
    ]).messages,
  };
}

/* A new request for a reply that was interrupted before any of the answer
   was written: the same question, with what was already looked into. */
export function retryRequest(request, done, runId) {
  const used = done.length
    ? ` You had already used: ${done.slice(0, 12).join("; ")}.`
    : "";
  const note = `[Vaelo request: your previous attempt at this message was interrupted before you wrote the answer.${used} Pick up from there and write the full answer; don't mention the interruption.]`;
  const messages = [...request.messages];
  const at = messages.findLastIndex((message) => message.role === "user");
  let content = messages[at].content;
  // Reserve room for the recovery instruction even when the original message
  // was at its limit. Any shortened text keeps both ends and marks the gap.
  const room = CONTEXT_POLICY.messageChars - note.length - 2;
  if (typeof content === 'string') content = clipReply(content, room);
  else content = content.map(part => part.type === 'text' ? { ...part, text: clipReply(part.text, room) } : part);
  messages[at] = {
    ...messages[at],
    content: addNote(content, note),
  };
  return { ...request, runId, messages: fitHistory(messages).messages };
}
