import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChatSync, readSyncCache, syncKey } from "./chat-sync.js";

export function useChatSync({ session, chats, setChats, busyId, onConflict }) {
  const [issue, setIssue] = useState("");
  const engine = useRef(null);
  const latest = useRef({ chats, busyId, onConflict });
  latest.current = { chats, busyId, onConflict };
  useLayoutEffect(() => {
    if (engine.current && engine.current.sub === session?.user?.sub) engine.current.observe(chats);
    else if (session?.user) {
      try {
        localStorage.setItem(syncKey(session.user.sub), JSON.stringify({
          chats, base: readSyncCache(session.user.sub)?.base || {},
        }));
        localStorage.removeItem(`jarvis-chats:${session.user.sub}`);
      } catch { setIssue("Local backup is full. Keep this tab open until sync completes."); }
    }
  }, [chats, session?.user?.sub]);
  useEffect(() => {
    if (!session?.user || session.offline) return;
    const controller = new AbortController();
    const sync = new ChatSync({
      sub: session.user.sub, chats: latest.current.chats,
      base: readSyncCache(session.user.sub)?.base || {},
      busy: () => Boolean(latest.current.busyId),
      onChange: setChats, onStatus: setIssue,
      onConflict: () => latest.current.onConflict(),
      request: async (path, body) => {
        const response = await fetch(path, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
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
    const run = () => { if (!document.hidden && navigator.onLine !== false) void sync.tick(); };
    run();
    const timer = setInterval(run, 5000);
    addEventListener("visibilitychange", run);
    addEventListener("focus", run);
    addEventListener("online", run);
    return () => {
      sync.stop(); controller.abort(); clearInterval(timer);
      removeEventListener("visibilitychange", run);
      removeEventListener("focus", run);
      removeEventListener("online", run);
      engine.current = null;
    };
  }, [session?.user?.sub, session?.offline, session?.csrf, setChats]);
  return issue;
}
