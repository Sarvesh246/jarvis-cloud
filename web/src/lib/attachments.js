/* Attachments are read in the browser. Text files are set into the message;
   images travel as inline image parts that Hermes shows to a vision model or
   describes with its vision tool when the model can't see. Nothing is
   uploaded anywhere else. */

import { CONTEXT_POLICY } from '../../shared/context-policy.js';
import { historyDigest, plainContext } from '../../shared/context-retrieval.js';
import { DOCUMENT_EXT, readDocument } from './document-reader.js';

export const MESSAGE_LIMIT = CONTEXT_POLICY.messageChars;
/* Matches the proxy's LIMITS.replyChars; it clips the same way. */
const REPLY_LIMIT = CONTEXT_POLICY.replyChars;
const READ_LIMIT = 600_000;

const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|ya?ml|toml|ini|log|html?|css|scss|js|jsx|mjs|cjs|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|ps1|bat|sql|r|lua|svg|tex|env\.example)$/i;

const LANG = {
  md: "markdown", markdown: "markdown", csv: "csv", tsv: "tsv", json: "json",
  jsonl: "json", xml: "xml", yml: "yaml", yaml: "yaml", toml: "toml", html: "html",
  htm: "html", css: "css", scss: "scss", js: "javascript", jsx: "jsx", mjs: "javascript",
  cjs: "javascript", ts: "typescript", tsx: "tsx", py: "python", rb: "ruby", go: "go",
  rs: "rust", java: "java", kt: "kotlin", swift: "swift", c: "c", h: "c", cpp: "cpp",
  hpp: "cpp", cs: "csharp", php: "php", sh: "bash", ps1: "powershell", sql: "sql",
  r: "r", lua: "lua", svg: "svg",
};

export function extensionOf(name = "") {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

export const IMAGE_LIMIT = 4;
const IMAGE_SIDE = 1600;
// Four images plus the text budget must fit the API's 4 MB request body.
const IMAGE_CHARS = 650_000;

export function isImage(file) {
  return (
    /^image\/(png|jpeg|webp|gif)$/.test(file.type || "") ||
    /\.(png|jpe?g|webp|gif)$/i.test(file.name || "")
  );
}

export function isReadable(file) {
  return (
    TEXT_EXT.test(file.name || "") ||
    DOCUMENT_EXT.test(file.name || "") ||
    /^text\//.test(file.type || "") ||
    /json|xml|javascript|yaml|csv/.test(file.type || "")
  );
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* Files arrive in whatever encoding saved them. PowerShell's `>` and
   Notepad's "Unicode" write UTF-16, Excel on Windows writes CSV in
   Windows-1252; reading those as UTF-8 hands the model nulls and
   replacement marks. A byte-order mark decides first, then UTF-16 without
   one (every other byte zero), then strict UTF-8, then Windows-1252, which
   accepts any byte. Returns null when the result isn't text at all. */
function utf16Order(bytes) {
  const pairs = Math.min(bytes.length >> 1, 2048);
  if (pairs < 2) return "";
  let even = 0;
  let odd = 0;
  for (let i = 0; i < pairs; i += 1) {
    if (bytes[i * 2] === 0) even += 1;
    if (bytes[i * 2 + 1] === 0) odd += 1;
  }
  if (odd > pairs * 0.4 && even < pairs * 0.05) return "utf-16le";
  if (even > pairs * 0.4 && odd < pairs * 0.05) return "utf-16be";
  return "";
}

function looksBinary(text) {
  if (text.includes("\u0000")) return true;
  const sample = text.slice(0, 8000);
  const controls = sample.match(/[\u0001-\u0008\u000e-\u001f\u007f]/g)?.length || 0;
  return controls > sample.length * 0.1;
}

export function decodeText(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let encoding = "";
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) [encoding, start] = ["utf-8", 3];
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) [encoding, start] = ["utf-16le", 2];
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) [encoding, start] = ["utf-16be", 2];
  else encoding = utf16Order(bytes);
  const body = bytes.subarray(start);
  let text;
  if (encoding) text = new TextDecoder(encoding, { ignoreBOM: true }).decode(body);
  else {
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
    } catch {
      text = new TextDecoder("windows-1252").decode(body);
    }
  }
  return looksBinary(text) ? null : text;
}

/* A fence one backtick longer than any run inside the file, so a Markdown
   file's own code blocks can't close it early. */
