// Repair joined prose sentences without inserting spaces between token chunks.
// Code and link destinations are literal: changing their punctuation can break them.
import { inlineCodeSpans, markdownFences } from './markdown-fences.js';
import { literalAnswerRequested } from '../../shared/answer-contract.js';

export function normalizeReplySpacing(value, requestText = '') {
  if (literalAnswerRequested(requestText)) return value;
  if (typeof value !== "string" || !/[?!][A-Z]/.test(value)) return value;
  // A provider may supply JSON without being asked for it. Protect string
  // values from the first streamed prefix, before JSON.parse can succeed.
  if (/^\s*(?:\{\s*"|\[\s*(?:\{|"|[-\d]|true|false|null|\]))/.test(value)) return value;
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
  for (const block of markdownFences(value, { containers: true })) {
    output += outsideCode(value.slice(at, block.start)) + value.slice(block.start, block.end);
    at = block.end;
  }
  return output + outsideCode(value.slice(at));
}

export function normalizeSavedReplySpacing(chat) {
  return {
    ...chat,
    messages: chat.messages.map((message, index) => message.role !== "assistant" ? message : {
      ...message,
      content: normalizeReplySpacing(message.content, chat.messages[index - 1]?.text ?? chat.messages[index - 1]?.content),
      ...(Array.isArray(message.versions) && {
        versions: message.versions.map((version) => ({ ...version, content: normalizeReplySpacing(version.content, chat.messages[index - 1]?.text ?? chat.messages[index - 1]?.content) })),
      }),
    }),
  };
}
