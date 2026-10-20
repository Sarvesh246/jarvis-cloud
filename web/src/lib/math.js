/* Mathematics in a reply. Models write equations in several dialects:
   \( … \), \[ … \], $ … $ and $$ … $$. Markdown alone knows none of them, and
   a bare "$" is as often a price as a formula. This module settles that before
   the Markdown parser runs, so remark-math only ever sees unambiguous math:

   - \( … \) and $ … $ become $$$ … $$$, and \[ … \] becomes $$ … $$;
   - a lone "$" is left exactly as written (remark-math is told one dollar
     never opens math), so prices and shell variables stay text and tables
     and charts still read their figures from the source;
   - code (fences, indented blocks, spans) and links are never touched.

   While a reply streams, `prepareLive` also holds back a formula, table header
   or emphasis marker that has not finished arriving, so the page never shows
   half a command or a broken equation. */

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s/;
const SEARCH_LIMIT = 1500;

/* Which lines are code: inside a fence, or an indented block that is not a
   list continuation. Returns a flag per line and whether a fence is left open. */
function lineKinds(lines) {
  const code = new Array(lines.length).fill(false);
  let fence = null;
  let inList = false;
  let previousBlank = true;
  let previousCode = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      code[i] = true;
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      previousBlank = false;
      previousCode = true;
      continue;
    }
    const open = line.match(FENCE_OPEN);
    if (open && !(open[1][0] === "`" && line.slice(open[0].length).includes("`"))) {
      fence = { char: open[1][0], length: open[1].length };
      code[i] = true;
      previousBlank = false;
      previousCode = true;
      continue;
    }
    const blank = !line.trim();
    /* A bare JSON line (a model forgetting its fence) is data: its "$480"
       must reach the rich-block parser exactly as written. */
    if (/^\s*[{[]\s*"|^\s*"[^"\n]*"\s*:/.test(line)) {
      code[i] = true;
      previousBlank = false;
      previousCode = true;
      continue;
    }
    if (!blank) {
      const indented = /^(?: {4,}|\t)/.test(line);
      if (indented && !inList && (previousBlank || previousCode)) {
        code[i] = true;
      } else if (LIST_ITEM.test(line)) {
        inList = true;
      } else if (!indented) {
        inList = false;
      }
    }
    previousBlank = blank;
    previousCode = code[i];
  }
  return { code, openFence: !!fence };
}

/* Position of the matching backtick run for a code span starting at `i`, or -1. */
function codeSpanEnd(text, i) {
  let run = 0;
  while (text[i + run] === "`") run++;
  let j = i + run;
  while (j < text.length) {
    if (text[j] !== "`") { j++; continue; }
    let size = 0;
    while (text[j + size] === "`") size++;
    if (size === run) return j + size;
    j += size;
  }
  return -1;
}

/* The suffix of an inline link/image is Markdown data, not prose. Keep its
   destination and optional title byte-for-byte, including balanced URL
   parentheses, angle destinations, escapes, and quoted titles. */
function linkSuffixEnd(text, i) {
  let j = i + 2;
  const whitespace = () => {
    const start = j;
    while (j < text.length && /\s/.test(text[j])) j++;
    return !/\n[^\S\n]*\n/.test(text.slice(start, j));
  };
  if (!whitespace()) return -1;
  if (text[j] === '<') {
    j++;
    while (j < text.length && text[j] !== '>') {
      if (/[\n<]/.test(text[j])) return -1;
      if (text[j] === '\\') j++;
      j++;
    }
    if (text[j++] !== '>') return -1;
  } else {
    let depth = 0;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === '\\') { j++; continue; }
      if (/\s/.test(c)) break;
      if (c === '(') depth++;
      if (c === ')' && depth-- === 0) return j + 1;
    }
    if (depth !== 0) return -1;
  }
  if (text[j] === ')') return j + 1;
  if (!/\s/.test(text[j] || '') || !whitespace()) return -1;
  if (text[j] === ')') return j + 1;
  const quote = text[j] === '(' ? ')' : text[j];
  if (!['"', "'", ')'].includes(quote)) return -1;
  const titleStart = ++j;
  for (; j < text.length && text[j] !== quote; j++) {
    if (text[j] === '\\') j++;
  }
  if (text[j] !== quote || /\n[^\S\n]*\n/.test(text.slice(titleStart, j))) return -1;
  j++;
  return whitespace() && text[j] === ')' ? j + 1 : -1;
}

const looksLikeProse = (tex) => !/[\\^_{}=+<>]/.test(tex) && (tex.match(/[A-Za-z]{3,}/g) || []).length >= 3;

/* Index of the "$" that closes the one at `i`, or -1 when this "$" is not a
   formula. Pandoc's rules: no space just inside either delimiter, and the
   closer must not be followed by a digit ("$5 and $10" is two prices). */
