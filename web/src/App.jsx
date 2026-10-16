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
import { normalizeReplySpacing, normalizeSavedReplySpacing } from "./lib/reply-spacing.js";
import { liveReply, readSyncCache } from "./lib/chat-sync.js";
import { useChatSync } from "./lib/use-chat-sync.js";
import { Rail } from "./components/Rail.jsx";
import { Header } from "./components/Header.jsx";
import { Welcome } from "./components/Welcome.jsx";
import { Message, liveLine } from "./components/Message.jsx";
import { Composer } from "./components/Composer.jsx";
import { Workspace } from "./components/Workspace.jsx";
import { Settings } from "./components/Settings.jsx";
import { Workroom } from "./components/Workroom.jsx";
import { refreshWorkReferences, workContextFor, proposalDraft, chatToWorkspace } from "./lib/workroom.js";
import { getWorkspace } from "../shared/workspaces.js";
import { getCheck } from "../shared/checks.js";
import { Mark } from "./components/Mark.jsx";
import { PresentationContext } from "./components/blocks/Blocks.jsx";
import { applyPrefs, readPrefs, savePrefs } from "./lib/preferences.js";
import { requestRevision } from "./lib/revise.js";
import { Toast, Notice } from "./components/Toast.jsx";
import { Tips } from "./components/Tips.jsx";
import { Opening, SignIn } from "./components/SignIn.jsx";
import { toolInfo } from "./lib/tools.js";
import { mergePlan, readPlan } from "./lib/plan.js";
import { classifyError } from "./lib/errors.js";
import { JOIN_WINDOW, continueRequest, joinOnto, retryRequest } from "./lib/continuation.js";
import { PHONE } from "./lib/use-phone.js";
import { DESKTOP, desktopSignIn, desktopSignOut, desktopGuest, desktopLeaveGuest, desktopNotification, cancelDesktopSignIn } from "./lib/desktop.js";
import { readDesktopHandoff } from "./lib/desktop-handoff.js";
import { DesktopHandoff } from "./components/DesktopHandoff.jsx";
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
/* Who was signed in last, so the installed app can open your conversations
   to read while offline. Only the account id and display name are kept. */
const LAST_USER_KEY = "vaelo-last-user";
const GUEST_CHATS_KEY = "vaelo-guest-chats";

/* The conversation open in this tab or app window. Session storage outlives
   a reload but not a fresh launch, which is exactly the line we want. */
const OPEN_CHAT_KEY = "vaelo-open-chat";

/* A sleeping free instance can take a few minutes to boot. Render puts it to
   sleep after 15 idle minutes, so an older "ready" is checked again. */
const WAKE_PATIENCE_MS = 5 * 60 * 1000;
const STALE_READY_MS = 12 * 60 * 1000;

/* The proxy sends a keepalive every 15 seconds while a reply runs, so a
   minute of total silence means the connection itself has died (a phone
   switching networks, say), not that Vaelo is thinking. */
const SILENT_MS = 60 * 1000;

/* Replies still running when the app closed, by id, so opening it again can
   pick them up. The relay keeps a finished reply for an hour. */
const LIVE_KEY = "vaelo-live-replies";
const LIVE_REPLY_MS = 55 * 60 * 1000;
/* How long a device that followed a reply waits for the sender's own copy
   before saving the finished reply itself. */
const MIRROR_GRACE_MS = 15000;

function readLiveReplies() {
  try {
    const value = JSON.parse(localStorage.getItem(LIVE_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeLiveReplies(value) {
  try {
    localStorage.setItem(LIVE_KEY, JSON.stringify(value));
  } catch {
    /* without storage a reply is only followed while the page stays open */
  }
}

function rememberLiveReply(id, chatId, run = id) {
  const previous = readLiveReplies()[id];
  const at = previous?.run === run ? previous.at : Date.now();
  writeLiveReplies({ ...readLiveReplies(), [id]: { chatId, run, at } });
}

function forgetLiveReply(id) {
  const live = readLiveReplies();
  if (!(id in live)) return;
  delete live[id];
  writeLiveReplies(live);
}

function stopped() {
  return Object.assign(new Error("Stopped"), { name: "AbortError" });
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(stopped());
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", quit);
      resolve();
    }
    function quit() {
      clearTimeout(timer);
      reject(stopped());
    }
    signal.addEventListener("abort", quit, { once: true });
  });
}

/* Nothing is gained asking while a phone has the page asleep or has no
   network; the reply carries on at Vaelo meanwhile. */
function untilVisible(signal) {
  const ready = () => document.visibilityState === "visible" && navigator.onLine !== false;
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(stopped());
    if (ready()) return resolve();
    function check() {
      if (!ready()) return;
      done();
      resolve();
    }
    function quit() {
      done();
      reject(stopped());
    }
    function done() {
      removeEventListener("visibilitychange", check);
      removeEventListener("online", check);
      signal.removeEventListener("abort", quit);
    }
    addEventListener("visibilitychange", check);
    addEventListener("online", check);
    signal.addEventListener("abort", quit, { once: true });
  });
}

