/* Provenance. Every external link in a reply becomes a numbered source, and
   each source keeps its type visible: a social post, a news report and a
   reference page should never look like interchangeable chips. */

import { withoutFencedCode, withoutInlineCode } from './markdown-fences.js';
import { decodeString } from 'micromark-util-decode-string';

const KINDS = [
  { kind: "social", label: "Social", hosts: /(^|\.)(x\.com|twitter\.com|reddit\.com|threads\.net|bsky\.app|mastodon\.|facebook\.com|instagram\.com|linkedin\.com|tiktok\.com)$/ },
  { kind: "video", label: "Video", hosts: /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv)$/ },
  { kind: "research", label: "Research", hosts: /(^|\.)(arxiv\.org|doi\.org|nature\.com|science\.org|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|scholar\.google\.com|semanticscholar\.org|acm\.org|ieee\.org|springer\.com|sciencedirect\.com|jstor\.org|ssrn\.com)$/ },
  { kind: "official", label: "Official", hosts: /(\.gov|\.gouv\.[a-z]{2}|\.gov\.[a-z]{2}|\.mil|\.edu|\.ac\.[a-z]{2}|(^|\.)europa\.eu|(^|\.)who\.int|(^|\.)un\.org)$/ },
  { kind: "news", label: "News", hosts: /(^|\.)(reuters\.com|apnews\.com|bbc\.co\.uk|bbc\.com|nytimes\.com|theguardian\.com|washingtonpost\.com|wsj\.com|ft\.com|bloomberg\.com|cnn\.com|npr\.org|economist\.com|theverge\.com|techcrunch\.com|arstechnica\.com|wired\.com|axios\.com|politico\.com|aljazeera\.com|cnbc\.com|forbes\.com)$/ },
  { kind: "reference", label: "Reference", hosts: /(^|\.)(wikipedia\.org|britannica\.com|developer\.mozilla\.org|docs\.python\.org|github\.com|stackoverflow\.com|w3\.org|whatwg\.org|readthedocs\.io|npmjs\.com|pypi\.org)$/ },
];

export const SOURCE_KINDS = [...KINDS.map(({ kind, label }) => ({ kind, label })), { kind: "web", label: "Web" }];

export function parseUrl(href) {
  try {
    const url = new URL(href);
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

export function domainOf(href) {
  const url = parseUrl(href);
  return url ? url.hostname.replace(/^www\./, "") : "";
}

export function sourceKind(href) {
  const host = domainOf(href);
  if (!host) return "web";
  return KINDS.find((entry) => entry.hosts.test(host))?.kind || "web";
}

export function kindLabel(kind) {
  return SOURCE_KINDS.find((entry) => entry.kind === kind)?.label || "Web";
}

/* Link text that is just a number, a bracketed number, or the bare domain is
   a citation marker rather than prose, so the source keeps a better title. */
function usefulTitle(text, href) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean || /^\[?\d+\]?$/.test(clean) || clean === href || clean === domainOf(href))
    return "";
  return clean.slice(0, 160);
}

/* Markdown link syntax, autolinks and bare URLs, in reading order. Code is
   skipped so a URL inside an example is not mistaken for a citation. */
/* Sentence punctuation after a link isn't part of it; a closing bracket is
   only when the address opened one, as in …/wiki/Foo_(bar). */
function trimLink(href) {
  let link = href;
  for (;;) {
    const next = link.replace(/[.,;:!?]+$/, "");
    const unbalanced = next.endsWith(")") && next.split("(").length < next.split(")").length;
    const trimmed = unbalanced ? next.slice(0, -1) : next;
    if (trimmed === link) return link;
    link = trimmed;
  }
}

/* The address a link points at once Markdown has read it: backslash
   escapes and character references undone, as the rendered link has them,
   so a source and its inline mark always agree on the address. */
