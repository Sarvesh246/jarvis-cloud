import React, { useEffect, useRef, useState } from "react";
import { IconContext } from "@phosphor-icons/react";
import { readEvents } from "./stream.js";
import { Rail } from "./components/Rail.jsx";
import { Header } from "./components/Header.jsx";
import { Welcome } from "./components/Welcome.jsx";
import { Message } from "./components/Message.jsx";
import { Composer } from "./components/Composer.jsx";
import { Toast, Notice } from "./components/Toast.jsx";
import { Opening, SignIn } from "./components/SignIn.jsx";
import { humanizeTool } from "./lib/format.js";
import "./shell.css";

const freshChat = () => ({
  id: crypto.randomUUID(),
  title: "New conversation",
  messages: [],
  updated: Date.now(),
});

const RAIL_KEY = "vaelo-rail-collapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
}

export function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [livePhase, setLivePhase] = useState("idle");
  const [tool, setTool] = useState("");
  const [settling, setSettling] = useState(false);
  const [cloud, setCloud] = useState("Connecting");
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [storageIssue, setStorageIssue] = useState(false);
  const [toast, setToast] = useState(null);
  const googleButton = useRef(null);
  const abort = useRef(null);
  const textarea = useRef(null);
  const conversation = useRef(null);
  const pinned = useRef(true);
  const fresh = useRef(new Set());
  const toastTimer = useRef(0);
  const settleTimer = useRef(0);
  const active = chats.find((chat) => chat.id === activeId);

  /* What Vaelo's face shows. Errors and rest states are derived, not stored. */
  const phase = busy
    ? livePhase
    : error
      ? "concern"
      : settling
        ? "settling"
        : draft.trim()
          ? "listening"
          : "idle";

  const request = async (path, body) => {
    const response = await fetch(
      path,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": session?.csrf || "",
            },
            body: JSON.stringify(body),
          },
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "That request could not be completed.");
    return result;
  };

  function showToast(next) {
    clearTimeout(toastTimer.current);
    setToast({ id: crypto.randomUUID(), ...next });
    toastTimer.current = setTimeout(() => setToast(null), 6500);
  }

  async function loadSession() {
    try {
      const result = await request("/api/session");
      setSession(result);
      if (result.user) {
        let saved = [];
        try {
          saved = JSON.parse(
            localStorage.getItem(`jarvis-chats:${result.user.sub}`) || "[]",
          );
          saved = Array.isArray(saved)
            ? saved
                .filter(
                  (chat) =>
                    typeof chat.id === "string" && Array.isArray(chat.messages),
                )
                .slice(0, 30)
            : [];
        } catch {
          setStorageIssue(true);
        }
        if (!saved.length) saved = [freshChat()];
        setChats(saved);
        setActiveId(saved[0].id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSession();
    return () => {
      abort.current?.abort();
      clearTimeout(toastTimer.current);
      clearTimeout(settleTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!session?.user || !chats.length) return;
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(
          `jarvis-chats:${session.user.sub}`,
          JSON.stringify(chats.slice(0, 30)),
        );
      } catch {
        setStorageIssue(true);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [chats, session?.user?.sub]);

  useEffect(() => {
    if (!session?.user) return;
    let mounted = true;
    request("/api/status")
      .then((result) => {
        if (mounted) setCloud(result.ready ? "Connected" : "Starting");
      })
      .catch(() => {
        if (mounted) setCloud("Unavailable");
      });
    return () => {
      mounted = false;
    };
  }, [session?.user?.sub]);

  useEffect(() => {
    if (session?.user || !session?.configured || !googleButton.current) return;
    let mounted = true;
    async function initialize() {
      if (!window.google?.accounts) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://accounts.google.com/gsi/client";
          script.async = true;
          script.onload = resolve;
          script.onerror = () =>
            reject(
              new Error(
                "Google sign-in could not load. Check your connection and retry.",
              ),
            );
          document.head.appendChild(script);
        });
      }
      if (!mounted) return;
      window.google.accounts.id.initialize({
        client_id: session.clientId,
        nonce: session.csrf,
        auto_select: false,
        callback: async ({ credential }) => {
          setError("");
          try {
            await request("/api/login", { credential });
            await loadSession();
          } catch (err) {
            setError(err.message);
          }
        },
      });
      const dark = matchMedia("(prefers-color-scheme: dark)").matches;
      window.google.accounts.id.renderButton(googleButton.current, {
        type: "standard",
        theme: dark ? "filled_black" : "outline",
        shape: "pill",
        size: "large",
        width: 300,
      });
    }
    initialize().catch((err) => {
      if (mounted) setError(err.message);
    });
    return () => {
      mounted = false;
    };
  }, [session?.configured, session?.clientId, session?.csrf, session?.user]);

  /* Keep the newest words in view, unless the reader has scrolled up. */
  useEffect(() => {
    const el = conversation.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [active?.messages, activeId]);

  useEffect(() => {
    function onKey(event) {
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!busy) newChat();
      } else if (event.key === "Escape" && busy) {
        abort.current?.abort();
      } else if (event.key === "/" && !typing && session?.user) {
        event.preventDefault();
        textarea.current?.focus();
      }
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  function onScroll() {
    const el = conversation.current;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }

  function newChat() {
    if (active && !active.messages.length) {
      textarea.current?.focus();
      setMenu(false);
      return;
    }
    const chat = freshChat();
    setChats((current) => [chat, ...current].slice(0, 30));
    selectChat(chat.id);
  }

  function selectChat(id) {
    pinned.current = true;
    setActiveId(id);
    setDraft("");
    setError("");
    setMenu(false);
    textarea.current?.focus();
  }

  function renameChat(title) {
    setChats((current) =>
      current.map((chat) => (chat.id === activeId ? { ...chat, title } : chat)),
    );
  }

  function removeChat(id) {
    const removed = chats.find((chat) => chat.id === id);
    if (!removed) return;
    let next = chats.filter((chat) => chat.id !== id);
    if (!next.length) next = [freshChat()];
    setChats(next);
    if (id === activeId) setActiveId(next[0].id);
    if (!removed.messages.length) return;
    showToast({
      text: "Conversation removed.",
      action: "Undo",
      onAction: () => {
        setChats((current) =>
          [removed, ...current.filter((chat) => chat.messages.length)].slice(
            0,
            30,
          ),
        );
        setActiveId(removed.id);
      },
    });
  }

  function toggleRail() {
    setCollapsed((value) => {
      try {
        localStorage.setItem(RAIL_KEY, value ? "0" : "1");
      } catch {
        /* a remembered layout is a nicety, not a need */
      }
      return !value;
    });
  }

  async function send(retry = false) {
    if (busy || !active || (!retry && !draft.trim())) return;
    const chatId = active.id;
    const id = crypto.randomUUID();
    let messages;
    if (retry) {
      const lastUser = active.messages.findLastIndex(
        (message) => message.role === "user",
      );
      if (lastUser < 0) return;
      messages = active.messages.slice(0, lastUser + 1);
    } else {
      messages = [
        ...active.messages,
        { id: crypto.randomUUID(), role: "user", content: draft.trim() },
      ];
    }
    const input = messages
      .filter((message) => message.content && !message.failed)
      .map(({ role, content }) => ({ role, content }));
    fresh.current.add(messages[messages.length - 1].id);
    fresh.current.add(id);
    pinned.current = true;
    setChats((current) =>
      current.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              title: chat.messages.length
                ? chat.title
                : messages[0].content.slice(0, 48),
              updated: Date.now(),
              messages: [...messages, { id, role: "assistant", content: "" }],
            }
          : chat,
      ),
    );
    clearTimeout(settleTimer.current);
    setSettling(false);
    setDraft("");
    setBusy(true);
    setError("");
    setTool("");
    setLivePhase("thinking");
    const controller = new AbortController();
    abort.current = controller;
    let completed = false;
    let received = "";
    let succeeded = false;
    function updateMessage(patch) {
      setChats((current) =>
        current.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: chat.messages.map((message) =>
                  message.id === id
                    ? {
                        ...message,
                        ...(typeof patch === "function"
                          ? patch(message)
                          : patch),
                      }
                    : message,
                ),
              }
            : chat,
        ),
      );
    }
    function noteTool(name, done) {
      updateMessage((message) => {
        const list = [...(message.activity || [])];
        const open = list.findLastIndex(
          (item) => item.name === name && !item.done,
        );
        if (done && open >= 0) list[open] = { ...list[open], done: true };
        else if (done)
          list.push({ id: crypto.randomUUID(), name, done: true });
        else if (open < 0)
          list.push({ id: crypto.randomUUID(), name, done: false });
        return { activity: list.slice(-8) };
      });
    }
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf,
        },
        body: JSON.stringify({ conversationId: chatId, messages: input }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Vaelo could not respond.");
      }
      if (!response.body)
        throw new Error("Streaming is not available in this browser.");
      await readEvents(response.body, (name, data) => {
        if (name === "jarvis.error" || data.error)
          throw new Error(
            data.message || data.error?.message || "Vaelo could not finish.",
          );
        if (name === "jarvis.complete") completed = true;
        if (name === "jarvis.status") {
          setLivePhase(/wake|idle/i.test(data.message || "") ? "waking" : "thinking");
          setCloud("Connected");
        }
        if (name === "hermes.status") setLivePhase("thinking");
        if (name === "hermes.tool.progress") {
          const raw = data.tool_name || data.name || data.function_name || "tool";
          const done = data.status === "completed";
          setTool(done ? "" : humanizeTool(raw));
          setLivePhase(done ? "thinking" : "working");
          noteTool(raw, done);
        }
        if (name === "approval.request")
          throw new Error(
            "This needs your approval in a supported Hermes app. Nothing has been approved from this site.",
          );
        const choice = data.choices?.[0];
        if (choice?.delta?.content) {
          received += choice.delta.content;
          updateMessage({ content: received });
          setLivePhase("speaking");
          setTool("");
        }
        if (choice?.finish_reason === "error")
          throw new Error(
            data.hermes?.error || "Vaelo stopped before finishing.",
          );
        if (choice?.finish_reason === "length")
          updateMessage({ truncated: true });
      });
      if (!completed || !received.trim())
        throw new Error("The response ended before Vaelo delivered an answer.");
      succeeded = true;
    } catch (err) {
      controller.abort();
      const message =
        err.name === "AbortError"
          ? "Stopped. Vaelo may still be finishing its current step on the server."
          : err.message;
      updateMessage({ failed: true, note: message });
      setError(message);
    } finally {
      updateMessage((message) =>
        message.activity
          ? {
              activity: message.activity.map((item) => ({
                ...item,
                done: true,
              })),
            }
          : {},
      );
      setBusy(false);
      setLivePhase("idle");
      setTool("");
      abort.current = null;
      if (succeeded) {
        setSettling(true);
        settleTimer.current = setTimeout(() => setSettling(false), 1500);
      }
      textarea.current?.focus();
    }
  }

  async function logout() {
    try {
      await request("/api/logout", {});
      setChats([]);
      setActiveId(null);
      setSession(null);
      await loadSession();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <Opening />;
  if (!session?.user)
    return (
      <SignIn
        configured={session?.configured}
        error={error}
        buttonRef={googleButton}
      />
    );

  const messages = active?.messages || [];

  return (
    <IconContext.Provider value={{ weight: "light", size: 20 }}>
      <div className="shell" data-collapsed={collapsed}>
        {menu && (
          <button
            className="scrim"
            aria-label="Close conversations"
            onClick={() => setMenu(false)}
          />
        )}
        <Rail
          chats={chats}
          activeId={activeId}
          busy={busy}
          open={menu}
          collapsed={collapsed}
          user={session.user}
          onClose={() => setMenu(false)}
          onNew={newChat}
          onSelect={selectChat}
          onDelete={removeChat}
          onSignOut={logout}
        />

        <main className="stage">
          <Header
            title={active?.title || "New conversation"}
            canRename={messages.length > 0 && !busy}
            phase={phase}
            cloud={cloud}
            tool={tool}
            onRename={renameChat}
            onOpenRail={() => setMenu(true)}
            onToggleRail={toggleRail}
          />

          <div className="conversation" ref={conversation} onScroll={onScroll}>
            {!messages.length ? (
              <Welcome
                name={session.user.name}
                phase={phase}
                onPick={(text) => {
                  setDraft(text);
                  textarea.current?.focus();
                }}
              />
            ) : (
              <div className="thread">
                {messages.map((message, index) => {
                  const last = index === messages.length - 1;
                  const mine = message.role === "user";
                  return (
                    <Message
                      key={message.id}
                      message={message}
                      fresh={fresh.current.has(message.id)}
                      busy={busy}
                      phase={livePhase}
                      streaming={busy && last && !mine && !!message.content}
                      isLast={last && !mine}
                      onRetry={() => send(true)}
                    />
                  );
                })}
              </div>
            )}
          </div>

          <div className="dock">
            {error && !busy && messages.length > 0 && (
              <Notice
                action="Try again"
                onAction={() => send(true)}
                disabled={busy}
              >
                {error}
              </Notice>
            )}
            {storageIssue && (
              <Notice tone="brass">
                This browser isn’t saving conversations, so this one may not
                survive a refresh.
              </Notice>
            )}
            <Composer
              ref={textarea}
              draft={draft}
              busy={busy}
              onChange={setDraft}
              onSend={() => send()}
              onStop={() => abort.current?.abort()}
            />
            <p className="dock-note">
              Vaelo can make mistakes. Check anything important.
            </p>
          </div>
        </main>

        <Toast toast={toast} onDismiss={() => setToast(null)} />
      </div>
    </IconContext.Provider>
  );
}
