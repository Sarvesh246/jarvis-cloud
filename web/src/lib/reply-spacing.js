// Repair joined prose sentences without inserting spaces between token chunks.
// Code and link destinations are literal: changing their punctuation can break them.
import { inlineCodeSpans, markdownFences } from './markdown-fences.js';

export function normalizeReplySpacing(value) {
  if (typeof value !== "string" || !/[?!][A-Z]/.test(value)) return value;
  const repair = text => text.split('\n').map(line => {
    if (/^(?: {4}|\t)/.test(line)) return line;
    // Bare addresses and paths (www.site.com/a?Q=1, file.py?Foo) are literal too.
    const literal = /https?:\/\/[^\s<>]+|\]\([^\n)]*\)|<[^>\n]*>|[^\s?!]*[./][^\s?!]*[?!]\S*/g;
    let output = '', at = 0;
    const prose = part => part.replace(/([?!])(?=[A-Z])/g, '$1 ');
    for (const match of line.matchAll(literal)) {
      output += prose(line.slice(at, match.index)) + match[0];
      at = match.index + match[0].length;
    }
    return output + prose(line.slice(at));
  }).join('\n');
  const outsideCode = text => {
    let output = '', at = 0;
    for (const [start, end] of inlineCodeSpans(text, true)) {
      output += repair(text.slice(at, start)) + text.slice(start, end);
      at = end;
    }
    return output + repair(text.slice(at));
  };
  let output = '', at = 0;
  for (const block of markdownFences(value)) {
    output += outsideCode(value.slice(at, block.start)) + value.slice(block.start, block.end);
    at = block.end;
  }
  return output + outsideCode(value.slice(at));
}

export function normalizeSavedReplySpacing(chat) {
  return {
    ...chat,
    messages: chat.messages.map((message) => message.role !== "assistant" ? message : {
      ...message,
      content: normalizeReplySpacing(message.content),
      ...(Array.isArray(message.versions) && {
        versions: message.versions.map((version) => ({ ...version, content: normalizeReplySpacing(version.content) })),
      }),
    }),
  };
}
