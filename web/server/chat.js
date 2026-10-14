import { HttpError } from "./security.js";

export function chatInput(body) {
  if (
    !body ||
    !/^[a-f0-9-]{36}$/.test(body.conversationId || "") ||
    !Array.isArray(body.messages) ||
    !body.messages.length ||
    body.messages.length > 60
  )
    throw new HttpError(400, "Invalid conversation.");
  let total = 0;
  const messages = body.messages.map((message) => {
    if (
      !["user", "assistant"].includes(message.role) ||
      typeof message.content !== "string" ||
      !message.content.trim() ||
      message.content.length > 16000
    )
      throw new HttpError(400, "Invalid message.");
    total += message.content.length;
    return { role: message.role, content: message.content };
  });
  if (total > 48000)
    throw new HttpError(
      413,
      "Start a new chat to keep the conversation within its context limit.",
    );
  if (messages.at(-1).role !== "user")
    throw new HttpError(400, "A conversation must end with your message.");
  return { conversationId: body.conversationId, messages };
}

export function event(res, name, data) {
  res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function streamChat(req, res, cfg, user, input, request = fetch) {
  if (!cfg.backend.startsWith("https://") || !cfg.apiKey)
    throw new HttpError(503, "Cloud connection is not configured.");
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-store, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  event(res, "jarvis.status", {
    message: "Connecting to Vaelo. An idle server may take a minute to wake.",
  });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  res.on("close", cancel);
  const timer = setTimeout(cancel, 285000);
  const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15000);
  try {
    const upstream = await request(
      `${cfg.backend.replace(/\/$/, "")}/v1/chat/completions`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
          "X-Hermes-Session-Key": `web:${user.sub}`,
        },
        body: JSON.stringify({
          model: "jarvis",
          messages: [
            {
              role: "system",
              content: `Continue this private Vaelo web conversation. Conversation reference: ${input.conversationId}`,
            },
            ...input.messages,
          ],
          stream: true,
          max_tokens: 2048,
        }),
      },
    );
    if (!upstream.ok || !upstream.body) {
      const message =
        upstream.status === 429
          ? "Vaelo is busy or a provider limit was reached. Try again shortly."
          : upstream.status === 401
            ? "The cloud connection needs its API key updated."
            : "Vaelo is temporarily unavailable. Please try again.";
      throw new HttpError(503, message);
    }
    event(res, "jarvis.status", { message: "Vaelo is working…" });
    // Preserve native Hermes tool/status events and OpenAI content chunks.
    for await (const chunk of upstream.body) {
      if (controller.signal.aborted) break;
      if (!res.write(Buffer.from(chunk))) {
        await new Promise((resolve) => {
          res.once("drain", resolve);
          res.once("close", resolve);
        });
      }
    }
    if (!controller.signal.aborted) event(res, "jarvis.complete", { ok: true });
  } catch (error) {
    if (!res.destroyed)
      event(res, "jarvis.error", {
        message:
          error instanceof HttpError
            ? error.message
            : "The connection ended before Vaelo finished. Your prompt is still here; retry when ready.",
      });
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeat);
    res.off("close", cancel);
    res.end();
  }
}