function numericReference(name) {
  const point = Number(name[1].toLowerCase() === "x" ? `0${name.slice(1)}` : name.slice(1));
  // Model output is untrusted. Invalid Unicode references decode to the
  // replacement character, as Markdown does, instead of throwing in render.
  return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
    ? String.fromCodePoint(point) : "\ufffd";
}
function readDestination(href) {
  // Retain the existing safe replacement for out-of-range numeric references,
  // including overlong references that CommonMark leaves undecoded.
  return decodeString(href.replace(/&(#x[0-9a-f]+|#\d+);/gi, (entity, name) =>
    numericReference(name) === '\ufffd' ? '\ufffd' : entity));
}

/* Read an inline destination before decoding escapes/entities. Parentheses in
   the URL balance independently of the optional title. Returning its full
   range also prevents title URLs from becoming unrelated sources. */
function inlineDestination(text, start) {
  let i = start;
  const whitespace = () => {
    const from = i;
    while (i < text.length && /\s/.test(text[i])) i++;
    return !/\n[^\S\n]*\n/.test(text.slice(from, i));
  };
  if (!whitespace()) return null;
  const angle = text[i] === '<';
  const from = angle ? ++i : i;
  if (!text.startsWith('http://', from) && !text.startsWith('https://', from)) return null;
  let depth = 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && /[!-/:-@[-`{-~]/.test(text[i + 1] || '')) { i++; continue; }
    if (angle) {
      if (c === '>') break;
      if (c === '<' || c === '\n' || c === '\r') return null;
    } else {
      if (/\s/.test(c) || c === ')' && depth === 0) break;
      if (c === '(') depth++;
      if (c === ')') depth--;
    }
  }
  const href = text.slice(from, i);
  if ((angle && text[i++] !== '>') || depth) return null;
  if (text[i] === ')') return { href, end: i + 1 };
  if (!/\s/.test(text[i] || '') || !whitespace()) return null;
  if (text[i] === ')') return { href, end: i + 1 };
  const quote = text[i] === '(' ? ')' : text[i];
  if (!['"', "'", ')'].includes(quote)) return null;
  const title = ++i;
  for (; i < text.length && text[i] !== quote; i++) {
    if (text[i] === '\\' && /[!-/:-@[-`{-~]/.test(text[i + 1] || '')) i++;
    else if (quote === ')' && text[i] === '(') return null;
  }
  if (text[i] !== quote || /\n[^\S\n]*\n/.test(text.slice(title, i))) return null;
  i++;
  return whitespace() && text[i] === ')' ? { href, end: i + 1 } : null;
}

function* sourceLinks(text) {
  // Pair brackets once: repeated unmatched labels must not rescan the reply.
  const brackets = new Map(), stack = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && /[!-/:-@[-`{-~]/.test(text[i + 1] || '')) { i++; continue; }
    if (text[i] === '[') stack.push(i);
    else if (text[i] === ']' && stack.length) brackets.set(stack.pop(), i);
  }
  const pattern = /\[|<(https?:\/\/[^>\s]+)>|(https?:\/\/(?:[^\s<>()\]]|\([^\s<>()\]]*\))+)/g;
  for (let match; (match = pattern.exec(text));) {
    const close = brackets.get(match.index);
    if (match[0] === '[') {
      if (close === undefined || text[close + 1] !== '(') continue;
      const label = text.slice(match.index + 1, close);
      // A nested link disables its outer link in Markdown. Leave it for the
      // scanner rather than consuming it as part of an outer destination.
      if (/(^|[^!\\])\[[^\]]*\]\(/.test(label)) continue;
      const destination = inlineDestination(text, close + 2);
      if (!destination) continue;
      yield { start: match.index, end: destination.end, href: readDestination(destination.href),
        title: readDestination(label) };
      pattern.lastIndex = destination.end;
    } else {
      yield { start: match.index, end: pattern.lastIndex,
        href: match[1] ? readDestination(match[1]) : trimBare(match[2]), title: '' };
    }
  }
}

/* A bare address ends before emphasis that closes around it, as in
   **https://example.com** or _https://example.com_, the way GFM reads it. */
function trimBare(href) {
  let link = href;
  for (;;) {
    const next = trimLink(link).replace(/[*_~]+$/, "");
    if (next === link) return link;
    link = next;
  }
}

export function collectSources(markdown = "") {
  const text = withoutInlineCode(withoutFencedCode(String(markdown)));
  const found = new Map();
  const add = (href, title, context) => {
    const url = parseUrl(href);
    if (!url) return;
    const key = url.href.replace(/#.*$/, "").replace(/\/$/, "");
    const existing = found.get(key);
    if (existing) {
      if (!existing.title && title) existing.title = title;
      return;
    }
    found.set(key, {
      id: key,
      url: url.href,
      title,
      domain: domainOf(url.href),
      kind: sourceKind(url.href),
      context,
      index: found.size + 1,
    });
  };
  for (const { start, end, href, title } of sourceLinks(text)) {
    /* The sentence the link supports, not the whole paragraph */
    const lineStart = text.lastIndexOf("\n", start) + 1;
    const lineEnd = text.indexOf("\n", end);
    const line = text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
    const at = start - lineStart;
    const boundary = Math.max(
      ...[". ", "! ", "? "].map((mark) => line.slice(0, at).lastIndexOf(mark)),
    );
    const length = end - start;
    const after = line.slice(at + length).search(/[.!?](\s|$)/);
    const sentence = line.slice(boundary < 0 ? 0 : boundary + 2, at) +
      (usefulTitle(title, href) ? title : '') +
      line.slice(at + length, after < 0 ? undefined : at + length + after + 1);
    const context = sentence
      .replace(/\[\[?\d+\]?\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/^[\s>*\-#\d.]+/, "")
      .replace(/[*_`]/g, "")
      .replace(/\s+([.,;:!?])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 220);
    add(href, usefulTitle(title, href), context);
  }
  return [...found.values()];
}

export function sourceKey(href) {
  const url = parseUrl(String(href));
  return url ? url.href.replace(/#.*$/, "").replace(/\/$/, "") : "";
}