function singleDollarEnd(text, i) {
  const next = text[i + 1];
  if (!next || /\s/.test(next) || next === "$") return -1;
  const limit = Math.min(text.length, i + 1 + SEARCH_LIMIT);
  for (let j = i + 1; j < limit; j++) {
    const c = text[j];
    if (c === "\n" && /^\n\s*\n/.test(text.slice(j, j + 40))) return -1;
    if (c === "\\") { j++; continue; }
    if (c !== "$") continue;
    if (text[j + 1] === "$") return -1;
    if (/\s/.test(text[j - 1]) || /\d/.test(text[j + 1] || "")) continue;
    return looksLikeProse(text.slice(i + 1, j)) ? -1 : j;
  }
  return -1;
}

/* Inline math is always fenced with three dollars (more if the formula holds
   some itself): exactly two means display math, and one is left to mean a price. */
function inlineMath(tex) {
  const body = tex.replace(/\s*\n\s*/g, " ").trim();
  if (!body) return "";
  const longest = Math.max(0, ...(body.match(/\$+/g) || []).map((run) => run.length));
  const fence = "$".repeat(Math.max(3, longest + 1));
  return `${fence}${body.startsWith("$") || body.endsWith("$") ? ` ${body} ` : body}${fence}`;
}

/* Display math. Alone on its line it becomes a fenced block, keeping the
   line's indentation so a list item still owns it; inside a sentence it stays
   on one line and the Markdown plugin below promotes it to a displayed equation. */
function displayMath(tex, indent, flow) {
  const body = tex.replace(/\n\s*\n/g, "\n").trim();
  if (!body) return "";
  if (!flow) return "$$" + body.replace(/\s*\n\s*/g, " ") + "$$";
  const lines = body.split("\n").map((line) => indent + line.trim());
  return "$$\n" + lines.join("\n") + "\n" + indent + "$$";
}

/* Rewrites one run of prose. `unclosed` is where a formula opened but did not
   close (used only while streaming). */
