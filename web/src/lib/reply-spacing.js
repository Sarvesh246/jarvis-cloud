// Repair joined prose sentences without inserting spaces between token chunks.
// Code and link destinations are literal: changing their punctuation can break them.
export function normalizeReplySpacing(value) {
  if (typeof value !== "string" || !/[?!][A-Z]/.test(value)) return value;
  let fence = null;
  return value.split("\n").map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length &&
          !line.slice(marker[0].length).trim()) fence = null;
      return line;
    }
    if (marker) {
      fence = marker[1];
      return line;
    }
    if (/^(?: {4}|\t)/.test(line)) return line;
    // Bare addresses and paths (www.site.com/a?Q=1, file.py?Foo) are literal too.
    const literal = /`+[^`]*(?:`+|$)|https?:\/\/[^\s<>]+|\]\([^\n)]*\)|<[^>\n]*>|[^\s?!]*[./][^\s?!]*[?!]\S*/g;
    let output = "", at = 0;
    const prose = (text) => text.replace(/([?!])(?=[A-Z])/g, "$1 ");
    for (const match of line.matchAll(literal)) {
      output += prose(line.slice(at, match.index)) + match[0];
      at = match.index + match[0].length;
    }
    return output + prose(line.slice(at));
  }).join("\n");
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
