// Actual application, shared synthetic cache, and disposable stub responses.
// No credentials, real account data or live API requests are used.
import React from "react";
import { createRoot } from "react-dom/client";
import "../../src/design/tokens.css";
import "../../src/design/base.css";
import "../../src/design/personal.css";
import { App } from "../../src/App.jsx";

const user = { sub: "benchmark-sync-fixture", name: "Test reader" };
const key = `vaelo-sync:${user.sub}`;
if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ base: {}, chats: [{
  id: "123e4567-e89b-12d3-a456-426614174000", title: "Other tab draft", messages: [], updated: Date.now(),
}] }));
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  if (url.pathname === "/api/session") return Response.json({ user, csrf: "fixture", configured: true });
  if (url.pathname === "/api/status") return Response.json({ ready: true });
  if (url.pathname === "/api/chats" && !url.search && !init?.body) return Response.json({ entries: {} });
  if (url.pathname === "/api/chats" && init?.body) return Response.json({});
  if (url.pathname === "/api/chat" && init?.body) {
    const body = JSON.parse(init.body);
    document.getElementById("fixture-request").textContent = body.conversationId;
    const text = `Synthetic reply for ${body.messages.at(-1).content}.`;
    return new Response(`id: 0\ndata: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\nid: 1\nevent: jarvis.complete\ndata: {}\n\n: end\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }
  if (url.pathname.startsWith("/api/")) return Response.json({ error: "Unavailable in this fixture." }, { status: 503 });
  return originalFetch(input, init);
};
createRoot(document.getElementById("root")).render(<App />);
