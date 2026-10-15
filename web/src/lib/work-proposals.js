import { getWorkspace } from "../../shared/workspaces.js";
import { getCheck } from "../../shared/checks.js";
import { upgradeRecord, CUSTOM_WORKSPACE } from "../../shared/work-records.js";

const safe = (node, depth = 0) => {
  if (depth > 12) return false;
  if (!node || typeof node !== "object") return true;
  return Object.entries(node).every(([key, child]) =>
    !["__proto__", "prototype", "constructor"].includes(key) && safe(child, depth + 1));
};

/* A proposal Vaelo writes in a reply is a draft for the Workroom: a
   workspace, a name and scope, and optionally a check filled in. It never
   carries a result, a revision or documents. Older replies named a numbered
   capability; those whose check survives still open. */
export function readWorkProposal(source) {
  if (typeof source !== "string" || source.length > 64_000) return null;
  try {
    let value = JSON.parse(source);
    if (!value || Array.isArray(value) || typeof value !== "object") return null;
    if (value.capabilityId !== undefined) {
      if (Object.keys(value).some(key => !["capabilityId", "title", "input", "scope"].includes(key))) return null;
      if (!Number.isInteger(value.capabilityId) || !value.input || typeof value.input !== "object" || Array.isArray(value.input) || !safe(value.input)) return null;
      const upgraded = upgradeRecord({ id: "proposal", ...value });
      if (!upgraded.check) return null;
      value = { workspaceId: upgraded.workspaceId, title: value.title, scope: value.scope, check: upgraded.check };
    }
    if (Object.keys(value).some(key => !["workspaceId", "title", "scope", "check", "notes"].includes(key))) return null;
    const workspace = value.workspaceId === CUSTOM_WORKSPACE ? null : getWorkspace(value.workspaceId);
    if (value.workspaceId !== CUSTOM_WORKSPACE && !workspace) return null;
    if (value.title !== undefined && (typeof value.title !== "string" || value.title.length > 160)) return null;
    if (value.scope !== undefined && !["personal", "work", "client"].includes(value.scope)) return null;
    if (value.notes !== undefined && (typeof value.notes !== "string" || value.notes.length > 8000)) return null;
    let check = null;
    if (value.check !== undefined && value.check !== null) {
      if (typeof value.check !== "object" || Object.keys(value.check).some(key => !["id", "input"].includes(key))) return null;
      if (!getCheck(value.check.id) || (workspace && workspace.check !== value.check.id)) return null;
      if (!value.check.input || typeof value.check.input !== "object" || Array.isArray(value.check.input) || !safe(value.check.input)) return null;
      check = { id: value.check.id, input: value.check.input };
    }
    return { workspaceId: value.workspaceId, title: value.title || "", scope: value.scope || "personal", notes: value.notes || "", check };
  } catch { return null; }
}
