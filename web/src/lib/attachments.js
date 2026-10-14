/* Attachments are read in the browser. Text files are set into the message;
   images travel as inline image parts that Hermes shows to a vision model or
   describes with its vision tool when the model can't see. Nothing is
   uploaded anywhere else. */

export const MESSAGE_LIMIT = 16000;
const READ_LIMIT = 400_000;

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
const IMAGE_CHARS = 1_500_000;

export function isImage(file) {
  return (
    /^image\/(png|jpeg|webp|gif)$/.test(file.type || "") ||
    /\.(png|jpe?g|webp|gif)$/i.test(file.name || "")
  );
}

export function isReadable(file) {
  return (
    TEXT_EXT.test(file.name || "") ||
    /^text\//.test(file.type || "") ||
    /json|xml|javascript|yaml|csv/.test(file.type || "")
  );
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* What the model receives: your words, then each file set off as a block. */
export function composeContent(text = "", attachments = []) {
  const files = attachments
    .filter((file) => file.state === "ready" && file.kind !== "image")
    .map((file) => {
      const fence = file.body.includes("```") ? "````" : "```";
      return `Attached file: ${file.name}\n${fence}${LANG[extensionOf(file.name)] || ""}\n${file.body}\n${fence}`;
    });
  return [String(text).trim(), ...files].filter(Boolean).join("\n\n");
}

/* One message as Hermes receives it. Images go along only with the message
   they were attached to; later turns carry a short note instead, since the
   reply already said what was in them. */
export function wireMessage(message, { latest = false, images = new Map() } = {}) {
  if (message.role !== "user") return { role: message.role, content: message.content };
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
  const notes = attached.map((file) => `[Image shared earlier: ${file.name}]`).join("\n");
  return {
    role: "user",
    content: [text, notes].filter((part) => part.trim()).join("\n\n"),
    ...mode,
  };
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
export function fitHistory(list, { chars = 46000, count = 58 } = {}) {
  const kept = [];
  let total = 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const size = wireChars(list[i]);
    if (kept.length && (kept.length >= count || total + size > chars)) break;
    total += size;
    kept.unshift(list[i]);
  }
  while (kept.length > 1 && kept[0].role !== "user") kept.shift();
  return { messages: kept, dropped: list.length - kept.length };
}

async function scaled(file, side, quality) {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", quality);
}

/* Images are resized in the browser so they stay well inside the request
   limit; the full copy lives only in memory, a small thumbnail is kept. */
export async function readImage(file) {
  const base = { id: crypto.randomUUID(), name: file.name || "Pasted image", size: file.size, kind: "image" };
  try {
    const data = await scaled(file, IMAGE_SIDE, 0.86);
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
  if (!isReadable(file))
    return {
      ...base,
      state: "unsupported",
      note: "Vaelo takes images and text files: notes, code, CSV, JSON, Markdown.",
    };
  if (file.size > READ_LIMIT)
    return { ...base, state: "too-large", note: `Too large to read here (${formatSize(file.size)}).` };
  const body = (await file.text()).replace(/\r\n/g, "\n");
  return { ...base, state: "ready", body, chars: body.length };
}
