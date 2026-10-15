/* `onBytes` hears every arrival, keepalive comments included, so the page
   can tell a quiet model from a connection that has gone dead. */
export async function readEvents(body, onEvent, onBytes) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  function consume(final = false) {
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let name = "message";
      const data = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      const text = data.join("\n");
      if (!text || text === "[DONE]") continue;
      try {
        onEvent(name, JSON.parse(text));
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    if (final && buffer.trim() && !buffer.startsWith(":"))
      throw new Error("The response stream ended unexpectedly.");
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onBytes?.();
      buffer += decoder.decode(value, { stream: true });
      // The upstream emits LF; preserve CR split across transport chunks too.
      buffer = buffer.replace(/\r\n/g, "\n");
      consume();
    }
    buffer += decoder.decode();
    consume(true);
  } finally {
    reader.releaseLock();
  }
}