/* Hermes writes "(empty)" when its model gave nothing; that is not an answer. */
function hasAnswer(text) {
  const trimmed = text.trim();
  return Boolean(trimmed) && trimmed !== "(empty)";
}

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
/* Keep the full history: a new conversation must never delete an older one. */
function cap(list) {
  const pinned = list.filter((chat) => chat.pinned);
  const rest = list.filter((chat) => !chat.pinned);
  return [...pinned, ...rest];
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
  plan,
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
  plan,
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
  if (DESKTOP) {
    await desktopNotification(`Vaelo replied · ${title}`, content.replace(/\s+/g, " ").slice(0, 140)).catch(() => {});
    return;
  }
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
  const [desktopHandoff, setDesktopHandoff] = useState(() => DESKTOP ? null : readDesktopHandoff());
  const [desktopSigningIn, setDesktopSigningIn] = useState(false);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [options, setOptions] = useState({ research: false, style: "balanced", role: "none" });
  const [busy, setBusy] = useState(false);
  const [livePhase, setLivePhase] = useState("idle");
  const [settling, setSettling] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [cloud, setCloud] = useState("Connecting");
  const warming = useRef(null);
  const lastReady = useRef(0);
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
  const [workroomOpen, setWorkroomOpen] = useState(false);
  /* A draft for the Workroom to open with: a proposal from a reply, a
     document to verify, or a conversation saved as a workspace. */
  const [workDraft, setWorkDraft] = useState(null);
  /* A starter chosen in the Workroom, sent once its conversation is ready. */
  const [queuedPrompt, setQueuedPrompt] = useState(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const swipe = useRef(null);
  const googleButton = useRef(null);
  const [gsi, setGsi] = useState("loading");
  const [gsiAttempt, setGsiAttempt] = useState(0);
  const abort = useRef(null);
  /* The reply being followed, whether Stop was chosen, and replies already
     being picked back up after the app opened. */
  const replyId = useRef(null);
  const stopping = useRef(false);
  const resuming = useRef(new Set());
  /* Replies this device has followed from another device, by message and run. */
  const mirrored = useRef(new Set());
  const mirrorChat = useRef(null);
  const replyRun = useRef(null);
  const textarea = useRef(null);
  const conversation = useRef(null);
  const pinned = useRef(true);
  const fresh = useRef(new Set());
  /* Full-size images stay in memory only; conversations keep thumbnails. */
  const imageData = useRef(new Map());
  const settleTimer = useRef(0);
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
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
    /* The toast keeps its own time, pausing while it is being read */
    setToast({ id: crypto.randomUUID(), ...next });
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
        const guest = Boolean(result.user.guest);
        try {
          if (!guest)
            localStorage.setItem(
              LAST_USER_KEY,
              JSON.stringify({ sub: result.user.sub, name: result.user.name }),
            );
        } catch {
          /* reading offline is a nicety */
        }
        let saved = [];
        try {
          /* A guest's chats live only in this tab (sessionStorage). */
          saved = guest
            ? JSON.parse(sessionStorage.getItem(GUEST_CHATS_KEY) || "[]")
            : readSyncCache(result.user.sub)?.chats || JSON.parse(
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
        const opening = chooseOpening(saved.map(normalizeSavedReplySpacing));
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

  const guest = Boolean(session?.user?.guest);

  /* Guests are never synced or stored on a device; their chats follow the tab. */
  useEffect(() => {
    if (!guest) return;
    try {
      sessionStorage.setItem(GUEST_CHATS_KEY, JSON.stringify(chats));
    } catch {
      /* a full tab store just means a reload starts fresh */
    }
  }, [guest, chats]);

  const { issue: syncIssue, push: pushChat } = useChatSync({
    session: guest ? { ...session, user: null } : session, chats, setChats, busyId: busy ? activeId : null,
    onConflict: () => showToast({ text: "Both devices edited this conversation. Your changes were kept in a device copy." }),
  });

  useEffect(() => {
    if (chats.length && activeId && !chats.some((chat) => chat.id === activeId))
      setActiveId(chats[0].id);
  }, [chats, activeId]);

  /* The free cloud sleeps when idle. Asking for its status wakes it, so the
     page asks as soon as you arrive or come back, and keeps asking quietly
     while it boots. Only minutes of silence count as out of reach. */
  function warmCloud() {
    if (warming.current) return warming.current;
    const started = Date.now();
    warming.current = (async () => {
      while (true) {
        try {
          const result = await request("/api/status");
          if (result.ready) {
            lastReady.current = Date.now();
            setCloud("Connected");
            return true;
          }
          setCloud((current) => (current === "Unavailable" ? current : "Starting"));
        } catch {
          /* a function cold start or a blip; the next pass decides */
        }
        if (Date.now() - started > WAKE_PATIENCE_MS) {
          setCloud("Unavailable");
          return false;
        }
        await new Promise((resolve) => setTimeout(resolve, 4000));
      }
    })().finally(() => {
      warming.current = null;
    });
    return warming.current;
  }

  useEffect(() => {
    if (!session?.user || session.offline) return;
    warmCloud();
    const back = () => {
      if (document.visibilityState === "visible" && Date.now() - lastReady.current > STALE_READY_MS)
        warmCloud();
    };
    addEventListener("visibilitychange", back);
    addEventListener("focus", back);
    return () => {
      removeEventListener("visibilitychange", back);
      removeEventListener("focus", back);
    };
  }, [session?.user?.sub, session?.offline]);

  /* Google draws its own button in an iframe. Until it appears there is a
     visible placeholder, and if it never does (a content blocker, a hung
     script) the page says so and offers a retry instead of showing nothing. */
  useEffect(() => {
    if (DESKTOP || session?.user || !session?.configured || !googleButton.current || preferRedirect) return;
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
        stopReply();
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

  /* A workspace opens in a conversation of its own (or the empty one you're
     in), so its brief and documents travel with every message there. */
  function startWork(record, prompt) {
    if (!record?.revision) return;
    const workContext = workContextFor(record);
    let chatId = activeId;
    if (active && !active.messages.length) {
      setChats(current => current.map(chat => chat.id === activeId ? { ...chat, updated: Date.now(), workContext } : chat));
    } else {
      const chat = { ...freshChat(), workContext };
      chatId = chat.id;
      setChats(current => cap([chat, ...current]));
      selectChat(chat.id);
    }
    setWorkroomOpen(false);
    setWorkDraft(null);
    if (prompt) setQueuedPrompt({ chatId, text: prompt });
    else requestAnimationFrame(() => textarea.current?.focus());
  }

  function updateSelectedWork(record) {
    setChats(current => refreshWorkReferences(current,record));
  }

  function openWorkProposal(item) {
    if (item?.kind !== "work-proposal") return false;
    const draft = proposalDraft(item.proposal, { getWorkspace, getCheck });
    if (!draft) return false;
    setWorkDraft({ draft, panel: draft.check ? "check" : "setup", message: "Vaelo filled this in for you. Check it, then save it." });
    setWorkroomOpen(true);
    return true;
  }

  function saveChatAsWorkspace() {
    if (!active?.messages.length) return;
    const { draft, skipped } = chatToWorkspace(active);
    setWorkDraft({ draft, message: `What you asked for became the instructions${draft.documents.length ? `, and your ${draft.documents.length === 1 ? "file was" : "files were"} kept` : ""}. Change anything you like, then save.${skipped.length ? ` Left out: ${skipped.join(", ")} (pictures or very long files).` : ""}` });
    setWorkroomOpen(true);
  }

  useEffect(() => {
    if (!queuedPrompt || busy || !online || session?.offline) return;
    if (active?.id !== queuedPrompt.chatId || !active.workContext) return;
    setQueuedPrompt(null);
    send({ text: queuedPrompt.text });
  });

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
    const mode = { research: options.research, style: options.style, role: options.role };
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
          ...(original.workContext && { workContext: original.workContext }),
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
          ...(active.workContext && { workContext: active.workContext }),
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
    const { messages: input, dropped } = wireHistory(messages);
    const lastUser = messages[messages.length - 1];
    const context = {
      turns: input.length - 1,
      dropped,
      files: (lastUser.attachments || []).map((file) => file.name),
      research: mode.research,
      style: mode.style,
      role: mode.role,
      ...(lastUser.workContext && { work: lastUser.workContext.title }),
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
                ...messages.map((message) =>
                  message.running ? { ...message, running: undefined } : message,
                ),
                {
                  id,
                  role: "assistant",
                  content: "",
                  startedAt: Date.now(),
                  /* Saved with the conversation so every other device can
                     follow this reply live from the relay, at no model cost. */
                  run: id,
                  running: true,
                  context,
                  ...(versions && { versions, version: versions.length }),
                },
              ],
            }
          : chat,
      ),
    );
    pushChat(chatId);
    clearTimeout(settleTimer.current);
    setSettling(false);
    if (!retry && !edit && text === undefined) {
      setDraft("");
      setAttachments([]);
    }
    announce(mode.research ? "Vaelo is researching." : "Vaelo is thinking.");
    await followReply({
      chatId,
      id,
      title: active.messages.length
        ? active.title
        : String(messages[0].text || messages[0].content).slice(0, 48),
      start: { conversationId: chatId, runId: id, messages: input,
        ...(lastUser.workContext && {work:{id:lastUser.workContext.id,revision:lastUser.workContext.revision}}) },
    });
  }

  /* The conversation as it is sent: what can be sent, wired, and fitted. */
  function wireHistory(messages) {
    const sendable = messages.filter(
      (message) => (message.content || message.attachments?.length) && !message.failed,
    );
    const wired = sendable
      .map((message, i) =>
        wireMessage(message, { latest: i === sendable.length - 1, images: imageData.current }),
      )
      .filter((message) =>
        typeof message.content === "string" ? message.content.trim() : message.content.length,
      );
    return fitHistory(wired);
  }

  /* The request behind a reply, rebuilt from the saved conversation (after
     the app was reopened, the original is no longer in memory). */
  function requestFor(chatId, id) {
    const chat = chatsRef.current.find((item) => item.id === chatId);
    const at = chat?.messages.findIndex((message) => message.id === id) ?? -1;
    if (at < 1) return null;
    const { messages } = wireHistory(chat.messages.slice(0, at));
    const selectedWork = chat.messages.slice(0, at).findLast(message => message.role === "user")?.workContext;
    return messages.length && messages.at(-1).role === "user"
      ? { conversationId: chatId, runId: id, messages,
          ...(selectedWork && {work:{id:selectedWork.id,revision:selectedWork.revision}}) }
      : null;
  }

  /* One reply, followed until it ends. The reply itself runs on the relay
     in front of Hermes and carries on without this page, so a dropped
     connection, a locked phone or a closed app only means picking it back
     up after the last event the page saw. `start` begins a new reply;
     `resumeFrom` picks one up that was running when the app last closed.
     `mirror` follows a reply another device started: the same events replayed
     from the relay, so it looks the same here and costs no model tokens. A
     mirror never starts or restarts a run; the device that sent it does. */
  async function followReply({ chatId, id, title, start = null, resumeFrom = null, run = id, mirror = false }) {
    setBusy(true);
    setError("");
    setLivePhase("thinking");
    setQuote(null);
    const controller = new AbortController();
    abort.current = controller;
    replyId.current = id;
    stopping.current = false;
    replyRun.current = run;
    if (mirror) mirrorChat.current = chatId;
    else rememberLiveReply(id, chatId, run);
    const mirrorKey = `${id}:${run}`;
    let quiet = false;
    let completed = false;
    /* A continuation's opening is held back until it can be joined onto
       the words already shown without repeating any of them. */
    let joining = false;
    let joinBuffer = "";
    let received = resumeFrom?.content || "";
    let reasoning = resumeFrom?.reasoning || "";
    let succeeded = false;
    let detached = false;
    let lost = false;
    let frame = 0;
    let runId = "";
    let pendingApproval = false;
    let seq = -1;
    let fromScratch = Boolean(resumeFrom);
    const startedAt = resumeFrom?.startedAt || Date.now();
    const updateMessage = (patch) => updateChatMessage(chatId, id, patch);
    if (resumeFrom)
      updateMessage({
        interrupted: false,
        failed: false,
        stopped: false,
        note: undefined,
        errorKind: undefined,
        live: "",
      });
    /* Words are committed once per frame, not once per network fragment. */
    const flush = () => {
      frame = 0;
      received = normalizeReplySpacing(received);
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
          code: data.code,
          fromServer: true,
        });
      if (name === "jarvis.complete") {
        completed = true;
        if (joining && joinBuffer) {
          received += joinOnto(received, joinBuffer);
          schedule();
        }
        joining = false;
        joinBuffer = "";
      }
      /* The answer was cut off and Vaelo is carrying it on: what follows
         joins the words already written. */
      if (name === "jarvis.continue") {
        joining = true;
        joinBuffer = "";
        return;
      }
      /* The run ended without an answer and the proxy is asking again;
         anything that stood in for an answer so far is set aside. */
      if (name === "jarvis.retry") {
        received = "";
        updateMessage({ content: "", truncated: false, live: String(data.message || "").slice(0, 160) });
        setLivePhase("thinking");
        announce("Vaelo is writing up what it found.");
        return;
      }
      if (name === "jarvis.status") {
        const waking = /wake|idle/i.test(data.message || "");
        setLivePhase(waking ? "waking" : "thinking");
        if (/working/i.test(data.message || "")) {
          lastReady.current = Date.now();
          setCloud("Connected");
        }
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
      /* Hermes's plan for this reply, as the whole list after each change. */
      if (name === "hermes.todo" || (name === "hermes.tool.progress" && data.todos)) {
        const plan = readPlan(data);
        if (plan?.items.length) updateMessage((message) => ({ plan: mergePlan(message.plan, plan) }));
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
        let piece = choice.delta.content;
        if (joining) {
          joinBuffer += piece;
          if (joinBuffer.length < JOIN_WINDOW && !choice.finish_reason) return;
          piece = joinOnto(received, joinBuffer);
          joining = false;
          joinBuffer = "";
        }
        if (!received) updateMessage({ thoughtMs: Date.now() - startedAt, live: "" });
        received += piece;
        schedule();
        setLivePhase("speaking");
      }
      // A truncated reply also carries an error object; it is not a failure.
      if (choice?.finish_reason === "length") {
        updateMessage({ truncated: true });
        return;
      }
      if (choice?.finish_reason === "error" || data.error)
        throw Object.assign(
          new Error(data.error?.message || data.hermes?.error || "Vaelo stopped before finishing."),
          { fromServer: true },
        );
    }
    try {
      /* Waiting for a sleeping cloud happens here, in the page, so the
         reply gets the request's whole time limit once it starts. */
      if (start && Date.now() - lastReady.current > STALE_READY_MS) {
        setLivePhase("waking");
        updateMessage({ live: "Waking Vaelo up. This can take a minute" });
        await new Promise((resolve, reject) => {
          const stop = () => reject(Object.assign(new Error("Stopped"), { name: "AbortError" }));
          controller.signal.addEventListener("abort", stop, { once: true });
          warmCloud().then(resolve, resolve).finally(() =>
            controller.signal.removeEventListener("abort", stop),
          );
        });
        updateMessage({ live: "" });
        setLivePhase("thinking");
      }
      /* Ask, read, and when the connection drops, ask again from the last
         event that arrived. Only the reply's own end, or Stop, ends this. */
      let started = !start;
      let body = start;
      let busyTries = 0;
      let recoveries = 0;
      let drops = 0;
      let stalledSince = 0;
      while (true) {
        const attempt = new AbortController();
        const endAttempt = () => attempt.abort();
        controller.signal.addEventListener("abort", endAttempt, { once: true });
        let heardAt = Date.now();
        let progressed = false;
        let resumeAsked = false;
        /* A phone that slept usually took the connection with it. Coming
           back, a stream that has gone quiet is dropped at once and picked
           up again rather than waited out. Time in the background doesn't
           count towards silence. */
        const back = () => {
          if (document.visibilityState !== "visible") return;
          if (Date.now() - heardAt > 4000) attempt.abort();
        };
        addEventListener("visibilitychange", back);
        addEventListener("online", back);
        const watchdog = setInterval(() => {
          if (document.visibilityState === "visible" && Date.now() - heardAt > SILENT_MS)
            attempt.abort();
        }, 5000);
        try {
          const response = started
            ? await fetch(`/api/chat?run=${encodeURIComponent(run)}&after=${seq}`, {
                signal: attempt.signal,
                cache: "no-store",
              })
            : await fetch("/api/chat", {
                method: "POST",
                signal: attempt.signal,
                headers: {
                  "Content-Type": "application/json",
                  "X-CSRF-Token": session.csrf,
                },
                body: JSON.stringify(body),
              });
          if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw Object.assign(new Error(result.error || "Vaelo could not respond."), {
              status: response.status,
              fromServer: true,
            });
          }
          if (!response.body)
            throw Object.assign(new Error("Streaming is not available in this browser."), {
              fromServer: true,
            });
          started = true;
          await readEvents(
            response.body,
            (name, data, eventId) => {
              if (eventId !== undefined) {
                const n = Number(eventId);
                if (!Number.isInteger(n) || n <= seq) return; // already shown
                seq = n;
                progressed = true;
                /* Picking up after the app closed replays the reply from its
                   start, so what was saved is replaced, not added to. */
                if (fromScratch) {
                  fromScratch = false;
                  received = "";
                  reasoning = "";
                  updateMessage({
                    content: "",
                    reasoning: undefined,
                    activity: undefined,
                    notes: undefined,
                    plan: undefined,
                    approval: undefined,
                    truncated: false,
                  });
                }
              }
              if (name === "jarvis.resume") {
                resumeAsked = true;
                return;
              }
              if (data !== null) onEvent(name, data);
            },
            () => {
              heardAt = Date.now();
            },
          );
        } catch (err) {
          if (controller.signal.aborted) throw err;
          if (err.fromServer) {
            /* Vaelo restarted (a deploy, a crash) and this reply's run went
               with it. Nothing is lost on the page: the work carries on in a
               new run, which continues the answer from where it stopped, or
               picks the research back up if no answer was written yet. */
            if (err.code === "run_missing" && recoveries < 3 && !mirror) {
              const original = body || requestFor(chatId, id);
              if (original) {
                recoveries += 1;
                const untouched = seq < 0 && !received && run === id;
                if (!untouched) {
                  run = crypto.randomUUID();
                  if (hasAnswer(received)) {
                    body = continueRequest(original, received, run);
                    joining = true;
                    joinBuffer = "";
                  } else {
                    const done = (chatsRef.current
                      .find((chat) => chat.id === chatId)
                      ?.messages.find((message) => message.id === id)?.activity || [])
                      .map((step) => step.label || step.tool)
                      .filter(Boolean);
                    body = retryRequest(original, done, run);
                  }
                  rememberLiveReply(id, chatId, run);
                  replyRun.current = run;
                  updateMessage({ run });
                  pushChat(chatId);
                  seq = -1;
                  fromScratch = false;
                } else body = original;
                started = false;
                continue;
              }
            }
            /* A busy cloud (it runs one reply at a time) is waited out
               quietly, for a few minutes, before it is reported. */
            const busyNow =
              body &&
              !received &&
              !pendingApproval &&
              busyTries < 12 &&
              classifyError({ name: err.name, message: err.message, status: err.status }).kind === "busy";
            if (!busyNow) throw err;
            busyTries += 1;
            started = false;
            updateMessage({ live: "Vaelo is finishing something else first" });
            await pause(busyTries > 2 ? 15000 : 5000, controller.signal);
            continue;
          }
          /* Anything else is the connection, not the reply. */
        } finally {
          clearInterval(watchdog);
          removeEventListener("visibilitychange", back);
          removeEventListener("online", back);
          controller.signal.removeEventListener("abort", endAttempt);
        }
        if (completed) break;
        /* Reconnecting is quiet: the reply on screen simply carries on.
           Only a quarter of an hour without any progress gives up, and even
           then the reply is picked up the next time the app opens. */
        if (progressed) {
          drops = 0;
          stalledSince = 0;
        } else {
          drops += 1;
          stalledSince ||= Date.now();
        }
        if (stalledSince && Date.now() - stalledSince > 15 * 60 * 1000) {
          lost = true;
          throw Object.assign(new Error("The connection to Vaelo keeps dropping."), { dropped: true });
        }
        await untilVisible(controller.signal);
        if (drops && !(resumeAsked && drops === 1))
          await pause(Math.min(500 * 2 ** (drops - 1), 10000), controller.signal);
      }
      if (!hasAnswer(received))
        throw new Error("The response ended before Vaelo delivered an answer.");
      succeeded = true;
    } catch (err) {
      controller.abort();
      cancelAnimationFrame(frame);
      frame = 0;
      if (received || reasoning) flush();
      if (mirror && (err.code === "run_missing" || err.dropped)) {
        /* The device that sent this reply carries it on and reports it. */
        quiet = true;
      } else if (err.name === "AbortError" && !stopping.current) {
        /* The page is going away (closing, signing out): the reply carries
           on at Vaelo and is picked back up the next time the app opens. */
        detached = true;
      } else if (err.dropped) {
        const text = hasAnswer(received)
          ? "The connection to Vaelo keeps dropping. What arrived is kept; the rest appears when you reopen Vaelo."
          : "The connection to Vaelo keeps dropping. The reply carries on there and appears when you reopen Vaelo.";
        updateMessage({ interrupted: true, note: text });
        setError(text);
        announce(text);
      } else if (err.name === "AbortError") {
        /* Stopping is a choice, not a failure: keep what was written. */
        updateMessage({ stopped: true });
        announce("Stopped.");
      } else {
        const problem = classifyError({
          name: err.name,
          message: err.message,
          status: err.status,
          partial: hasAnswer(received),
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
      /* A reply that carries on without this page stays marked as running.
         A mirror leaves the final word to the device that sent it. */
      const carriesOn = detached || lost || quiet || (mirror && !stopping.current);
      updateMessage((message) => {
        const patch = { live: "" };
        if (!carriesOn) patch.running = undefined;
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
      if (!mirror && !detached && !lost) forgetLiveReply(id);
      if (mirror) {
        mirrorChat.current = null;
        // Leaving the conversation: coming back to it follows the reply again.
        if (detached) mirrored.current.delete(mirrorKey);
        else if (!quiet && carriesOn) adoptLater(chatId, id, run);
      }
      if (!carriesOn) pushChat(chatId);
      if (abort.current === controller) {
        abort.current = null;
        replyId.current = null;
      }
      if (succeeded) {
        announce("Vaelo replied.");
        if (document.hidden) {
          document.title = "Reply ready · Vaelo";
          if (prefsRef.current.notify) tellReady(title, received);
        }
        setSettling(true);
        settleTimer.current = setTimeout(() => setSettling(false), 1500);
      }
      // A reply picked up on opening the app must not raise the keyboard.
      if (start) textarea.current?.focus({ preventScroll: true });
    }
  }

  /* A followed reply that ended here while the device that sent it is
     asleep: after a short wait for that device's own copy, this one is saved
     so every device sees the finished reply. */
  function adoptLater(chatId, id, run) {
    setTimeout(() => {
      const message = chatsRef.current
        .find((chat) => chat.id === chatId)
        ?.messages.find((item) => item.id === id);
      if (!message?.running || message.run !== run) return;
      updateChatMessage(chatId, id, { running: undefined });
      pushChat(chatId);
    }, MIRROR_GRACE_MS);
  }

  /* Stop is a decision about the reply, so it is told to Vaelo, which ends
     the run; merely leaving the page never does. */
  function stopReply() {
    if (!abort.current) return;
    stopping.current = true;
    const id = replyRun.current || replyId.current;
    if (id && session?.csrf)
      fetch("/api/stop", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf },
        body: JSON.stringify({ runId: id }),
      }).catch(() => {});
    abort.current.abort();
  }

  /* A reply that was still running when the app closed, reloaded or lost
     its connection for good carries on at Vaelo; opening the app picks the
     newest one back up and shows it from the start. */
  useEffect(() => {
    if (!session?.user || session.offline || busy || !chats.length) return;
    const live = Object.entries(readLiveReplies()).sort((a, b) => b[1].at - a[1].at);
    for (const [id, entry] of live) {
      const chat = chats.find((item) => item.id === entry.chatId);
      const message = chat?.messages.find((item) => item.id === id);
      if (!message || message.role !== "assistant" || Date.now() - entry.at > LIVE_REPLY_MS) {
        forgetLiveReply(id);
        continue;
      }
      if (resuming.current.has(id)) return;
      resuming.current.add(id);
      setActiveId(chat.id);
      followReply({
        chatId: chat.id,
        id,
        run: typeof entry.run === "string" ? entry.run : id,
        title: chat.title,
        resumeFrom: {
          content: message.content || "",
          reasoning: message.reasoning || "",
          startedAt: message.startedAt,
        },
      }).finally(() => resuming.current.delete(id));
      return;
    }
  }, [session?.user?.sub, session?.offline, busy, chats.length > 0]);

  /* A reply another device is writing shows here as it happens, the way
     ChatGPT and Claude do it: the conversation arrives through sync marked
     as running, and opening it replays that run's events from the relay and
     follows it live. Starting on a blank conversation, a reply just begun
     elsewhere is opened at once. Nothing is generated again. */
  const autoOpened = useRef(new Set());
  useEffect(() => {
    if (!session?.user || session.offline) return;
    if (busy) {
      // Following a reply in a conversation that was left: stop following.
      if (mirrorChat.current && mirrorChat.current !== activeId) abort.current?.abort();
      return;
    }
    const own = readLiveReplies();
    const active = chats.find((chat) => chat.id === activeId);
    if (!active?.messages.length) {
      const started = chats.find((chat) => {
        const reply = liveReply(chat);
        return reply && !own[reply.id] && !autoOpened.current.has(reply.id) &&
          Date.now() - reply.startedAt < 2 * 60 * 1000;
      });
      if (started) {
        autoOpened.current.add(liveReply(started).id);
        setActiveId(started.id);
        return;
      }
    }
    const reply = liveReply(active);
    if (!reply || own[reply.id] || mirrored.current.has(`${reply.id}:${reply.run}`)) return;
    mirrored.current.add(`${reply.id}:${reply.run}`);
    followReply({
      chatId: active.id,
      id: reply.id,
      run: reply.run,
      title: active.title,
      mirror: true,
      resumeFrom: {
        content: reply.content || "",
        reasoning: reply.reasoning || "",
        startedAt: reply.startedAt,
      },
    });
  }, [session?.user?.sub, session?.offline, busy, activeId, chats]);

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
    open: (id, item) => { if (!openWorkProposal(item)) setWorkspace({ ...item, messageId: id }); },
    approve: (id, choice) => answerApproval(id, choice),
  };
  const onAction = useCallback(
    (type, id, payload) => handlers.current[type]?.(id, payload),
    [],
  );
  const openFromWorkspace = useCallback(
    (item) => { if (item?.kind === "work-proposal") openWorkProposal(item);
      else setWorkspace((current) => ({ ...item, messageId: current?.messageId })); },
    [],
  );

  async function continueAsGuest() {
    setError("");
    try {
      if (DESKTOP) await desktopGuest();
      else await request("/api/login", { guest: true });
      await loadSession();
    } catch (err) {
      setError(err.message);
    }
  }

  async function logout() {
    try {
      if (DESKTOP && guest) desktopLeaveGuest();
      else if (DESKTOP) await desktopSignOut();
      else await request("/api/logout", {});
      try {
        localStorage.removeItem(LAST_USER_KEY);
        sessionStorage.removeItem(GUEST_CHATS_KEY);
      } catch {
        /* nothing to forget */
      }
      setChats([]);
      setActiveId(null);
      setSession(null);
      setWorkroomOpen(false);
      setWorkDraft(null);
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
        googleState={DESKTOP || preferRedirect ? "redirect" : gsi}
        signingIn={desktopSigningIn}
        onCancelSignIn={cancelDesktopSignIn}
        onGoogleRedirect={async () => {
          if (!DESKTOP) return googleRedirect(session);
          setError("");
          setDesktopSigningIn(true);
          try { await desktopSignIn(); await loadSession(); }
          catch (err) { setError(String(err.message || err)); }
          finally { setDesktopSigningIn(false); }
        }}
        onGuest={session?.csrf ? continueAsGuest : undefined}
        onRetryGoogle={() => {
          googleScript = null;
          setGsiAttempt((n) => n + 1);
        }}
      />
    );

  if (desktopHandoff) return <DesktopHandoff pending={desktopHandoff} session={session} onCancel={() => setDesktopHandoff(null)} />;

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
          onWorkroom={() => { setMenu(false); setWorkDraft(null); setWorkroomOpen(true); }}
          workroomOpen={workroomOpen}
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
            onSaveAsWorkspace={messages.length > 0 && session?.user && !guest ? saveChatAsWorkspace : undefined}
          />
          {syncIssue && <Notice>{syncIssue}</Notice>}

          <div
            className="conversation"
            ref={conversation}
            onScroll={onScroll}
            onWheel={onWheel}
            onMouseUp={checkSelection}
            onKeyUp={(event) => event.shiftKey && checkSelection()}
          >
            <div className="edge-blur" data-edge="top" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
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
            <div className="edge-blur" data-edge="bottom" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
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
            {active?.workContext && (
              <div className="selected-work-context" role="status">
                <span>Using <strong>{active.workContext.title}</strong>. Vaelo has its files and knows the job.</span>
                <button className="text-button" onClick={() => {setWorkDraft(null);setWorkroomOpen(true);}}>Open in Workroom</button>
                <button className="text-button" onClick={() => setChats(current => current.map(chat => chat.id === activeId
                  ? {...chat,updated:Date.now(),workContext:undefined} : chat))}>Stop using it</button>
                {!messages.length && !busy && (getWorkspace(active.workContext.workspaceId)?.starters || active.workContext.starters || []).length > 0 && (
                  <div className="work-dock-starters" role="group" aria-label="Ways to start">
                    {(getWorkspace(active.workContext.workspaceId)?.starters || active.workContext.starters).map((item) => (
                      <button key={item} disabled={!online || !!session.offline} onClick={() => send({ text: item })}>{item}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
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
            {cloud === "Starting" && !busy && online && !session.offline && (
              <Notice tone="brass" role="status">
                Vaelo is waking up. Write away; your message goes as soon as
                it’s ready.
              </Notice>
            )}
            {cloud === "Unavailable" && online && !session.offline && (
              <Notice action="Try again" onAction={() => warmCloud()}>
                Vaelo is taking longer than usual to wake. Messages will wait
                for it.
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
              onStop={stopReply}
              onFiles={addFiles}
              onRemoveFile={(id) =>
                setAttachments((current) => current.filter((file) => file.id !== id))
              }
              onOptions={(patch) => setOptions((current) => ({ ...current, ...patch }))}
              onDictating={setDictating}
              guest={guest}
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
            onVerifyDocument={(messageId, title) => {
              /* The document is picked here, so the person only says what it must contain. */
              const draft = proposalDraft({ workspaceId: "document-check", title: `Check ${title}`.slice(0, 160), scope: "personal",
                check: { id: "document", input: { source: { kind: "vaelo-document", conversationId: activeId, messageId } } } }, { getWorkspace, getCheck });
              setWorkDraft({ draft, panel: "check", message: "Write what the document must say, then tap Work it out." });
              setWorkroomOpen(true);
            }}
          />
        )}

        {/* State changes are announced; individual words are not. */}
        <p className="sr-only" role="status" aria-live="polite">
          {announcement.text}
          {announcement.id % 2 ? "​" : ""}
        </p>
        <Toast toast={toast} onDismiss={() => setToast(null)} />
        <Tips />
        <Settings
          open={settingsOpen}
          prefs={prefs}
          onChange={(patch) => setPrefs((current) => ({ ...current, ...patch }))}
          onClose={() => setSettingsOpen(false)}
        />
        <Workroom open={workroomOpen} session={session} initialDraft={workDraft}
          onClose={() => {setWorkroomOpen(false);setWorkDraft(null);}}
          onStart={startWork} onRecordChange={updateSelectedWork} />
      </div>
      </PresentationContext.Provider>
    </IconContext.Provider>
  );
}
