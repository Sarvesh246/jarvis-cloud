/* `onEvent(name, data, id)` gets each frame's number when it has one, so a
   reader can pick up after the last frame it saw. `onBytes` hears every
   arrival, keepalive comments included, so the page can tell a quiet model
   from a connection that has gone dead. */
export async function readEvents(body, onEvent, onBytes) {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let ended = false;
  const frameLimit = 1024 * 1024;
  function consume(final = false) {
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      if (frame.length > frameLimit) throw new Error("The response stream frame exceeded its limit.");
      buffer = buffer.slice(boundary + 2);
      let name = "message";
      let id;
      const data = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
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
        // Do not acknowledge this id: reconnecting must replay the damaged
        // frame rather than silently dropping words and accepting completion.
        throw new Error("The response stream contained an unreadable event.");
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        throw new Error("The response stream contained an invalid event.");
      if (payload.choices != null) {
        if (!Array.isArray(payload.choices) || payload.choices.some(choice =>
          !choice || typeof choice !== "object" || Array.isArray(choice) ||
          (choice.delta != null && (typeof choice.delta !== "object" || Array.isArray(choice.delta))) ||
          ["content", "reasoning_content", "reasoning"].some(key =>
            choice.delta?.[key] != null && typeof choice.delta[key] !== "string")
        )) throw new Error("The response stream contained an invalid answer event.");
      }
      onEvent(name, payload, id);
    }
    if (buffer.length > frameLimit) throw new Error("The response stream frame exceeded its limit.");
    if (final && buffer.split("\n").some(line => line.trim() && !line.startsWith(":")))
      throw new Error("The response stream ended unexpectedly.");
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { ended = true; break; }
      onBytes?.();
      buffer += decoder.decode(value, { stream: true });
      // The upstream emits LF; preserve CR split across transport chunks too.
      buffer = buffer.replace(/\r\n|\r(?!$)/g, "\n");
      consume();
    }
    buffer = (buffer + decoder.decode()).replace(/\r\n|\r/g, "\n");
    consume(true);
  } finally {
    if (!ended) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
