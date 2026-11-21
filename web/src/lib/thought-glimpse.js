/* A glimpse of the model's thinking while it is still thinking: its newest
   heading, if it writes headings, and the sentence it is on right now. Read
   from the end of the streamed reasoning, so it moves with the model rather
   than sitting on a "Thinking" label behind a click. Plain text only: markup
   is stripped and nothing here is rendered as HTML. */

const HEADING = /^\s*(?:#{1,4}\s+(.+?)\s*#*|\*\*([^*\n]{3,90})\*\*:?|__([^_\n]{3,90})__:?)\s*$/;
const MARKUP = /[*_`#>]+|\[([^\]]*)\]\([^)]*\)/g;

const plain = (text) =>
  text.replace(MARKUP, (match, label) => label ?? " ").replace(/\s+/g, " ").trim();

export const GLIMPSE_CHARS = 150;
const HEADING_CHARS = 64;

export function thoughtGlimpse(reasoning) {
  const text = typeof reasoning === "string" ? reasoning.slice(-6000) : "";
  if (!text.trim()) return { heading: "", line: "" };
  const lines = text.split("\n");
  let heading = "";
  let after = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const found = lines[i].match(HEADING);
    if (found) {
      heading = plain(found[1] || found[2] || found[3]);
      after = i + 1;
      break;
    }
  }
  if (heading.length > HEADING_CHARS) heading = heading.slice(0, HEADING_CHARS - 1).replace(/\s+\S*$/, "") + "…";
  // The sentence being thought now. A finished one that is very short reads
  // better with the one before it.
  const body = plain(lines.slice(after).join(" "));
  const sentences = body.split(/(?<=[.!?…])\s+(?=[A-Z0-9"'(])/).filter(Boolean);
  let line = sentences.at(-1) || "";
  if (line.length < 40 && sentences.length > 1) line = `${sentences.at(-2)} ${line}`;
  if (line.length > GLIMPSE_CHARS) line = "…" + line.slice(-(GLIMPSE_CHARS - 1)).replace(/^\S*\s/, "");
  return { heading, line };
}

/* How many sentences have been finished: a stable key for animating each new
   thought in, without restarting the animation on every streamed word. */
export function thoughtStep(reasoning) {
  return typeof reasoning === "string" ? (reasoning.match(/[.!?…](?:\s|$)|\n/g) || []).length : 0;
}
