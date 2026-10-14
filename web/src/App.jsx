import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowDown, FileArrowUp, IconContext, Quotes } from "@phosphor-icons/react";
import { readEvents } from "./stream.js";
import { Rail } from "./components/Rail.jsx";
import { Header } from "./components/Header.jsx";
import { Welcome } from "./components/Welcome.jsx";
import { Message, liveLine } from "./components/Message.jsx";
import { Composer } from "./components/Composer.jsx";
import { Workspace } from "./components/Workspace.jsx";
import { Settings } from "./components/Settings.jsx";
import { Mark } from "./components/Mark.jsx";
import { PresentationContext } from "./components/blocks/Blocks.jsx";
import { applyPrefs, readPrefs, savePrefs } from "./lib/preferences.js";
import { requestRevision } from "./lib/revise.js";
import { Toast, Notice } from "./components/Toast.jsx";
import { Opening, SignIn } from "./components/SignIn.jsx";
import { toolInfo } from "./lib/tools.js";
import { classifyError } from "./lib/errors.js";
import {
  IMAGE_LIMIT,
  MESSAGE_LIMIT,
  composeContent,
  fitHistory,
  isImage,
  readAttachment,
  wireMessage,
} from "./lib/attachments.js";
import "./shell.css";

const freshChat = () => ({
  id: crypto.randomUUID(),
  title: "New conversation",
  messages: [],
  updated: Date.now(),
});

const RAIL_KEY = "vaelo-rail-collapsed";
/* A phone, upright or on its side: the layout that uses the drawer */
const PHONE = "(max-width: 47.9375rem), (pointer: coarse) and (max-height: 31.25rem)";
/* Who was signed in last, so the installed app can open your conversations
   to read while offline. Only the account id and display name are kept. */
const LAST_USER_KEY = "vaelo-last-user";

/* The conversation open in this tab or app window. Session storage outlives
   a reload but not a fresh launch, which is exactly the line we want. */
const OPEN_CHAT_KEY = "vaelo-open-chat";

function readOpenChat() {
  try {
    return sessionStorage.getItem(OPEN_CHAT_KEY);
  } catch {
    return null;
  }
}

function readLastUser() {
  try {
    const user = JSON.parse(localStorage.getItem(LAST_USER_KEY) || "null");
    return user && typeof user.sub === "string" ? { sub: user.sub, name: String(user.name || "") } : null;
  } catch {
    return null;
  }
}

/* Signing in through Google's own page. Google's in-page button lives in a
   third-party frame that Safari content blockers and tracking protection
   can hide, which leaves an empty gap. This route has no frame: Google
   sends an ID token back in the address fragment, and /api/login verifies
   it exactly as it verifies the button's (nonce = this browser's CSRF
   value). The state value guards against a sign-in started elsewhere. */
const OAUTH_KEY = "vaelo-google-state";

function googleRedirect(session) {
  const state = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  try {
    localStorage.setItem(OAUTH_KEY, JSON.stringify({ state, at: Date.now() }));
  } catch {
    /* without storage the return is refused, which is the safe outcome */
  }
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: session.clientId,
    redirect_uri: `${location.origin}/`,
    response_type: "id_token",
    scope: "openid email profile",
    nonce: session.csrf,
    state,
    prompt: "select_account",
  });
  location.assign(url);
}

