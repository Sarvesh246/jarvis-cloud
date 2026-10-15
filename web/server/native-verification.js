import { ChatStore, MAX_PARTS, checkId } from "./chat-store.js";
import { runCapability } from "./capability-engine.js";
import { digest, verifyObservation } from "./capabilities/verifier.js";
import { currentContent, docTitle } from "../src/lib/library.js";
import { HttpError } from "./security.js";

export async function readNativeDocument(sub, source, { storeFactory = account => new ChatStore(account) } = {}) {
  if (typeof sub !== "string" || !sub) throw new HttpError(401, "Sign in to read a saved document.");
  if (!source || source.kind !== "vaelo-document") throw new HttpError(400, "Choose a saved Vaelo document.");
  checkId(source.conversationId); checkId(source.messageId);
  const store = storeFactory(sub);
  const manifest = await store.manifest();
  const entry = manifest.data.entries[source.conversationId];
  if (!entry || entry.deleted) throw new HttpError(404, "This document's conversation is no longer saved.");
  if (!Number.isInteger(entry.parts) || entry.parts < 1 || entry.parts > MAX_PARTS) throw new HttpError(503, "This saved document could not be read.");
  const chunks = [];
  let length = 0;
  for (let part = 0; part < entry.parts; part++) {
    const text = await store.part(source.conversationId, entry.version, part);
    length += text.length;
    if (length > 2_000_000) throw new HttpError(413, "This conversation is too large for document verification.");
    chunks.push(text);
  }
  let chat;
  try { chat = JSON.parse(chunks.join("")); }
  catch { throw new HttpError(503, "This saved document could not be read."); }
  if (chat.id !== source.conversationId || !Array.isArray(chat.messages)) throw new HttpError(503, "This document has invalid saved data.");
  const message = chat.messages.find(item => item.id === source.messageId && item.role === "assistant");
  if (!message && !chat.works?.[source.messageId]) throw new HttpError(404, "This saved document could not be found.");
  if (!message) {
    const saved=chat.works[source.messageId];
    if (typeof saved.versions?.[saved.current]?.content !== "string") throw new HttpError(503, "This document has invalid saved content.");
  }
  const text = currentContent(chat.works?.[source.messageId], message?.content);
  if (typeof text !== "string") throw new HttpError(503, "This document has invalid saved content.");
  const latest = (await store.manifest()).data.entries[source.conversationId];
  if (latest?.deleted || latest?.version !== entry.version) throw new HttpError(409, "This document changed during verification. Run the checks again.");
  return { text, title: docTitle(text, chat.title), version: entry.version };
}

export async function runWorkCapability(id, input, { sub, now = Date.now(), readDocument = readNativeDocument } = {}) {
  if (Number(id) !== 1 || !input?.source) return runCapability(id, input, { now });
  const source = input.source;
  const resource = { kind: "document", id: `${source.conversationId}:${source.messageId}` };
  if (input.contract?.resource?.kind !== "document" || input.contract.resource.id !== resource.id || input.contract.resource.calendarId)
    throw new HttpError(400, "The acceptance contract must name the selected Vaelo document.");
  const state = await readDocument(sub, source);
  const observedAt = new Date(typeof now === "number" ? now : Date.parse(now)).toISOString();
  // Replace the client's observation completely. This read uses the signed-in
  // account's durable conversation store, not model-provided state.
  const observation = { available: true, resource, state: { title: state.title, text: state.text },
    version: state.version, observedAt, origin: "vaelo-storage" };
  // Validate the user-controlled contract through the bounded engine, then
  // compare the independently loaded text without treating it as user input.
  const output = await runCapability(1, { ...input, observation: {
    available:true,resource,observedAt,state:{title:state.title,text:""}
  } }, { now });
  output.result = verifyObservation(output.result.contract, observation, {
    now: typeof now === "number" ? now : Date.parse(now), maxAgeMs: input.maxAgeMs ?? 60000
  });
  output.status = output.result.status;
  output.summary = output.status === "completed"
    ? "The saved Vaelo document satisfies every declared check."
    : "The saved Vaelo document did not satisfy every declared check. Review each result.";
  output.result.mode = "native-document-readback";
  output.result.sourceVersion = state.version;
  output.result.contentDigest = digest(state.text);
  output.result.evidence.after.state = { title: state.title, textLength: state.text.length, textDigest: digest(state.text) };
  output.result.evidence.fullObservationDigest = output.result.evidence.observationDigest;
  output.result.evidence.observationDigest = digest(output.result.evidence.after);
  // The work record retains full inputs. Avoid duplicating long source text
  // once per check in the bounded durable receipt.
  output.result.evidence.fullContractDigest = output.result.evidence.contractDigest;
  output.result.contract = {id:output.result.contract.id,resource,checkIds:output.result.checks.map(check=>check.id)};
  output.result.evidence.contractDigest = digest(output.result.contract);
  for (const check of output.result.checks) {
    if (check.path[0] === "text" && typeof check.actual === "string")
      check.actual = {sourceField:"text",length:check.actual.length,digest:digest(check.actual)};
    if (typeof check.expected === "string" && check.expected.length > 128)
      check.expected = {preview:check.expected.slice(0,128),length:check.expected.length,digest:digest(check.expected)};
  }
  output.limitations = [
    "Read independently from this account's saved Vaelo document at the recorded conversation version. Unsynced device edits are not included.",
    "Only the declared title/text checks are verified. This does not verify formatting, permissions, external delivery, or who caused the change.",
    "A digest is a content reference, not a signed external attestation."
  ];
  return output;
}