function fenceFor(body) {
  const longest = Math.max(0, ...(body.match(/`{3,}/g) || []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

/* What the model receives: your words, then each file set off as a block. */
export function composeContent(text = "", attachments = []) {
  const files = attachments
    .filter((file) => file.state === "ready" && file.kind !== "image")
    .map((file) => {
      const fence = fenceFor(file.body);
      return `Attached file: ${file.name}\n${fence}${LANG[extensionOf(file.name)] || ""}\n${file.body}\n${fence}`;
    });
  return [String(text).trim(), ...files].filter(Boolean).join("\n\n");
}

/* One message as Hermes receives it. Images go along only with the message
   they were attached to; later turns carry a short note instead, since the
   reply already said what was in them. */
export function clipReply(text, limit = REPLY_LIMIT) {
  if (text.length <= limit) return text;
  const gap = "\n\n[… the middle of this earlier reply is omitted to save space …]\n\n";
  const head = Math.floor((limit - gap.length) * 0.55);
  return text.slice(0, head) + gap + text.slice(-(limit - gap.length - head));
}

/* A generated picture arrives twice: as a short vaelo-image reference written
   into the words, and as the picture itself in a jarvis.image event. The
   picture takes the reference's place. Once the reply is finished, a
   reference that never got its picture says so instead of a broken frame. */
const GENERATED = /!\[([^\]\n]*)\]\((vaelo-image:[0-9a-f]{24})\)/g;
export function placeImages(text, images, finished = false) {
  if (!text.includes("vaelo-image:")) return text;
  return text.replace(GENERATED, (whole, alt, ref) => {
    const src = images.get(ref);
    if (src) return `![${alt}](${src})`;
    if (!finished && !images.has(ref)) return whole;
    return `*${alt.trim() || "The image"} could not be shown. Ask Vaelo to make it again.*`;
  });
}

/* Earlier pictures stay on screen but never go back to the model: a few
   hundred kilobytes of base64 would crowd out the conversation itself. */
const INLINE_IMAGE = /!\[([^\]\n]*)\]\(data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+\)/g;
export function withoutInlineImages(text) {
  return text.replace(INLINE_IMAGE, (_, alt) => `[Image generated earlier: ${alt.trim() || "untitled"}]`);
}

export function wireMessage(message, { latest = false, images = new Map() } = {}) {
  if (message.role !== "user") return { role: message.role, content: clipReply(withoutInlineImages(message.content || "")) };
  const attached = (message.attachments || []).filter((file) => file.kind === "image");
  const text = message.content || "";
  const mode = message.mode ? { mode: message.mode } : {};
  const urls = latest ? attached.map((file) => images.get(file.id)).filter(Boolean) : [];
  if (urls.length)
    return {
      role: "user",
      content: [
        ...(text.trim() ? [{ type: "text", text }] : []),
        ...urls.map((url) => ({ type: "image_url", image_url: { url } })),
      ],
      ...mode,
    };
  const notes = attached.map((file) => `[Image shared earlier: ${file.name}${latest && !images.get(file.id)?'; original pixels unavailable in this session. Ask for reattachment before making visual claims.':''}]`).join("\n");
  return {
    role: "user",
    content: [text, notes].filter((part) => part.trim()).join("\n\n"),
    ...mode,
  };
}

// A visual follow-up needs the actual preceding image, not just its filename.
// Reuse only the latest relevant image turn and the existing four-image limit.
export function visualContextTurn(messages) {
  const last=messages.at(-1);
  if(last?.attachments?.some(file=>file.kind==='image')) return messages.length-1;
  if(!/\b(?:image|photo|picture|screenshot|chart|diagram|shapes?|visual|same one|that one|edit|recolor|make it|change it|remove|replace)\b/i.test(plainContext(last?.content)))
    return messages.length-1;
  return messages.findLastIndex(message=>message.role==='user'&&message.attachments?.some(file=>file.kind==='image'));
}

function wireChars(message) {
  return typeof message.content === "string"
    ? message.content.length
    : message.content
        .filter((part) => part.type === "text")
        .reduce((n, part) => n + part.text.length, 0);
}

/* Long conversations keep working: the newest turns that fit the cloud's
   context are sent, starting from one of your messages, and the reply says
   how many earlier ones were left out. */
export function fitHistory(list, { chars = CONTEXT_POLICY.historyChars, count = CONTEXT_POLICY.historyMessages } = {}) {
  const kept = [];
  let total = 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const size = wireChars(list[i]);
    if (kept.length && (kept.length >= count || total + size > chars)) break;
    total += size;
    kept.unshift(list[i]);
  }
  while (kept.length > 1 && kept[0].role !== "user") kept.shift();
  const dropped = list.length - kept.length;
  if (!dropped || chars < 8000 || count < 4) return {messages:kept, dropped};
  const reserve = Math.min(6000, Math.floor(chars * .12));
  const query = list.slice(-3).map(message => plainContext(message.content)).join('\n');
  let digest = historyDigest(list.slice(0, dropped), query, reserve);
  if (!digest) return {messages:kept,dropped};
  // Refit without recursion, keeping the actual newest question intact.
  while (kept.length > 1 && (kept.length >= count || kept.reduce((sum,message)=>sum+wireChars(message),0) + reserve > chars)) kept.shift();
  while (kept.length > 1 && kept[0].role !== 'user') kept.shift();
  // Include turns removed to make room for the digest as well. Otherwise a
  // correction in that boundary turn could vanish from both representations.
  digest=historyDigest(list.slice(0,list.length-kept.length),query,reserve);
  if (wireChars(kept[0]) + digest.length > chars) return {messages:kept,dropped:list.length-kept.length};
  return { messages:[{role:'user',content:digest}, ...kept], dropped:list.length-kept.length, recalled:true };
}

async function scaled(file, side, quality) {
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    bitmap.close?.();
  }
}

/* Images are resized in the browser so they stay well inside the request
   limit; the full copy lives only in memory, a small thumbnail is kept. */
export async function readImage(file) {
  const base = { id: crypto.randomUUID(), name: file.name || "Pasted image", size: file.size, kind: "image" };
  try {
    let data = await scaled(file, IMAGE_SIDE, 0.86);
    if (data.length > IMAGE_CHARS) data = await scaled(file, 1200, 0.75);
    if (data.length > IMAGE_CHARS) data = await scaled(file, 1000, 0.65);
    if (data.length > IMAGE_CHARS)
      return { ...base, state: "too-large", note: "Too detailed to send, even resized." };
    const thumb = await scaled(file, 160, 0.7);
    return { ...base, state: "ready", data, thumb };
  } catch {
    return { ...base, state: "unsupported", note: "This image couldn’t be read." };
  }
}

export async function readAttachment(file) {
  const base = {
    id: crypto.randomUUID(),
    name: file.name || "Pasted file",
    size: file.size,
  };
  if (!file.size) return { ...base, state: "empty", note: "This file is empty." };
  if (isImage(file)) return readImage(file);
  if (DOCUMENT_EXT.test(file.name || '')) {
    try {
      const result=await readDocument(file);
      if(result.body.length>MESSAGE_LIMIT-2000) throw Error('Too much extracted text for one message. Split the document into smaller files.');
      return {...base,state:'ready',body:result.body,chars:result.body.length,note:result.note};
    } catch(error) { return {...base,state:'unsupported',note:error.message||'This document could not be read.'}; }
  }
  if (!isReadable(file))
    return {
      ...base,
      state: "unsupported",
      note: "Vaelo takes images, PDF text, DOCX, XLSX, PPTX and text files.",
    };
  if (file.size > READ_LIMIT)
    return { ...base, state: "too-large", note: `Too large to read here (${formatSize(file.size)}).` };
  const decoded = decodeText(await file.arrayBuffer());
  if (decoded === null)
    return { ...base, state: "unsupported", note: "This file doesn’t contain readable text." };
  const body = decoded.replace(/\r\n?/g, "\n");
  if (!body.trim()) return { ...base, state: "empty", note: "This file is empty." };
  if (body.length > MESSAGE_LIMIT - 2_000)
    return { ...base, state: "too-large", note: "Too much text for one message. Add it to a Workroom workspace or split it into smaller files." };
  return { ...base, state: "ready", body, chars: body.length };
}


// Keep source pixels out of routine history, but restore the latest generated
// image for a creative follow-up so editing survives cache expiry/server restarts.
export function withGeneratedImageContext(wired, original) {
  const last = wired.at(-1);
  if (!last || last.role !== 'user') return wired;
  const text = plainContext(last.content);
  if (!/\b(?:edit|change|modify|replace|remove|add|make|recolor|redraw|generate|create|draw|another|again|variation)\b/i.test(text)) return wired;
  if (Array.isArray(last.content) && last.content.some(p => p.type === 'image_url')) return wired;
  const previous = original.slice(0, -1).findLast(m => m.role === 'assistant' && /!\[[^\]\n]*\]\(data:image\//.test(m.content || ''));
  if (!previous) return wired;
  const sources = [...previous.content.matchAll(/!\[[^\]\n]*\]\((data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+)\)/g)].slice(-4).map(m => m[1]);
  if (!sources.length) return wired;
  return [...wired.slice(0, -1), {...last, content: [
    ...(typeof last.content === 'string' ? [{type:'text',text:last.content}] : last.content),
    ...sources.map(url => ({type:'image_url', image_url:{url}})),
  ]}];
}
