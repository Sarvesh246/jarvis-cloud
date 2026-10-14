import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Markdown from "react-markdown";
import {
  ArrowUp,
  Plus,
  SidebarSimple,
  X,
  SignOut,
  Stop,
  ArrowClockwise,
  ChatCircle,
  Compass,
  Code,
  ListChecks,
} from "@phosphor-icons/react";
import { readEvents } from "./stream.js";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-400-italic.css";
import "./style.css";

const freshChat = () => ({
  id: crypto.randomUUID(),
  title: "New chat",
  messages: [],
  updated: Date.now(),
});
const prompts = [
  {
    icon: Compass,
    title: "Explore a question",
    text: "Help me research a topic. First ask what I want to understand, then find reliable sources and explain what matters.",
  },
  {
    icon: Code,
    title: "Create something",
    text: "Help me build something useful. Ask what I have in mind, then work through a practical implementation with me.",
  },
  {
    icon: ListChecks,
    title: "Find a way forward",
    text: "Help me turn an idea into a practical plan. Start by asking what I want to achieve and what constraints matter.",
  },
];

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [cloud, setCloud] = useState("Connecting");
  const [menu, setMenu] = useState(false);
  const [storageIssue, setStorageIssue] = useState(false);
  const googleButton = useRef(null);
  const abort = useRef(null);
  const scrollEnd = useRef(null);
  const textarea = useRef(null);
  const active = chats.find((chat) => chat.id === activeId);

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
    return () => abort.current?.abort();
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
      window.google.accounts.id.renderButton(googleButton.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        width: 280,
      });
    }
    initialize().catch((err) => {
      if (mounted) setError(err.message);
    });
    return () => {
      mounted = false;
    };
  }, [session?.configured, session?.clientId, session?.csrf, session?.user]);

  useEffect(() => {
    scrollEnd.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [active?.messages, progress]);
  useEffect(() => {
    if (textarea.current) {
      textarea.current.style.height = "auto";
      textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 160)}px`;
    }
  }, [draft]);

  function newChat() {
    const chat = freshChat();
    setChats((current) => [chat, ...current].slice(0, 30));
    setActiveId(chat.id);
    setDraft("");
    setError("");
    setMenu(false);
    setProgress("");
    textarea.current?.focus();
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
    setDraft("");
    setBusy(true);
    setError("");
    setProgress("Connecting to Vaelo…");
    const controller = new AbortController();
    abort.current = controller;
    let completed = false;
    let received = "";
    function updateMessage(patch) {
      setChats((current) =>
        current.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: chat.messages.map((message) =>
                  message.id === id ? { ...message, ...patch } : message,
                ),
              }
            : chat,
        ),
      );
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
          setProgress(data.message);
          setCloud("Connected");
        }
        if (name === "hermes.status")
          setProgress(
            String(data.message || data.status || "Vaelo is working…"),
          );
        if (name === "hermes.tool.progress")
          setProgress(
            `${data.status === "completed" ? "Finished" : "Using"} ${data.tool_name || data.name || data.function_name || "a tool"}`,
          );
        if (name === "approval.request")
          throw new Error(
            "This action needs approval through a supported Hermes client. It has not been approved by this website.",
          );
        const choice = data.choices?.[0];
        if (choice?.delta?.content) {
          received += choice.delta.content;
          updateMessage({ content: received });
          setProgress("Writing…");
        }
        if (choice?.finish_reason === "error")
          throw new Error(
            data.hermes?.error || "Vaelo stopped before finishing.",
          );
        if (choice?.finish_reason === "length")
          updateMessage({ truncated: true });
        if (data.usage) updateMessage({ tokens: data.usage.total_tokens });
      });
      if (!completed || !received.trim())
        throw new Error("The response ended before Vaelo delivered an answer.");
    } catch (err) {
      controller.abort();
      const message =
        err.name === "AbortError"
          ? "Stopped. Vaelo may still be finishing its current tool on the server."
          : err.message;
      updateMessage({ failed: true, note: message });
      setError(message);
    } finally {
      setBusy(false);
      setProgress("");
      abort.current = null;
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

  if (loading)
    return (
      <main className="signin">
        <span className="brand">vaelo</span>
        <p role="status">Opening your workspace…</p>
      </main>
    );
  if (!session?.user)
    return (
      <main className="signin">
        <span className="brand">vaelo</span>
        <div className="signin-content">
          <p className="eyebrow">A space of your own</p>
          <h1>
            Room for your
            <br />
            next thought.
          </h1>
          <p>A thoughtful companion for ideas, questions, and the everyday.</p>
          {session?.configured ? (
            <div className="google-button" ref={googleButton} />
          ) : (
            <p className="notice">
              Google sign-in is being connected. Check back shortly.
            </p>
          )}
          <p className="subtle">Access is limited to your Google account.</p>
          {error && (
            <p className="error" role="alert">
              {error}{" "}
              <button className="text-button" onClick={() => location.reload()}>
                Retry
              </button>
            </p>
          )}
        </div>
        <footer>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </footer>
      </main>
    );

  return (
    <div className="workspace">
      {menu && (
        <button
          className="scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside
        className={`sidebar ${menu ? "open" : ""}`}
        aria-label="Chat navigation"
      >
        <div className="sidebar-heading">
          <span className="brand">vaelo</span>
          <button
            className="icon-button mobile-only"
            aria-label="Close navigation"
            onClick={() => setMenu(false)}
          >
            <X size={20} />
          </button>
        </div>
        <button className="new-chat" onClick={newChat} disabled={busy}>
          <Plus size={18} weight="bold" /> New chat
        </button>
        <span className="section-label">Conversations</span>
        <nav className="chat-list">
          {chats.map((chat) => (
            <button
              key={chat.id}
              className={`chat-link ${chat.id === activeId ? "selected" : ""}`}
              disabled={busy}
              onClick={() => {
                setActiveId(chat.id);
                setMenu(false);
                setError("");
                setDraft("");
              }}
            >
              <ChatCircle size={17} />
              <span>{chat.title}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <p className="device-note">Chats saved on this device.</p>
          <div className="account">
            <span className="avatar">{session.user.name[0]}</span>
            <div>
              <strong>{session.user.name}</strong>
              <span>Personal workspace</span>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              title="Sign out"
              disabled={busy}
              onClick={logout}
            >
              <SignOut size={19} />
            </button>
          </div>
        </div>
      </aside>
      <main className="chat-main">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-only"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <SidebarSimple size={22} />
            </button>
            <strong>Vaelo</strong>
            <span className="cloud-label">Personal</span>
          </div>
          <span
            className={`connection ${cloud === "Connected" ? "ready" : ""}`}
            title="Health check only; no model usage"
          >
            {cloud}
          </span>
        </header>
        <div className="conversation">
          {!active?.messages.length ? (
            <div className="welcome">
              <span className="eyebrow">Hello, {session.user.name}.</span>
              <h1>
                Where shall
                <br className="desktop-break" /> we <em>begin?</em>
              </h1>
              <p>
                Bring a question, an idea, or something you’d like to work
                through.
              </p>
              <div className="suggestions">
                {prompts.map(({ icon: Icon, title, text }) => (
                  <button
                    key={title}
                    onClick={() => {
                      setDraft(text);
                      textarea.current?.focus();
                    }}
                  >
                    <Icon size={23} weight="duotone" />
                    <span>{title}</span>
                    <Plus size={16} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages">
              {active.messages.map((message) => (
                <article
                  key={message.id}
                  className={`message ${message.role}`}
                  aria-label={
                    message.role === "user" ? "Your message" : "Vaelo response"
                  }
                >
                  {message.role === "assistant" && (
                    <span className="message-label">Vaelo</span>
                  )}
                  <div className="message-content">
                    {message.content ? (
                      <Markdown
                        components={{
                          a: (props) => (
                            <a
                              {...props}
                              target="_blank"
                              rel="noopener noreferrer"
                            />
                          ),
                          img: ({ alt }) => (
                            <span>[Image: {alt || "external image"}]</span>
                          ),
                        }}
                      >
                        {message.content}
                      </Markdown>
                    ) : busy ? (
                      <span className="thinking">
                        Working<span>…</span>
                      </span>
                    ) : null}
                  </div>
                  {message.truncated && (
                    <p className="subtle">
                      Response reached its output limit. Ask Vaelo to continue.
                    </p>
                  )}
                  {message.failed && (
                    <p className="message-note">{message.note}</p>
                  )}
                  {message.tokens > 0 && (
                    <span className="token-note">
                      {message.tokens.toLocaleString()} tokens
                    </span>
                  )}
                </article>
              ))}
              <div ref={scrollEnd} />
            </div>
          )}
        </div>
        <div className="composer-area">
          {error && (
            <div className="chat-error" role="alert">
              <span>{error}</span>
              <button
                className="text-button"
                onClick={() => send(true)}
                disabled={busy}
              >
                <ArrowClockwise size={16} /> Retry
              </button>
            </div>
          )}
          <div className="progress" role="status" aria-live="polite">
            {busy
              ? progress
              : storageIssue
                ? "Device storage is unavailable. This chat may not survive a refresh."
                : ""}
          </div>
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <textarea
              ref={textarea}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask Vaelo anything…"
              aria-label="Message Vaelo"
              rows={1}
              maxLength={16000}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  !matchMedia("(pointer: coarse)").matches
                ) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            {busy ? (
              <button
                type="button"
                className="send"
                aria-label="Stop response"
                onClick={() => abort.current?.abort()}
              >
                <Stop size={18} weight="fill" />
              </button>
            ) : (
              <button
                className="send"
                type="submit"
                aria-label="Send message"
                disabled={!draft.trim()}
              >
                <ArrowUp size={21} weight="bold" />
              </button>
            )}
          </form>
          <p className="composer-note">
            Research, writing, planning, and a little perspective.
          </p>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