function scan(text) {
  let out = "";
  let unclosed = -1;
  let brackets = 0;
  let i = 0;
  const n = text.length;
  const mark = (at) => { if (unclosed < 0) unclosed = at; };
  const emitDisplay = (tex, from, to) => {
    const lineStart = text.lastIndexOf("\n", from - 1) + 1;
    const before = text.slice(lineStart, from);
    const lineEnd = text.indexOf("\n", to);
    const after = text.slice(to, lineEnd < 0 ? n : lineEnd);
    const alone = !before.trim() && !after.trim();
    return displayMath(tex, alone ? before : "", alone);
  };
  while (i < n) {
    const c = text[i];
    if (c === "\\") {
      const d = text[i + 1];
      if (d === "(" || d === "[") {
        const end = text.indexOf(d === "(" ? "\\)" : "\\]", i + 2);
        if (end < 0) { mark(i); out += text.slice(i, i + 2); i += 2; continue; }
        const tex = text.slice(i + 2, end);
        out += d === "(" ? inlineMath(tex) : emitDisplay(tex, i, end + 2);
        i = end + 2;
        continue;
      }
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === "`") {
      const end = codeSpanEnd(text, i);
      let run = 0;
      while (text[i + run] === "`") run++;
      if (end < 0) { out += text.slice(i, i + run); i += run; continue; }
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (c === '[') brackets++;
    if (c === ']' && brackets > 0) {
      brackets--;
      if (text[i + 1] === '(') {
        const end = linkSuffixEnd(text, i);
        if (end >= 0) {
          out += text.slice(i, end);
          i = end;
          continue;
        }
      }
    }
    if ((c === "h" && /^https?:\/\//.test(text.slice(i, i + 8))) || (c === "<" && /^<[a-z][\w+.-]*:/i.test(text.slice(i, i + 24)))) {
      const end = text.slice(i).search(c === "<" ? /[>\s]/ : /[\s)>\]]/);
      const stop = end < 0 ? n : i + end;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === "$") {
      if (text[i + 1] === "$") {
        const end = text.indexOf("$$", i + 2);
        if (end < 0) { mark(i); out += "\\$\\$"; i += 2; continue; }
        out += emitDisplay(text.slice(i + 2, end), i, end + 2);
        i = end + 2;
        continue;
      }
      const end = singleDollarEnd(text, i);
      if (end < 0) {
        const tail = text.slice(i + 1);
        if (tail.length <= 200 && !/\n\s*\n/.test(tail) && /^[\\{(A-Za-z]/.test(tail) && /[\\^_{]/.test(tail)) mark(i);
        out += "$";
        i++;
        continue;
      }
      out += inlineMath(text.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    out += c;
    i++;
  }
  return { out, unclosed };
}

/* Runs `scan` over every prose run in the Markdown. Returns the rewritten
   text, and where (in the original) the first unfinished formula began. */
function process(content) {
  const lines = content.split("\n");
  const { code, openFence } = lineKinds(lines);
  const pieces = [];
  let offset = 0;
  let unclosed = -1;
  for (let i = 0; i < lines.length; ) {
    if (code[i]) {
      pieces.push(lines[i]);
      offset += lines[i].length + 1;
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && !code[j]) j++;
    const run = lines.slice(i, j).join("\n");
    const result = scan(run);
    if (unclosed < 0 && result.unclosed >= 0) unclosed = offset + result.unclosed;
    pieces.push(result.out);
    offset += run.length + 1;
    i = j;
  }
  return { text: pieces.join("\n"), unclosed, openFence, lines, code };
}

/* True only for text that holds a formula, not merely a price. */
export const hasMath = (text) => !!text && /[$\\]/.test(text) && normalizeMath(text).includes("$$");

/* For finished text: every dialect becomes $ … $ or $$ … $$, prices stay text. */
export function normalizeMath(content) {
  if (!content || (!content.includes("$") && !content.includes("\\"))) return content || "";
  return process(content).text;
}

/* Closes inline markers a stream has opened but not yet closed, on the last
   line only, so "**Result" shows as bold while it arrives. */
function closeInline(line) {
  if (/^\s*(?:[-*+]|\d+[.)])\s*$/.test(line)) return line;
  // Container fences may be indented or quoted. A fence is not an unfinished
  // inline span: appending a tick would stop it closing the existing block.
  if (/^(?:\s*>)*\s*(?:`{3,}|~{3,})\s*$/.test(line)) return line;
  let text = line.replace(/\[([^\]\n]*)\]\([^)\n]*$/, "$1");
  const strip = text.replace(/\\./g, "").replace(/`[^`]*`/g, "");
  const ticks = (strip.match(/`/g) || []).length;
  if (ticks % 2) text += "`";
  else {
    const bold = (strip.match(/\*\*/g) || []).length;
    if (bold % 2 && !/\*\*\s*$/.test(text)) text += "**";
    const struck = (strip.match(/~~/g) || []).length;
    if (struck % 2 && !/~~\s*$/.test(text)) text += "~~";
  }
  return text;
}

/* For a reply that is still arriving. Hides what has not finished (a formula,
   a table's header line) and reports it, so the interface can say so. */
export function prepareLive(content) {
  if (!content) return { text: "", pending: null };
  let { unclosed } = process(content);
  let held = null;
  let text = content;
  if (unclosed >= 0) {
    text = content.slice(0, unclosed).replace(/\s+$/, "");
    held = "math";
  }
  const lines = text.split("\n");
  const { code, openFence } = lineKinds(lines);
  if (!openFence && lines.length) {
    const last = lines.length - 1;
    if (!code[last]) {
      if (/^\s*\|/.test(lines[last]) && (last === 0 || !lines[last - 1].trim())) {
        lines.pop();
        held = held || "table";
      } else if (lines[last]) {
        lines[last] = closeInline(lines[last]);
      }
      text = lines.join("\n").replace(/\s+$/, "");
    }
  }
  return { text: normalizeMath(text), pending: held };
}

/* ---------- Markdown plugins ---------- */

/* remark-math reads "$$x$$" inside a sentence as inline math; the model meant
   a displayed equation, so mark it as one. Three dollars stay inline. */
export function remarkMathDisplay() {
  return (tree, file) => {
    const source = String(file.value ?? "");
    const walk = (node) => {
      if (node.type === "inlineMath" && node.position) {
        const start = node.position.start.offset;
        if (source.startsWith("$$", start) && source[start + 2] !== "$")
          node.data = { ...node.data, hProperties: { className: ["language-math", "math-display"] } };
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

const hastText = (node) => (node.type === "text" ? node.value : (node.children || []).map(hastText).join(""));
const classesOf = (node) => (Array.isArray(node?.properties?.className) ? node.properties.className : []);

/* Wraps each displayed equation in a block that remembers its TeX, so the
   interface can offer to copy it. Runs before rehype-katex replaces the node. */
export function rehypeMathBlock() {
  return (tree) => {
    const wrap = (parent) => {
      parent.children?.forEach((child, index) => {
        if (child.type !== "element") return;
        const classes = classesOf(child);
        const block =
          (child.tagName === "pre" && child.children?.length === 1 && classesOf(child.children[0]).includes("language-math")) ||
          (child.tagName === "code" && classes.includes("language-math") && classes.includes("math-display"));
        if (!block) return wrap(child);
        parent.children[index] = {
          type: "element",
          tagName: "span",
          properties: { className: ["math-block"], dataTex: hastText(child).trim() },
          children: [child],
        };
      });
    };
    wrap(tree);
  };
}

/* KaTeX settings: never throw (a bad formula falls back to its source), never
   trust links or raw HTML in a formula, and cap runaway macro expansion. */
export const KATEX_OPTIONS = {
  throwOnError: false,
  strict: "ignore",
  trust: false,
  maxExpand: 1000,
  maxSize: 50,
  errorColor: "currentColor",
  output: "htmlAndMathml",
};