function takeGoogleReturn() {
  if (!/(^|[#&])(id_token|error)=/.test(location.hash)) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, "", location.pathname + location.search);
  let expected = null;
  try {
    expected = JSON.parse(localStorage.getItem(OAUTH_KEY) || "null");
    localStorage.removeItem(OAUTH_KEY);
  } catch {
    expected = null;
  }
  if (params.get("error"))
    return {
      error:
        params.get("error") === "access_denied"
          ? "Sign-in was cancelled."
          : "Google couldn’t finish signing you in. Try again.",
    };
  if (!expected || expected.state !== params.get("state") || Date.now() - expected.at > 600000)
    return { error: "That sign-in had expired. Try again." };
  return { credential: params.get("id_token") };
}

let googleReturn = typeof location === "undefined" ? null : takeGoogleReturn();

/* An app installed to an iPhone home screen handles Google's pop-up poorly,
   so it signs in through Google's page from the start. */
const preferRedirect =
  typeof navigator !== "undefined" &&
  /iPhone|iPad|iPod/.test(navigator.userAgent) &&
  (navigator.standalone === true || matchMedia("(display-mode: standalone)").matches);

/* One shared load of Google's sign-in script; a retry starts it afresh. */
let googleScript = null;
function loadGoogle() {
  googleScript ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = resolve;
    script.onerror = () => {
      script.remove();
      reject(new Error("Google sign-in could not load."));
    };
    document.head.appendChild(script);
  });
  return googleScript;
}
const KEEP = 30;

/* Pinned conversations are never the ones that fall off the end. */
function cap(list) {
  const pinned = list.filter((chat) => chat.pinned);
  const rest = list.filter((chat) => !chat.pinned);
  return [...pinned, ...rest].slice(0, Math.max(KEEP, pinned.length));
}

/* The parts of a reply that make up one version of it. */
const snapshot = ({
  content,
  activity,
  thoughtMs,
  truncated,
  stopped,
  failed,
  interrupted,
  errorKind,
  approval,
  note,
  context,
  reasoning,
  notes,
  usage,
}) => ({
  content,
  activity,
  thoughtMs,
  truncated,
  stopped,
  failed,
  interrupted,
  errorKind,
  approval,
  note,
  context,
  reasoning,
  notes,
  usage,
});

function readCollapsed() {
  try {
    return localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
}

const quoted = (text) =>
  text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

/* Work that finishes while you're elsewhere says so where you'll see it:
   the tab title always, the app badge and a notification if you asked. */
async function tellReady(title, content) {
  try {
    await navigator.setAppBadge?.(1);
  } catch {
    /* badges need notification permission on some systems */
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const body = content.replace(/```[\s\S]*?(```|$)|[#>*_`|[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
  const options = { body, tag: "vaelo-reply", icon: "/icons/vaelo-192-v5.png", badge: "/icons/vaelo-192-v5.png" };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) await registration.showNotification(`Vaelo replied · ${title}`, options);
    else new Notification(`Vaelo replied · ${title}`, options);
  } catch {
    /* the title change still says it */
  }
}

const reducedMotion = () =>
  document.documentElement.dataset.motion === "reduce" ||
  matchMedia("(prefers-reduced-motion: reduce)").matches;

export function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [options, setOptions] = useState({ research: false, style: "balanced" });
  const [busy, setBusy] = useState(false);
  const [livePhase, setLivePhase] = useState("idle");
  const [settling, setSettling] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [cloud, setCloud] = useState("Connecting");
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [storageIssue, setStorageIssue] = useState(false);
  const [toast, setToast] = useState(null);
  const [away, setAway] = useState(false);
  const [workspace, setWorkspace] = useState(null);
  const [quote, setQuote] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState({ id: 0, text: "" });
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [prefs, setPrefs] = useState(readPrefs);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const swipe = useRef(null);
  const googleButton = useRef(null);
  const [gsi, setGsi] = useState("loading");
  const [gsiAttempt, setGsiAttempt] = useState(0);
  const abort = useRef(null);
  const textarea = useRef(null);
  const conversation = useRef(null);
  const pinned = useRef(true);
  const fresh = useRef(new Set());
  /* Full-size images stay in memory only; conversations keep thumbnails. */
  const imageData = useRef(new Map());
  const toastTimer = useRef(0);
  const settleTimer = useRef(0);
  const active = chats.find((chat) => chat.id === activeId);
  const messages = active?.messages || [];

  /* What Vaelo's face shows. Errors and rest states are derived, not stored. */
  const phase = busy
    ? livePhase
    : error
      ? "concern"
      : settling
        ? "settling"
        : draft.trim() || dictating
          ? "listening"
          : "idle";

  const length = useMemo(() => composeContent(draft, attachments).length, [draft, attachments]);

  const announce = (text) => setAnnouncement((current) => ({ id: current.id + 1, text }));

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

  /* A fresh launch opens on a new conversation, reusing an empty one rather
     than piling them up. The chat this tab already had open (a reload, or the
     phone reviving a backgrounded app) comes back instead, unless the app was
     opened from its "New conversation" shortcut. */
  function chooseOpening(saved) {
    const shortcut = new URLSearchParams(location.search).has("new");
    if (shortcut) history.replaceState(null, "", "/");
    const open = readOpenChat();
    if (!shortcut && saved.some((chat) => chat.id === open)) return { list: saved, id: open };
    const empty = saved.find((chat) => !chat.messages.length && !chat.pinned);
    const chat = empty || freshChat();
    return { list: [chat, ...saved.filter((other) => other !== chat)], id: chat.id };
  }

  async function loadSession() {
    try {
      let result;
      try {
        result = await request("/api/session");
      } catch (err) {
        /* No signal: open the saved conversations to read, and pick the
           session back up as soon as the connection returns. */
        const last = readLastUser();
        if (!last || (navigator.onLine !== false && err.name !== "TypeError")) throw err;
        result = { user: last, csrf: "", configured: true, offline: true };
      }
      if (!result.user && googleReturn) {
        const back = googleReturn;
        googleReturn = null;
        if (back.error) setError(back.error);
        else {
          const response = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": result.csrf },
            body: JSON.stringify({ credential: back.credential }),
          });
          const signed = await response.json().catch(() => ({}));
          if (!response.ok) setError(signed.error || "Google sign-in could not be verified.");
          else return await loadSession();
        }
      }
      setSession(result);
      if (result.user) {
        try {
          localStorage.setItem(
            LAST_USER_KEY,
            JSON.stringify({ sub: result.user.sub, name: result.user.name }),
          );
        } catch {
          /* reading offline is a nicety */
        }
        let saved = [];
        try {
          saved = JSON.parse(
            localStorage.getItem(`jarvis-chats:${result.user.sub}`) || "[]",
          );
          saved = Array.isArray(saved)
            ? cap(
                saved.filter(
                  (chat) =>
                    typeof chat.id === "string" && Array.isArray(chat.messages),
                ),
              )
            : [];
        } catch {
          setStorageIssue(true);
        }
        const opening = chooseOpening(saved);
        setChats(cap(opening.list));
        setActiveId(opening.id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSession();
    const ready = () => {
      if (document.hidden) return;
      if (document.title !== "Vaelo") document.title = "Vaelo";
      navigator.clearAppBadge?.().catch(() => {});
    };
    addEventListener("visibilitychange", ready);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    addEventListener("online", goOnline);
    addEventListener("offline", goOffline);
    return () => {
      removeEventListener("online", goOnline);
      removeEventListener("offline", goOffline);
      abort.current?.abort();
      clearTimeout(toastTimer.current);
      clearTimeout(settleTimer.current);
      removeEventListener("visibilitychange", ready);
    };
  }, []);

  useEffect(() => {
    applyPrefs(prefs);
    savePrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    if (!activeId) return;
    try {
      sessionStorage.setItem(OPEN_CHAT_KEY, activeId);
    } catch {
      /* without it, a reload opens a new conversation */
    }
  }, [activeId]);

  /* Back online after opening offline: fetch the real session quietly. */
  useEffect(() => {
    if (online && session?.offline) loadSession();
  }, [online, session?.offline]);

  useEffect(() => {
    if (!session?.user || !chats.length) return;
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(
          `jarvis-chats:${session.user.sub}`,
          JSON.stringify(cap(chats)),
        );
      } catch {
        setStorageIssue(true);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [chats, session?.user?.sub]);

  useEffect(() => {
    if (!session?.user || session.offline) return;
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

  /* Google draws its own button in an iframe. Until it appears there is a
     visible placeholder, and if it never does (a content blocker, a hung
     script) the page says so and offers a retry instead of showing nothing. */
  useEffect(() => {
    if (session?.user || !session?.configured || !googleButton.current || preferRedirect) return;
    let mounted = true;
    const box = googleButton.current;
    setGsi("loading");
    const giveUp = setTimeout(() => {
      if (mounted && !box.querySelector("iframe")) setGsi("failed");
    }, 8000);
    function draw() {
      box.replaceChildren();
      const dark = matchMedia("(prefers-color-scheme: dark)").matches;
      window.google.accounts.id.renderButton(box, {
        type: "standard",
        theme: dark ? "filled_black" : "outline",
        shape: "pill",
        size: "large",
        width: Math.min(320, box.parentElement?.clientWidth || 320),
        text: "signin_with",
      });
      const frame = box.querySelector("iframe");
      if (!frame) return setGsi("failed");
      /* A content blocker can hide the frame after it loads; if it isn't
         actually on screen, offer the other way in. */
      const check = () => {
        if (!mounted) return;
        const style = getComputedStyle(frame);
        const shown =
          frame.isConnected &&
          frame.offsetHeight > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0;
        setGsi(shown ? "ready" : "hidden");
      };
      frame.addEventListener("load", () => setTimeout(check, 300), { once: true });
      setTimeout(check, 3500);
    }
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const redraw = () => window.google?.accounts && draw();
    async function initialize() {
      if (!window.google?.accounts) await loadGoogle();
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
      draw();
      scheme.addEventListener("change", redraw);
    }
    initialize().catch(() => {
      if (mounted) setGsi("failed");
    });
    return () => {
      mounted = false;
      clearTimeout(giveUp);
      scheme.removeEventListener("change", redraw);
    };
  }, [session?.configured, session?.clientId, session?.csrf, session?.user, gsiAttempt]);

  /* Keep the newest words in view, but only while the reader is already at
     the bottom. Runs before paint so following never visibly jumps. */
  useLayoutEffect(() => {
    const el = conversation.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages, activeId]);

  /* Blocks can grow after their words arrive (a table settling, a font
     loading). While a reply is landing, the anchor follows those too. */
  const following = useRef(0);
  useEffect(() => {
    if (busy) following.current = Infinity;
    else following.current = Date.now() + 1500;
  }, [busy]);
  useEffect(() => {
    const el = conversation.current;
    const thread = el?.firstElementChild;
    if (!thread || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinned.current && Date.now() < following.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(thread);
    return () => observer.disconnect();
  }, [activeId, messages.length > 0]);

  useEffect(() => {
    function onKey(event) {
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!busy) newChat();
      } else if (event.key === "Escape" && busy) {
        abort.current?.abort();
      } else if (event.key === "Escape" && workspace) {
        setWorkspace(null);
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
    setAway(!pinned.current);
    setQuote(null);
  }

  /* Scrolling up is a decision. Honour it at once, before the next words
     arrive and the follow logic could pull the reader back down. */
  function onWheel(event) {
    if (event.deltaY < 0) pinned.current = false;
  }

  function jumpToLatest() {
    const el = conversation.current;
    pinned.current = true;
    setAway(false);
    el?.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
  }

  function newChat() {
    if (active && !active.messages.length) {
      textarea.current?.focus();
      setMenu(false);
      return;
    }
    const chat = freshChat();
    setChats((current) => cap([chat, ...current]));
    selectChat(chat.id);
  }

  function selectChat(id) {
    pinned.current = true;
    setAway(false);
    setActiveId(id);
    setDraft("");
    setAttachments([]);
    setError("");
    setMenu(false);
    setWorkspace(null);
    setQuote(null);
    textarea.current?.focus();
  }

  function renameChat(title) {
    setChats((current) =>
      current.map((chat) => (chat.id === activeId ? { ...chat, title } : chat)),
    );
  }

  function togglePin(id) {
    setChats((current) =>
      current.map((chat) => (chat.id === id ? { ...chat, pinned: !chat.pinned } : chat)),
    );
  }

  function removeChat(id) {
    const removed = chats.find((chat) => chat.id === id);
    if (!removed) return;
    let next = chats.filter((chat) => chat.id !== id);
    if (!next.length) next = [freshChat()];
    setChats(next);
    if (id === activeId) selectChat(next[0].id);
    if (!removed.messages.length) return;
    showToast({
      text: "Conversation removed.",
      action: "Undo",
      onAction: () => {
        setChats((current) =>
          cap([removed, ...current.filter((chat) => chat.messages.length)]),
        );
        selectChat(removed.id);
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

  function updateChatMessage(chatId, id, patch) {
    setChats((current) =>
      current.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              messages: chat.messages.map((message) =>
                message.id === id
                  ? {
                      ...message,
                      ...(typeof patch === "function" ? patch(message) : patch),
                    }
                  : message,
              ),
            }
          : chat,
      ),
    );
  }

  /* A document's versions live with the conversation it came from */
  function updateWork(messageId, next) {
    setChats((current) =>
      current.map((chat) =>
        chat.id === activeId
          ? { ...chat, updated: Date.now(), works: { ...chat.works, [messageId]: next } }
          : chat,
      ),
    );
  }

  /* From the library: go to the conversation, then open the work beside it */
  function openWork(entry) {
    if (entry.chatId !== activeId) selectChat(entry.chatId);
    setMenu(false);
    setWorkspace(entry.item);
  }

  /* Back from a document to the reply it began as, briefly marked */
  function revealMessage(id) {
    if (matchMedia("(max-width: 74.9375rem)").matches) setWorkspace(null);
    requestAnimationFrame(() => {
      const el = document.getElementById(`m-${id}`);
      if (!el) return;
      pinned.current = false;
      el.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
      el.dataset.found = "";
      setTimeout(() => delete el.dataset.found, 1800);
    });
  }

  /* Swap which version of a reply is current. The shown version is the one
     Vaelo remembers, so the conversation always continues from it. */
  function selectVersion(id, index) {
    updateChatMessage(activeId, id, (message) => {
      const versions = message.versions.map((version, i) =>
        i === message.version ? snapshot(message) : version,
      );
      return { ...snapshot(versions[index]), versions, version: index };
    });
  }

  /* A branch is a new conversation that starts from this point, leaving the
     original exactly as it was. */
  function branchFrom(id) {
    const at = active.messages.findIndex((message) => message.id === id);
    if (at < 0) return;
    const origin = active.id;
    const chat = {
      ...freshChat(),
      title: `${active.title} · branch`.slice(0, 80),
      messages: structuredClone(active.messages.slice(0, at + 1)),
    };
    setChats((current) => cap([chat, ...current]));
    selectChat(chat.id);
    showToast({
      text: "Branched into a new conversation.",
      action: "Go back",
      onAction: () => selectChat(origin),
    });
  }

  /* When a conversation has outgrown the context, carry the thread of it
     into a fresh one instead of leaving the person stuck. */
  function carryOver() {
    const last = active.messages.findLast((message) => message.role === "user");
    const chat = freshChat();
    setChats((current) => cap([chat, ...current]));
    selectChat(chat.id);
    setDraft(
      `Picking up from “${active.title}”.\n\n${last ? (last.text ?? last.content) : ""}`.trim(),
    );
  }

  async function addFiles(files) {
    const room = 8 - attachments.length;
    const list = files.slice(0, Math.max(0, room));
    if (!list.length) return;
    const pending = list.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name || "Pasted file",
      size: file.size,
      kind: isImage(file) ? "image" : "file",
      state: "reading",
    }));
    setAttachments((current) => [...current, ...pending]);
    let images = attachments.filter((file) => file.kind === "image").length;
    await Promise.all(
      list.map(async (file, i) => {
        let read;
        if (isImage(file) && ++images > IMAGE_LIMIT)
          read = { kind: "image", state: "unsupported", note: "Up to four images per message." };
        else
          read = await readAttachment(file).catch(() => ({
            state: "unsupported",
            note: "This file couldn’t be read.",
          }));
        if (read.kind === "image" && read.data) {
          imageData.current.set(pending[i].id, read.data);
          delete read.data;
        }
        setAttachments((current) =>
          current.map((item) =>
            item.id === pending[i].id
              ? { ...read, id: item.id, name: item.name, size: item.size, kind: read.kind || item.kind }
              : item,
          ),
        );
      }),
    );
    textarea.current?.focus();
  }

  function checkSelection() {
    setTimeout(() => {
      const selection = getSelection();
      const text = selection?.toString().trim();
      if (!text || !selection.rangeCount) return setQuote(null);
      const element = (node) => (node?.nodeType === 1 ? node : node?.parentElement);
      const prose = element(selection.anchorNode)?.closest(
        '.message[data-role="assistant"] .prose',
      );
      if (!prose || !prose.contains(selection.focusNode)) return setQuote(null);
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const below = rect.top < 72;
      setQuote({
        text: text.slice(0, 1500),
        x: Math.min(innerWidth - 120, Math.max(120, rect.left + rect.width / 2)),
        y: below ? rect.bottom + 8 : rect.top - 8,
        below,
      });
    });
  }

  function askAbout() {
    if (!quote) return;
    setDraft((current) => `${quoted(quote.text)}\n\n${current}`.replace(/\n+$/, "\n\n"));
    setQuote(null);
    getSelection()?.removeAllRanges();
    textarea.current?.focus();
  }

  /* Answer a paused run from here. The stream is still open and waiting, so
     Vaelo carries on (or stops that step) the moment Hermes hears back. */
  async function answerApproval(id, choice) {
    const message = active?.messages.find((m) => m.id === id);
    const approval = message?.approval;
    if (!approval || approval.state !== "pending") return;
    const patch = (next) =>
      updateChatMessage(active.id, id, (m) => ({ approval: { ...m.approval, ...next } }));
    patch({ state: "sending", choice });
    try {
      await request("/api/approval", {
        runId: approval.runId,
        choice,
        ...(approval.requestId && { requestId: approval.requestId }),
      });
      patch({ state: choice === "deny" ? "denied" : "approved", choice });
      announce(choice === "deny" ? "Denied." : "Approved. Vaelo is carrying on.");
      setLivePhase(choice === "deny" ? "thinking" : "working");
    } catch (err) {
      patch({ state: "pending", note: err.message });
    }
  }

  async function send({ retry = false, text, edit } = {}) {
    if (busy || !active || !online || session?.offline) return;
    const chatId = active.id;
    const id = crypto.randomUUID();
    const mode = { research: options.research, style: options.style };
    let messages;
    let versions;
    if (edit) {
      const at = active.messages.findIndex((message) => message.id === edit.id);
      if (at < 0) return;
      const original = active.messages[at];
      const files = original.attachments || [];
      messages = [
        ...active.messages.slice(0, at),
        {
          id: crypto.randomUUID(),
          role: "user",
          content: composeContent(edit.text, files),
          mode,
          ...(files.length && { text: edit.text, attachments: files }),
        },
      ];
    } else if (retry) {
      const lastUser = active.messages.findLastIndex(
        (message) => message.role === "user",
      );
      if (lastUser < 0) return;
      messages = active.messages.slice(0, lastUser + 1);
      messages[lastUser] = { ...messages[lastUser], mode };
      const previous = active.messages[lastUser + 1];
      if (previous) {
        const kept = (
          previous.versions
            ? previous.versions.map((version, i) =>
                i === previous.version ? snapshot(previous) : version,
              )
            : [snapshot(previous)]
        ).filter((version) => version.content);
        if (kept.length) versions = kept;
      }
    } else {
      const typed = (text ?? draft).trim();
      const files =
        text === undefined ? attachments.filter((file) => file.state === "ready") : [];
      if (!typed && !files.length) return;
      const content = composeContent(typed, files);
      if (content.length > MESSAGE_LIMIT) return;
      messages = [
        ...active.messages,
        {
          id: crypto.randomUUID(),
          role: "user",
          content,
          mode,
          ...(files.length && {
            text: typed,
            attachments: files.map(({ id, name, size, chars, body, state, kind, thumb }) => ({
              id,
              name,
              size,
              chars,
              body,
              state,
              kind,
              thumb,
            })),
          }),
        },
      ];
    }
    const sendable = messages.filter(
      (message) => (message.content || message.attachments?.length) && !message.failed,
    );
    const wired = sendable.map((message, i) =>
      wireMessage(message, { latest: i === sendable.length - 1, images: imageData.current }),
    ).filter((message) => (typeof message.content === "string" ? message.content.trim() : message.content.length));
    const { messages: input, dropped } = fitHistory(wired);
    const lastUser = messages[messages.length - 1];
    const context = {
      turns: input.length - 1,
      dropped,
      files: (lastUser.attachments || []).map((file) => file.name),
      research: mode.research,
      style: mode.style,
    };
    fresh.current.add(lastUser.id);
    fresh.current.add(id);
    pinned.current = true;
    setChats((current) =>
      current.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              title: chat.messages.length
                ? chat.title
                : (messages[0].text || messages[0].attachments?.[0]?.name || messages[0].content).slice(0, 48),
              updated: Date.now(),
              messages: [
                ...messages,
                {
                  id,
                  role: "assistant",
                  content: "",
                  startedAt: Date.now(),
                  context,
                  ...(versions && { versions, version: versions.length }),
                },
              ],
            }
          : chat,
      ),
    );
    clearTimeout(settleTimer.current);
    setSettling(false);
    if (!retry && !edit && text === undefined) {
      setDraft("");
      setAttachments([]);
    }
    setBusy(true);
    setError("");
    setLivePhase("thinking");
    setQuote(null);
    announce(mode.research ? "Vaelo is researching." : "Vaelo is thinking.");
    const controller = new AbortController();
    abort.current = controller;
    let completed = false;
    let received = "";
    let reasoning = "";
    let succeeded = false;
    let frame = 0;
    let runId = "";
    let pendingApproval = false;
    const startedAt = Date.now();
    const updateMessage = (patch) => updateChatMessage(chatId, id, patch);
    /* Words are committed once per frame, not once per network fragment. */
    const flush = () => {
      frame = 0;
      updateMessage({ content: received, ...(reasoning && { reasoning: reasoning.slice(-12000) }) });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(flush);
    };
    function noteTool({ tool, callId, label, done }) {
      updateMessage((message) => {
        const list = [...(message.activity || [])];
        const at = list.findLastIndex((item) =>
          callId ? item.callId === callId : item.tool === tool && !item.done,
        );
        const now = Date.now();
        if (at >= 0) {
          if (done) list[at] = { ...list[at], done: true, endedAt: now };
        } else {
          list.push({
            id: crypto.randomUUID(),
            callId,
            tool,
            label,
            done,
            startedAt: now,
            ...(done && { endedAt: now }),
          });
        }
        return { activity: list.slice(-24) };
      });
    }
    function onEvent(name, data) {
      if (name === "jarvis.error")
        throw Object.assign(new Error(data.message || "Vaelo could not finish."), {
          status: data.status,
        });
      if (name === "jarvis.complete") completed = true;
      if (name === "jarvis.status") {
        setLivePhase(/wake|idle/i.test(data.message || "") ? "waking" : "thinking");
        setCloud("Connected");
      }
      if (name === "hermes.status") {
        const note = String(data.text || data.message || "").trim();
        if (note) {
          updateMessage((message) => ({
            live: note.slice(0, 160),
            notes: [...(message.notes || []), { kind: data.kind || "status", text: note.slice(0, 300) }].slice(-8),
          }));
        }
        setLivePhase((current) => (current === "waking" ? "thinking" : current));
      }
      if (name === "hermes.tool.progress") {
        const tool = data.tool || data.tool_name || data.name || data.function_name || "tool";
        const done = data.status === "completed";
        setLivePhase(pendingApproval ? "listening" : done ? "thinking" : "working");
        noteTool({ tool, callId: data.toolCallId || data.tool_call_id, label: data.label, done });
        if (!done) announce(toolInfo(tool).now);
      }
      if (name === "approval.request") {
        pendingApproval = true;
        const offered = Array.isArray(data.choices) ? data.choices : ["once", "deny"];
        updateMessage({
          approval: {
            runId: data.run_id || runId,
            requestId: typeof data.request_id === "string" ? data.request_id : undefined,
            command: typeof data.command === "string" ? data.command.slice(0, 2000) : "",
            description: typeof data.description === "string" ? data.description.slice(0, 400) : "",
            choices: ["once", "session", "deny"].filter((choice) => offered.includes(choice)),
            state: "pending",
          },
        });
        setLivePhase("listening");
        announce("Vaelo is asking for your approval.");
        return;
      }
      if (typeof data.id === "string" && data.id.startsWith("chatcmpl-")) runId = data.id;
      const choice = data.choices?.[0];
      if (data.usage) updateMessage({ usage: data.usage });
      if (choice?.delta?.reasoning_content) {
        reasoning += choice.delta.reasoning_content;
        schedule();
      }
      if (choice?.delta?.content) {
        if (!received) updateMessage({ thoughtMs: Date.now() - startedAt, live: "" });
        received += choice.delta.content;
        schedule();
        setLivePhase("speaking");
      }
      // A truncated reply also carries an error object; it is not a failure.
      if (choice?.finish_reason === "length") {
        updateMessage({ truncated: true });
        return;
      }
      if (choice?.finish_reason === "error" || data.error)
        throw new Error(
          data.error?.message || data.hermes?.error || "Vaelo stopped before finishing.",
        );
    }
    try {
      /* A busy cloud (it runs one reply at a time) is waited out quietly a
         couple of times before it is reported. */
      for (let attempt = 0; ; attempt += 1) {
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
            const result = await response.json().catch(() => ({}));
            throw Object.assign(new Error(result.error || "Vaelo could not respond."), {
              status: response.status,
            });
          }
          if (!response.body)
            throw new Error("Streaming is not available in this browser.");
          await readEvents(response.body, onEvent);
          break;
        } catch (err) {
          const busyNow =
            err.name !== "AbortError" &&
            !received &&
            !pendingApproval &&
            attempt < 2 &&
            classifyError({ name: err.name, message: err.message, status: err.status }).kind === "busy";
          if (!busyNow) throw err;
          updateMessage({ live: "Vaelo is finishing something else. Trying again in a moment" });
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, attempt ? 8000 : 4000);
            controller.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(Object.assign(new Error("Stopped"), { name: "AbortError" }));
              },
              { once: true },
            );
          });
          updateMessage({ live: "" });
        }
      }
      if (!completed || !received.trim())
        throw new Error("The response ended before Vaelo delivered an answer.");
      succeeded = true;
    } catch (err) {
      controller.abort();
      cancelAnimationFrame(frame);
      frame = 0;
      if (received || reasoning) flush();
      if (err.name === "AbortError") {
        /* Stopping is a choice, not a failure: keep what was written. */
        updateMessage({ stopped: true });
        announce("Stopped.");
      } else {
        const problem = classifyError({
          name: err.name,
          message: err.message,
          status: err.status,
          partial: !!received.trim(),
        });
        if (problem.kind === "interrupted")
          updateMessage({ interrupted: true, note: problem.text });
        else updateMessage({ failed: true, note: problem.text, errorKind: problem.kind });
        setError(problem.text);
        announce(problem.text);
      }
    } finally {
      if (frame) {
        cancelAnimationFrame(frame);
        flush();
      }
      updateMessage((message) => {
        const patch = { live: "" };
        if (message.activity)
          patch.activity = message.activity.map((item) => ({
            ...item,
            done: true,
            endedAt: item.endedAt || Date.now(),
          }));
        if (message.approval?.state === "pending" || message.approval?.state === "sending")
          patch.approval = { ...message.approval, state: "expired" };
        if (!received) patch.thoughtMs = Date.now() - startedAt;
        if (message.versions) {
          const done = { ...message, ...patch };
          patch.versions = [
            ...message.versions.slice(0, message.version),
            snapshot(done),
          ];
        }
        return patch;
      });
      setBusy(false);
      setLivePhase("idle");
      abort.current = null;
      if (succeeded) {
        announce("Vaelo replied.");
        if (document.hidden) {
          document.title = "Reply ready · Vaelo";
          if (prefsRef.current.notify)
            tellReady(
              active.messages.length ? active.title : String(messages[0].text || messages[0].content).slice(0, 48),
              received,
            );
        }
        setSettling(true);
        settleTimer.current = setTimeout(() => setSettling(false), 1500);
      }
      textarea.current?.focus({ preventScroll: true });
    }
  }

  /* Messages get one stable handler so a streaming reply never re-renders
     the rest of the transcript. It always reaches the latest state. */
  const handlers = useRef(null);
  handlers.current = {
    retry: () => send({ retry: true }),
    continue: () => send({ text: "Continue" }),
    edit: (id, text) => send({ edit: { id, text } }),
    version: (id, index) => selectVersion(id, index),
    branch: (id) => branchFrom(id),
    carry: () => carryOver(),
    signin: () => location.reload(),
    alternative: () =>
      send({
        text: "Please find a way to do that without anything that needs approval, or tell me exactly what you would need approved and why.",
      }),
    open: (id, item) => setWorkspace({ ...item, messageId: id }),
    approve: (id, choice) => answerApproval(id, choice),
  };
  const onAction = useCallback(
    (type, id, payload) => handlers.current[type]?.(id, payload),
    [],
  );
  const openFromWorkspace = useCallback(
    (item) => setWorkspace((current) => ({ ...item, messageId: current?.messageId })),
    [],
  );

  async function logout() {
    try {
      await request("/api/logout", {});
      try {
        localStorage.removeItem(LAST_USER_KEY);
      } catch {
        /* nothing to forget */
      }
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
        googleState={preferRedirect ? "redirect" : gsi}
        onGoogleRedirect={() => googleRedirect(session)}
        onRetryGoogle={() => {
          googleScript = null;
          setGsiAttempt((n) => n + 1);
        }}
      />
    );

  return (
    <IconContext.Provider value={{ weight: "light", size: 20 }}>
      <PresentationContext.Provider value={prefs.presentation}>
      <div
        className="shell"
        data-collapsed={collapsed}
        data-workspace={workspace ? "open" : undefined}
        onTouchStart={(event) => {
          /* Swipe in from the left edge to open the conversations; swipe
             the open drawer back to close it, as in a native app. */
          const touch = event.touches[0];
          if (!matchMedia(PHONE).matches || event.touches.length > 1) return;
          if (menu || touch.clientX < 28)
            swipe.current = { x: touch.clientX, y: touch.clientY, open: menu };
        }}
        onTouchMove={(event) => {
          const start = swipe.current;
          if (!start) return;
          const touch = event.touches[0];
          const dx = touch.clientX - start.x;
          if (Math.abs(touch.clientY - start.y) > 40) swipe.current = null;
          else if (!start.open && dx > 56) {
            setMenu(true);
            swipe.current = null;
          } else if (start.open && dx < -56) {
            setMenu(false);
            swipe.current = null;
          }
        }}
        onTouchEnd={() => {
          swipe.current = null;
        }}
      >
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
          onPin={togglePin}
          onSettings={() => {
            setMenu(false);
            setSettingsOpen(true);
          }}
          onSignOut={logout}
          onOpenWork={openWork}
        />

        <main
          className="stage"
          onDragEnter={(event) => {
            if (event.dataTransfer?.types?.includes("Files")) {
              event.preventDefault();
              setDragging(true);
            }
          }}
          onDragOver={(event) => {
            if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
          }}
          onDrop={(event) => {
            if (!event.dataTransfer?.files?.length) return;
            event.preventDefault();
            setDragging(false);
            addFiles([...event.dataTransfer.files]);
          }}
        >
          <Header
            title={active?.title || "New conversation"}
            canRename={messages.length > 0 && !busy}
            onRename={renameChat}
            onOpenRail={() => setMenu(true)}
            onToggleRail={toggleRail}
          />

          <div
            className="conversation"
            ref={conversation}
            onScroll={onScroll}
            onWheel={onWheel}
            onMouseUp={checkSelection}
            onKeyUp={(event) => event.shiftKey && checkSelection()}
          >
            {!messages.length ? (
              <Welcome
                name={session.user.name}
                phase={phase}
                onPick={(text, picked) => {
                  setDraft(text);
                  if (picked) setOptions((current) => ({ ...current, ...picked }));
                  textarea.current?.focus();
                }}
              />
            ) : (
              <div className="thread">
                {messages.map((message, index) => {
                  const last = index === messages.length - 1;
                  const mine = message.role === "user";
                  const live = busy && last && !mine;
                  return (
                    <Message
                      key={message.id}
                      message={message}
                      fresh={fresh.current.has(message.id)}
                      busy={busy}
                      phase={live ? livePhase : undefined}
                      live={live}
                      streaming={live && !!message.content}
                      isLast={last && !mine}
                      edited={(active.works?.[message.id]?.versions?.length || 0) > 1}
                      onAction={onAction}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {quote && (
            <button
              className="quote-ask"
              data-below={quote.below || undefined}
              style={{ left: quote.x, top: quote.y }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={askAbout}
            >
              <Quotes size={15} weight="fill" /> Ask Vaelo about this
            </button>
          )}

          <div className="dock">
            {/* Scrolled away while Vaelo works, the pill carries its face and
                current action, so status shows where you are looking. */}
            {away && messages.length > 0 && (
              <button className="jump" data-live={busy || undefined} onClick={jumpToLatest}>
                {busy ? (
                  <>
                    <Mark size={18} state={livePhase} />
                    <span className="jump-text">{liveLine(messages.at(-1), livePhase)}</span>
                  </>
                ) : (
                  <ArrowDown size={15} />
                )}
                {busy ? <ArrowDown size={14} className="jump-arrow" /> : "Latest"}
              </button>
            )}
            {cloud === "Unavailable" && online && !session.offline && (
              <Notice>
                Vaelo is out of reach right now. Messages may not go through
                until it’s back.
              </Notice>
            )}
            {(!online || session.offline) && (
              <Notice tone="brass">
                You’re offline. Your conversations are here to read; sending
                comes back with the connection.
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
              offline={!online || !!session.offline}
              attachments={attachments}
              options={options}
              length={length}
              onChange={setDraft}
              onSend={() => send()}
              onStop={() => abort.current?.abort()}
              onFiles={addFiles}
              onRemoveFile={(id) =>
                setAttachments((current) => current.filter((file) => file.id !== id))
              }
              onOptions={(patch) => setOptions((current) => ({ ...current, ...patch }))}
              onDictating={setDictating}
            />
          </div>

          {dragging && (
            <div className="drop-veil" aria-hidden="true">
              <FileArrowUp size={36} />
              <p>Drop to attach</p>
              <span>Images, notes, code, CSV, JSON, Markdown</span>
            </div>
          )}
        </main>

        {workspace && (
          <button
            className="scrim ws-scrim"
            aria-label="Close workspace"
            tabIndex={-1}
            onClick={() => setWorkspace(null)}
          />
        )}
        {workspace && (
          <Workspace
            item={workspace}
            messages={messages}
            works={active?.works}
            canRevise={!busy && online && !session.offline}
            onClose={() => setWorkspace(null)}
            onOpen={openFromWorkspace}
            onWorkChange={updateWork}
            onReveal={revealMessage}
            onRevise={(request) => requestRevision({ csrf: session.csrf, ...request })}
          />
        )}

        {/* State changes are announced; individual words are not. */}
        <p className="sr-only" role="status" aria-live="polite">
          {announcement.text}
          {announcement.id % 2 ? "​" : ""}
        </p>
        <Toast toast={toast} onDismiss={() => setToast(null)} />
        <Settings
          open={settingsOpen}
          prefs={prefs}
          onChange={(patch) => setPrefs((current) => ({ ...current, ...patch }))}
          onClose={() => setSettingsOpen(false)}
        />
      </div>
      </PresentationContext.Provider>
    </IconContext.Provider>
  );
}
