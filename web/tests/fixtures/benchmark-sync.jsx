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
  if (url.pathname === '/api/chats' && !url.searchParams.has('resource')) {
    return navigator.locks.request('benchmark-fixture-storage', () => {
      const serverKey = 'benchmark-fixture-server';
      const server = JSON.parse(localStorage.getItem(serverKey) || '{"entries":{},"parts":{}}');
      const partKey = (id,version,part) => `${id}:${version}:${part}`;
      if (!init?.body) {
        if (url.searchParams.has('id')) return Response.json({text: server.parts[partKey(url.searchParams.get('id'),url.searchParams.get('version'),url.searchParams.get('part'))]});
        return Response.json({entries:server.entries});
      }
      const body = JSON.parse(init.body);
      if (body.action === 'part') server.parts[partKey(body.id,body.version,body.part)] = body.text;
      if (body.action === 'commit') {
        if ((server.entries[body.id]?.version || null) !== body.base) return Response.json({error:'Changed on another tab'},{status:409});
        server.entries[body.id] = {version:body.version,deleted:body.deleted,parts:body.parts,updated:Date.now()};
      }
      localStorage.setItem(serverKey,JSON.stringify(server));
      return Response.json({entry:server.entries[body.id]});
    });
  }
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
