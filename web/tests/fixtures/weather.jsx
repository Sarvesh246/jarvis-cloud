// Disposable integration fixture: actual App, no live services or model calls.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/source-serif-4/standard.css';
import '@fontsource-variable/source-sans-3';
import '../../src/design/tokens.css';
import '../../src/design/base.css';
import '../../src/design/personal.css';
import { App } from '../../src/App.jsx';
import { weatherContent } from './weather-data.js';

const content = weatherContent;
sessionStorage.setItem('vaelo-guest-chats', JSON.stringify([{ id: 'weather-fixture', title: 'Weather in Chicago', updated: Date.now(), messages: [
  { id: 'question', role: 'user', content: 'Weather today in Chicago' },
  { id: 'answer', role: 'assistant', content, at: Date.now() },
] }]));
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.pathname === '/api/session') return Response.json({ user: { sub: 'weather-test', name: 'Test reader', guest: true }, csrf: 'fixture', configured: true });
  if (url.pathname === '/api/status') return Response.json({ ready: true });
  if (url.pathname === '/api/stop') return Response.json({ stopped: true });
  if (url.pathname === '/api/chat') {
    const finish = JSON.parse(init?.body || '{}').messages?.at(-1)?.content?.includes('finish');
    let timer;
    return new Response(new ReadableStream({
      start(controller) {
        let at = 0;
        const words = content.match(/.{1,12}/gs);
        timer = setInterval(() => {
          if (at < words.length) controller.enqueue(new TextEncoder().encode(`id: ${at}\ndata: ${JSON.stringify({ choices: [{ delta: { content: words[at++] } }] })}\n\n`));
          else {
            clearInterval(timer);
            // Deliberately leave transport open even after completion.
            if (finish) controller.enqueue(new TextEncoder().encode(`id: ${at}\nevent: jarvis.complete\ndata: {"ok":true}\n\n`));
          }
        }, 100);
      },
      cancel() { clearInterval(timer); },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (url.pathname.startsWith('/api/')) return Response.json({ error: 'No live API in fixture' }, { status: 503 });
  return originalFetch(input, init);
};
createRoot(document.getElementById('root')).render(<App />);
