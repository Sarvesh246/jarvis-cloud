// Read fence lengths and marker types together. A shorter run inside a code
// example cannot close its surrounding block, and an unfinished block is code.
export function markdownFences(content = '') {
  const blocks = [];
  let open = null;
  let offset = 0;
  for (const raw of String(content).split(/(?<=\n)/)) {
    const line = raw.replace(/\r?\n$/, '');
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (open) {
      if (marker && marker[1][0] === open.marker[0] && marker[1].length >= open.marker.length && !marker[2].trim()) {
        blocks.push({ ...open, source: content.slice(open.body, offset).replace(/\r?\n$/, ''), end: offset + raw.length, closed: true });
        open = null;
      }
    } else if (marker && !(marker[1][0] === '`' && marker[2].includes('`'))) {
      open = { start: offset, body: offset + raw.length, marker: marker[1], language: marker[2].trim().split(/\s/)[0].toLowerCase() };
    }
    offset += raw.length;
  }
  if (open) blocks.push({ ...open, source: content.slice(open.body).replace(/\r?\n$/, ''), end: content.length, closed: false });
  return blocks;
}

export function withoutFencedCode(content = '') {
  let text = '', offset = 0;
  for (const block of markdownFences(content)) {
    text += content.slice(offset, block.start) + '\n';
    offset = block.end;
  }
  return text + content.slice(offset);
}

export function inlineCodeSpans(content = '', unfinished = false) {
  const runs = [...content.matchAll(/`+/g)];
  const next = new Array(runs.length);
  const last = new Map();
  for (let i = runs.length - 1; i >= 0; i--) {
    const length = runs[i][0].length;
    next[i] = last.get(length) ?? -1;
    last.set(length, i);
  }
  const spans = [];
  for (let i = 0; i < runs.length; i++) {
    const end = next[i];
    if (end < 0) {
      if (unfinished) { spans.push([runs[i].index, content.length]); break; }
      continue;
    }
    spans.push([runs[i].index, runs[end].index + runs[end][0].length]);
    i = end;
  }
  return spans;
}

export function withoutInlineCode(content = '') {
  let text = '', offset = 0;
  for (const [start, end] of inlineCodeSpans(content)) {
    text += content.slice(offset, start) + ' ';
    offset = end;
  }
  return text + content.slice(offset);
}
