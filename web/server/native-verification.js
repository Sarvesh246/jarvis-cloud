import { ChatStore, MAX_PARTS, checkId } from "./chat-store.js";
import { runCheck } from "./check-engine.js";
import { digest } from "./checks/verifier.js";
import { currentContent, docTitle } from "../src/lib/library.js";
import { HttpError } from "./security.js";

export async function readNativeDocument(sub, source, { storeFactory = account => new ChatStore(account) } = {}) {
  if (typeof sub !== "string" || !sub) throw new HttpError(401, "Sign in to read a saved document.");
  if (!source || source.kind !== "vaelo-document") throw new HttpError(400, "Choose a saved Vaelo document.");
  checkId(source.conversationId); checkId(source.messageId);
  const store = storeFactory(sub);
  const manifest = await store.manifest();
  const entry = manifest.data.entries[source.conversationId];
  if (!entry || entry.deleted) throw new HttpError(404, "That document’s chat was deleted, so it can’t be checked.");
  if (!Number.isInteger(entry.parts) || entry.parts < 1 || entry.parts > MAX_PARTS) throw new HttpError(503, "Vaelo couldn’t read that document. Please try again.");
  const chunks = [];
  let length = 0;
  for (let part = 0; part < entry.parts; part++) {
    const text = await store.part(source.conversationId, entry.version, part);
    length += text.length;
    if (length > 2_000_000) throw new HttpError(413, "That chat is too long to check.");
    chunks.push(text);
  }
  let chat;
  try { chat = JSON.parse(chunks.join("")); }
  catch { throw new HttpError(503, "Vaelo couldn’t read that document. Please try again."); }
  if (chat.id !== source.conversationId || !Array.isArray(chat.messages)) throw new HttpError(503, "Vaelo couldn’t read that document. Please try again.");
  const message = chat.messages.find(item => item.id === source.messageId && item.role === "assistant");
  if (!message && !chat.works?.[source.messageId]) throw new HttpError(404, "That document couldn’t be found.");
  if (!message) {
    const saved=chat.works[source.messageId];
    if (typeof saved.versions?.[saved.current]?.content !== "string") throw new HttpError(503, "Vaelo couldn’t read that document. Please try again.");
  }
  const text = currentContent(chat.works?.[source.messageId], message?.content);
  if (typeof text !== "string") throw new HttpError(503, "Vaelo couldn’t read that document. Please try again.");
  const latest = (await store.manifest()).data.entries[source.conversationId];
  if (latest?.deleted || latest?.version !== entry.version) throw new HttpError(409, "The document changed while Vaelo was checking it. Please try again.");
  return { text, title: docTitle(text, chat.title), version: entry.version };
}

export async function runWorkCheck(id, input, { sub, now = Date.now(), readDocument = readNativeDocument } = {}) {
  if (id !== "document" || !input?.source) return runCheck(id, input, { now });
  const source = input.source;
  if (!source || typeof source !== "object" || source.kind !== "vaelo-document" || Object.keys(source).some(key => !["kind", "conversationId", "messageId"].includes(key)))
    throw new HttpError(400, "Open the document in a conversation and tap Verify, then run this check.");
  const resource = { kind: "document", id: `${source.conversationId}:${source.messageId}` };
  const state = await readDocument(sub, source);
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  // What the document says is always read here from this account's saved
  // conversation, never taken from the request or the model.
  const observation = { available: true, resource, state: { title: state.title, text: state.text },
    version: state.version, observedAt: new Date(nowMs).toISOString(), origin: "vaelo-storage" };
  const output = await runCheck("document", input, { now: nowMs, observation });
  output.status = output.result.status;
  output.summary = output.status === "completed" ? "Your document says everything you listed." : "Your document is missing some of what you listed.";
  output.result.mode = "native-document-readback";
  output.result.sourceVersion = state.version;
  output.result.title = state.title;
  // A plain list for the result view: each thing asked for, and whether it was there.
  output.result.says = output.result.checks.map(check => ({ text: check.id === "title" ? `Title: ${check.expected}` : check.expected, found: check.status === "passed" }));
  output.result.contentDigest = digest(state.text);
  output.result.evidence.after.state = { title: state.title, textLength: state.text.length, textDigest: digest(state.text) };
  output.result.evidence.fullObservationDigest = output.result.evidence.observationDigest;
  output.result.evidence.observationDigest = digest(output.result.evidence.after);
  // The record keeps the answers. Avoid repeating long document text once per
  // check in the stored result.
  output.result.evidence.fullContractDigest = output.result.evidence.contractDigest;
  output.result.contract = { id: output.result.contract.id, resource, checkIds: output.result.checks.map(check => check.id) };
  output.result.evidence.contractDigest = digest(output.result.contract);
  for (const check of output.result.checks) {
    if (check.path[0] === "text" && typeof check.actual === "string")
      check.actual = { sourceField: "text", length: check.actual.length, digest: digest(check.actual) };
    if (typeof check.expected === "string" && check.expected.length > 128)
      check.expected = { preview: check.expected.slice(0, 128), length: check.expected.length, digest: digest(check.expected) };
  }
  for (const item of output.result.says) if (item.text.length > 200) item.text = `${item.text.slice(0, 200)}…`;
  output.limitations = [
    "Vaelo read the saved copy of your document. Changes still syncing from another device aren’t included.",
    "It only checks the things you listed. It doesn’t check the layout, who can see it, or whether it was sent.",
  ];
  return output;
}
