import { CAPABILITIES } from "../../shared/capabilities.js";

export function readWorkProposal(source) {
  if (typeof source !== "string" || source.length > 64_000) return null;
  try {
    const value = JSON.parse(source);
    if (!value || Array.isArray(value) || typeof value !== "object" ||
        Object.keys(value).some(key => !["capabilityId", "title", "input", "scope"].includes(key))) return null;
    if (!Number.isInteger(value.capabilityId) || !CAPABILITIES.some(c => c.id === value.capabilityId)) return null;
    if (!value.input || Array.isArray(value.input) || typeof value.input !== "object") return null;
    if (value.title !== undefined && (typeof value.title !== "string" || value.title.length > 160)) return null;
    if (value.scope !== undefined && !["personal", "work", "client"].includes(value.scope)) return null;
    const safe = (node, depth = 0) => {
      if (depth > 12) return false;
      if (!node || typeof node !== "object") return true;
      return Object.entries(node).every(([key, child]) =>
        !["__proto__", "prototype", "constructor"].includes(key) && safe(child, depth + 1));
    };
    if (!safe(value.input)) return null;
    return { capabilityId: value.capabilityId, title: value.title || "", scope: value.scope || "personal", input: value.input };
  } catch { return null; }
}
