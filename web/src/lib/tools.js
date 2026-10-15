/* Hermes reports tools by their function name. People should read what was
   done ("Searched the web"), not how it was wired ("web_search"). Unknown
   tools fall back to a humanised name so nothing is ever hidden. */

const KINDS = [
  { match: /^web_search|search_web|^search$/, kind: "search", now: "Searching the web", past: "Searched the web", unit: ["search", "searches"] },
  { match: /web_extract|extract|fetch|browse|browser|scrape|crawl/, kind: "read", now: "Reading a page", past: "Read a page", unit: ["page", "pages"] },
  { match: /terminal|shell|exec|execute|python|run_code|code_exec/, kind: "run", now: "Running code", past: "Ran code", unit: ["run", "runs"] },
  { match: /read_file|search_files|list_dir|file_read|grep/, kind: "file", now: "Reading files", past: "Read files", unit: ["file step", "file steps"] },
  { match: /write_file|patch|edit_file|file_write/, kind: "write", now: "Writing a file", past: "Wrote a file", unit: ["edit", "edits"] },
  { match: /memory|session_search|recall/, kind: "memory", now: "Checking memory", past: "Checked memory", unit: ["lookup", "lookups"] },
  { match: /skill/, kind: "skill", now: "Using a skill", past: "Used a skill", unit: ["skill", "skills"] },
  { match: /image|vision/, kind: "image", now: "Working with an image", past: "Worked with an image", unit: ["image", "images"] },
  { match: /delegate|agent/, kind: "delegate", now: "Handing off a subtask", past: "Handed off a subtask", unit: ["subtask", "subtasks"] },
  { match: /todo|plan/, kind: "plan", now: "Planning", past: "Planned", unit: ["plan", "plans"] },
];

/* "web_search" -> "Web search" */
export function humanizeTool(name = "") {
  const text = String(name).replace(/[_-]+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "A tool";
}

export function toolInfo(name = "") {
  const key = String(name).toLowerCase();
  const found = KINDS.find((entry) => entry.match.test(key));
  if (found) return { kind: found.kind, now: found.now, past: found.past, unit: found.unit };
  const label = humanizeTool(name);
  return { kind: "tool", now: label, past: label, unit: ["step", "steps"] };
}

/* Hermes' preview is often "tool_name: detail" or just the tool name. Keep
   only the detail a person would care about: the query, the URL, the file. */
export function toolDetail(step) {
  const tool = String(step?.tool ?? step?.name ?? "");
  const label = String(step?.label || "").trim();
  if (!label || label === tool) return "";
  return (label.toLowerCase().startsWith(tool.toLowerCase())
    ? label.slice(tool.length).replace(/^\s*[:\-–]\s*/, "")
    : label
  ).slice(0, 140);
}

/* "Searched the web 3× · Read 2 pages" — the receipt's one-line summary. */
export function summarizeSteps(steps = []) {
  const counts = new Map();
  for (const step of steps) {
    const info = toolInfo(step.tool ?? step.name);
    const entry = counts.get(info.kind) || { info, n: 0 };
    entry.n += 1;
    counts.set(info.kind, entry);
  }
  return [...counts.values()].map(({ info, n }) => {
    // Every todo_list call rewrites the same plan, so it is one plan, not n.
    if (n === 1 || info.kind === "plan") return info.past;
    if (info.kind === "search") return `Searched the web ${n}×`;
    if (info.kind === "read") return `Read ${n} pages`;
    return `${info.past} · ${n} ${info.unit[1]}`;
  });
}
