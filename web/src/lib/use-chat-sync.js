import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChatSync, readSyncCache, syncKey } from "./chat-sync.js";
import { readEvents } from "../stream.js";
import { persistentChats } from './slash-history.js';

/* Storage is checked this often while the live feed is down, and only this
   rarely while it is up: then the feed says the moment anything changes. */
const POLL_MS = 5000;
const SAFETY_MS = 60000;
/* A page nobody has touched for this long stops listening, so an open tab
   doesn't keep the free cloud awake all day. Any touch resumes it. */
const IDLE_MS = 10 * 60 * 1000;

export function useChatSync({ session, chats, setChats, busyId, onConflict }) {
  const [issue, setIssue] = useState("");
  const engine = useRef(null);
  const latest = useRef({ chats, busyId, onConflict });
  latest.current = { chats, busyId, onConflict };
  useLayoutEffect(() => {
    if (engine.current && engine.current.sub === session?.user?.sub) engine.current.observe(persistentChats(chats));
    else if (session?.user) {
      try {
        localStorage.setItem(syncKey(session.user.sub), JSON.stringify({
          chats: persistentChats(chats), base: readSyncCache(session.user.sub)?.base || {},
          deleted: readSyncCache(session.user.sub)?.deleted || [],
        }));
        localStorage.removeItem(`jarvis-chats:${session.user.sub}`);
      } catch { setIssue("Local backup is full. Keep this tab open until sync completes."); }
    }
  }, [chats, session?.user?.sub]);
  useEffect(() => {
    if (!session?.user || session.offline) return;
    const controller = new AbortController();
    const sync = new ChatSync({
      sub: session.user.sub, chats: persistentChats(latest.current.chats),
      base: readSyncCache(session.user.sub)?.base || {},
      deleted: readSyncCache(session.user.sub)?.deleted || [],
      busy: () => Boolean(latest.current.busyId),
      onChange: saved => setChats(current => [...saved, ...current.filter(chat => chat.temporary)]), onStatus: setIssue,
      onConflict: () => latest.current.onConflict(),
      request: async (path, body) => {
        const response = await fetch(path, {
          // AbortSignal.any needs Safari 17.4; older phones still sync, without the timeout.
          signal: AbortSignal.any ? AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) : controller.signal,
          cache: "no-store",
          ...(body === undefined ? {} : { method: "POST", headers: {
            "Content-Type": "application/json", "X-CSRF-Token": session.csrf,
          }, body: JSON.stringify(body) }),
        });
        const data = await response.json();
        if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status });
        return data;
      },
    });
    engine.current = sync;
    let live = false;
    let checked = 0;
    let touched = Date.now();
    let listening = false;
    const usable = () => !document.hidden && navigator.onLine !== false;
    const check = () => { checked = Date.now(); void sync.tick(); };
    const poll = () => {
      if (usable() && Date.now() - checked >= (live ? SAFETY_MS : POLL_MS) - 250) check();
    };
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    /* One open request at a time, while the page is in view and in use. */
    async function listen() {
      if (listening) return;
      listening = true;
      let seq = -1;
      let failures = 0;
      try {
        while (!controller.signal.aborted && usable() && Date.now() - touched < IDLE_MS) {
          const attempt = new AbortController();
          const end = () => attempt.abort();
          controller.signal.addEventListener("abort", end, { once: true });
          const hide = () => document.hidden && attempt.abort();
          addEventListener("visibilitychange", hide);
          try {
            const response = await fetch(`/api/feed?after=${seq}`, {
              signal: attempt.signal, cache: "no-store",
            });
            if (!response.ok || !response.body) throw new Error("feed unavailable");
            await readEvents(response.body, (name, data) => {
              if (name !== "feed" || !Number.isInteger(data?.seq)) return;
              live = true;
              failures = 0;
              if (data.seq !== seq) {
                seq = data.seq;
                check();
              }
            });
          } catch {
            live = false;
            if (controller.signal.aborted) return;
            failures += 1;
            await pause(Math.min(5000 * 2 ** (failures - 1), 60000));
          } finally {
            controller.signal.removeEventListener("abort", end);
            removeEventListener("visibilitychange", hide);
          }
        }
      } finally {
        live = false;
        listening = false;
      }
    }
    const wake = () => {
      touched = Date.now();
      poll();
      if (usable()) void listen();
    };
    wake();
    const timer = setInterval(poll, 1000);
    const events = ["visibilitychange", "focus", "online", "pointerdown", "keydown"];
    for (const name of events) addEventListener(name, wake, { passive: true });
    return () => {
      sync.stop(); controller.abort(); clearInterval(timer);
      for (const name of events) removeEventListener(name, wake);
      engine.current = null;
    };
  }, [session?.user?.sub, session?.offline, session?.csrf, setChats]);
  const push = useCallback((id) => {
    if (!latest.current.chats.find(chat => chat.id === id)?.temporary) engine.current?.push(id);
  }, []);
  return { issue, push };
}
