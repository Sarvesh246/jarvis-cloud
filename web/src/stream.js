/* `onEvent(name, data, id)` gets each frame's number when it has one, so a
   reader can pick up after the last frame it saw. `onBytes` hears every
   arrival, keepalive comments included, so the page can tell a quiet model
   from a connection that has gone dead. */
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
      let id;
      const data = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        if (line.startsWith("id:")) id = line.slice(3).trim();
      }
      const text = data.join("\n");
      if (!text) continue;
      /* A numbered frame counts as seen even when it carries nothing to
         show ([DONE]), so picking up again starts after it. */
      if (text === "[DONE]") {
        if (id !== undefined) onEvent("done", null, id);
        continue;
      }
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        if (id !== undefined) onEvent("unreadable", null, id);
        continue;
      }
      onEvent(name, payload, id);
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
