/* The line Vaelo ends a reply with when it notes a lasting fact:
   [[remember: short plain fact]]. The page strips it from what is shown and
   saves it; the same cleaning runs again on the server. */
export const NOTE_LIMIT = 280;
export const NOTES_PER_REPLY = 3;
const MARK = /[ \t]*\[\[remember:\s*([^\]\n]{1,600})\]\][ \t]*/gi;
const OPENING = "[[remember:";

export const cleanNote = (text) =>
  String(text ?? "").replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, NOTE_LIMIT);

export function memoryNotes(text) {
  const seen = new Set();
  const notes = [];
  for (const match of String(text ?? "").matchAll(MARK)) {
    const note = cleanNote(match[1]);
    if (note && !seen.has(note.toLowerCase())) { seen.add(note.toLowerCase()); notes.push(note); }
  }
  return notes.slice(0, NOTES_PER_REPLY);
}

/* Safe to call on every streamed fragment: a note that has only just begun
   ("[[rem") is hidden too, so the marker never flashes on screen. */
export function stripMemoryNotes(text) {
  const original = String(text ?? "");
  let shown = original.replace(MARK, "");
  const start = shown.endsWith("[") && !shown.endsWith("[[") ? shown.length - 1 : shown.lastIndexOf("[[");
  if (start >= 0) {
    const tail = shown.slice(start).toLowerCase();
    if (tail.startsWith(OPENING) ? !tail.includes("]]") : OPENING.startsWith(tail)) shown = shown.slice(0, start);
  }
  return shown === original ? original : shown.replace(/\s+$/, "");
}
