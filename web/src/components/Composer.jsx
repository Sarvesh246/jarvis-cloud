import React, { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  CaretLeft,
  CaretRight,
  CaretUp,
  Check,
  Footprints,
  Globe,
  GraduationCap,
  MagnifyingGlass,
  Microphone,
  Paperclip,
  Scales,
  SlidersHorizontal,
  Stop,
  User,
  X,
} from "@phosphor-icons/react";
import { AttachmentList } from "./Message.jsx";
import { MESSAGE_LIMIT } from "../lib/attachments.js";
import { usePhone } from "../lib/use-phone.js";
import "./composer.css";
import { DESKTOP } from "../lib/desktop.js";
import { DesktopRecognition } from "../lib/dictation.js";

export const STYLES = [
  { id: "balanced", label: "Balanced", note: "Vaelo’s usual voice." },
  { id: "concise", label: "Concise", note: "The answer first, briefly." },
  { id: "thorough", label: "Thorough", note: "Reasoning, trade-offs, detail." },
];

/* Who Vaelo acts as. Each note is the whole explanation, shown under the
   name wherever a role is chosen, so nothing has to be hovered to be
   understood. Choosing the current role again sets it aside. */
export const ROLES = [
  {
    id: "tutor",
    label: "Tutor",
    Icon: GraduationCap,
    note: "Helps you work it out yourself, then tests you.",
    placeholder: "What do you want to learn?",
  },
  {
    id: "skeptic",
    label: "Skeptic",
    Icon: MagnifyingGlass,
    note: "Marks what’s backed up and what isn’t.",
    placeholder: "What should Vaelo check?",
  },
  {
    id: "advocate",
    label: "Advocate",
    Icon: Scales,
    note: "On your side when buying or complaining.",
    placeholder: "What are you buying or disputing?",
  },
  {
    id: "guide",
    label: "Guide",
    Icon: Footprints,
    note: "One step at a time, waiting for you.",
    placeholder: "What are you working through?",
  },
];

const Recognition =
  DESKTOP ? DesktopRecognition : typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

/* Dictation through the browser's own speech service. Words arrive in the
   field as you speak, so you can correct them before sending.

   Stopping is not instant: the speech service still sends the last words it
   heard, then ends a moment later, and it won't start a new take until the
   old one has ended. So the microphone turns off the moment you ask, a take
   asked for while the last one is finishing starts as soon as it can, and
   each take only ever writes its own words after the text it began with. */
const FINISH_WAIT = 1500;

function useDictation(draft, onChange) {
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [problem, setProblem] = useState("");
  const live = useRef(null);
  const finishing = useRef(null);
  const queued = useRef(0);
  const latest = useRef(draft);
  latest.current = draft;

  useEffect(
    () => () => {
      clearTimeout(queued.current);
      live.current?.abort();
      finishing.current?.abort();
    },
    [],
  );

  function begin() {
    const r = new Recognition();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    const base = latest.current ? `${latest.current.replace(/\s+$/, "")} ` : "";
    /* A finishing take may still deliver its last words, but never once a
       newer take is listening */
    const current = () => live.current === r || (finishing.current === r && !live.current);
    r.onprocessing = () => { setListening(false); setProcessing(true); };
    r.onresult = (event) => {
      if (!current()) return;
      let text = "";
      for (const result of event.results) text += result[0].transcript;
      const prefix = DESKTOP ? (latest.current ? `${latest.current.replace(/\s+$/, "")} ` : "") : base;
      latest.current = prefix + text.trimStart();
      onChange(latest.current);
    };
    r.onerror = (event) => {
      if (!current()) return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed")
        setProblem(DESKTOP ? "Allow microphone access for Vaelo in your system settings." : "Microphone access is off for this site.");
      else if (event.message) setProblem(event.message);
      else if (event.error !== "aborted" && event.error !== "no-speech")
        setProblem("Dictation stopped. Try again.");
    };
    r.onend = () => {
      if (DESKTOP) setProcessing(false);
      if (finishing.current === r) {
        finishing.current = null;
        if (queued.current) startQueued();
      }
      if (live.current === r) {
        live.current = null;
        setListening(false);
      }
    };
    live.current = r;
    try {
      r.start();
    } catch {
      live.current = null;
      setListening(false);
      setProblem("Dictation isn’t available right now.");
    }
  }

  function startQueued() {
    clearTimeout(queued.current);
    queued.current = 0;
    begin();
  }

  function toggle() {
    if (processing) return;
    if (listening) {
      clearTimeout(queued.current);
      queued.current = 0;
      if (live.current) {
        finishing.current = live.current;
        live.current = null;
        if (DESKTOP) setProcessing(true);
        finishing.current.stop();
      }
      setListening(false);
      return;
    }
    setProblem("");
    setListening(true);
    if (!finishing.current) {
      begin();
      return;
    }
    /* If the last take never says it has ended, let it go and start anyway */
    queued.current = setTimeout(() => {
      const stale = finishing.current;
      finishing.current = null;
      stale?.abort();
      startQueued();
    }, FINISH_WAIT);
  }

  return { supported: !!Recognition, listening, processing, problem, toggle };
}

/* While dictating, five gilt hairlines follow your voice and a clock counts
   the take, so an open microphone is never in doubt and you can see it
   hears you. The levels come from a quiet listen to the same microphone;
   where that isn't possible (iPhone and iPad keep the microphone to the
   speech service) the lines simply breathe. */
const IOS = typeof navigator !== "undefined" && /iP(hone|ad|od)/.test(navigator.userAgent);
const BAR_WEIGHTS = [0.55, 0.85, 1, 0.8, 0.6];

function useVoice(listening) {
  const bars = useRef(null);
  const [heard, setHeard] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!listening) return;
    const started = Date.now();
    setElapsed(0);
    const clock = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(clock);
  }, [listening]);

  useEffect(() => {
    if (!listening || IOS || !navigator.mediaDevices?.getUserMedia) return;
    const still =
      document.documentElement.dataset.motion === "reduce" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) return;
    let stream;
    let context;
    let frame = 0;
    let stopped = false;
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((media) => {
        if (stopped) return media.getTracks().forEach((track) => track.stop());
        stream = media;
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.75;
        context.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        setHeard(true);
        const draw = () => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 2; i < 48; i++) sum += data[i];
          const level = Math.min(1, sum / (46 * 150));
          bars.current?.childNodes.forEach((bar, i) => {
            bar.style.setProperty("--level", (0.18 + level * BAR_WEIGHTS[i] * 0.82).toFixed(3));
          });
          frame = requestAnimationFrame(draw);
        };
        draw();
      })
      .catch(() => {});
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      context?.close().catch(() => {});
      setHeard(false);
    };
  }, [listening]);

  const time = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  return { bars, heard, time };
}

/* "No role" heads the list wherever roles are chosen one by one */
const ROLE_CHOICES = [
  { id: "none", label: "Just Vaelo", Icon: User, note: "Answers you directly, as usual." },
  ...ROLES,
];

/* On a larger screen the tools open beside the button. The roles have a
   page of their own, reached from the main list, so the main list stays
   short and the roles keep their full descriptions. */
function ToolsMenu({ options, onOptions, onClose, anchor, guest }) {
  const menu = useRef(null);
  const [glide, setGlide] = useState(null);
  const [page, setPage] = useState("main");
  const role = ROLES.find((r) => r.id === options.role);
  const RoleIcon = role?.Icon || User;

  /* The highlight follows the pointer, and returns to the focused row
     when the pointer leaves */
  function track(node) {
    const item = node?.closest?.(".tools-item");
    if (!item || !menu.current?.contains(item)) return;
    setGlide((current) => ({
      y: item.offsetTop,
      h: item.offsetHeight,
      moved: !!current,
    }));
  }
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    function away(event) {
      if (!menu.current?.contains(event.target) && !anchor.current?.contains(event.target))
        close.current();
    }
    addEventListener("pointerdown", away);
    return () => removeEventListener("pointerdown", away);
  }, [anchor]);

  /* Each page opens on the row that matters: the chosen role, or the way
     back to it from the main list */
  const returning = useRef(false);
  useLayoutEffect(() => {
    setGlide(null);
    const items = menu.current?.querySelectorAll("[role^=menuitem]");
    const start =
      page === "role"
        ? menu.current?.querySelector("[aria-checked=true]")
        : returning.current && menu.current?.querySelector("[data-opens=role]");
    returning.current = false;
    (start || items?.[0])?.focus();
  }, [page]);

  const [returned, setReturned] = useState(false);
  function back() {
    returning.current = true;
    setReturned(true);
    setPage("main");
  }

  function keys(event) {
    const items = [...menu.current.querySelectorAll("[role^=menuitem]")];
    const at = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown") items[(at + 1) % items.length]?.focus();
    else if (event.key === "ArrowUp") items[(at - 1 + items.length) % items.length]?.focus();
    else if (event.key === "ArrowRight" && document.activeElement?.dataset.opens) setPage("role");
    else if ((event.key === "ArrowLeft" || event.key === "Escape") && page === "role") {
      event.stopPropagation();
      back();
    } else if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.stopPropagation();
      onClose(true);
      return;
    } else return;
    event.preventDefault();
  }

  return (
    <div
      className="tools-menu"
      role="menu"
      aria-label="Tools"
      ref={menu}
      onKeyDown={keys}
      onPointerOver={(event) => track(event.target)}
      onFocus={(event) => track(event.target)}
      onPointerLeave={() => {
        if (menu.current?.contains(document.activeElement)) track(document.activeElement);
        else setGlide(null);
      }}
    >
      <span
        className="tools-glide"
        aria-hidden="true"
        data-on={glide ? true : undefined}
        data-moved={glide?.moved || undefined}
        style={glide ? { "--glide-y": `${glide.y}px`, "--glide-h": `${glide.h}px` } : undefined}
      />
      {page === "role" ? (
        <div className="tools-menu-page" key="role" data-from="right">
          <button role="menuitem" className="tools-back" onClick={back}>
            <CaretLeft size={16} /> Act as
          </button>
          {ROLE_CHOICES.map(({ id, label, Icon, note }) => (
            <button
              key={id}
              role="menuitemradio"
              aria-checked={(options.role || "none") === id}
              className="tools-item"
              onClick={() => {
                onOptions({ role: id });
                onClose(true);
              }}
            >
              <Icon size={18} />
              <span className="tools-text">
                <span>{label}</span>
                <span className="tools-note">{note}</span>
              </span>
              {(options.role || "none") === id && <Check size={16} className="tools-check" />}
            </button>
          ))}
        </div>
      ) : (
        <div className="tools-menu-page" key="main" data-from={returned ? "left" : undefined}>
          {/* Guests are answered without tools, so there is no research to offer. */}
          {!guest && <button
            role="menuitemcheckbox"
            aria-checked={options.research}
            className="tools-item"
            onClick={() => onOptions({ research: !options.research })}
          >
            <Globe size={18} />
            <span className="tools-text">
              <span>Research with sources</span>
              <span className="tools-note">Searches the web and cites what it finds.</span>
            </span>
            {options.research && <Check size={16} className="tools-check" />}
          </button>}
          <button
            role="menuitem"
            aria-haspopup="menu"
            className="tools-item"
            data-opens="role"
            onClick={() => setPage("role")}
          >
            <RoleIcon size={18} />
            <span className="tools-text">
              <span>Act as</span>
              <span className="tools-note">
                {role ? `${role.label}. ${role.note}` : "Vaelo as usual. Pick a tutor, skeptic and more."}
              </span>
            </span>
            <CaretRight size={16} className="tools-more" />
          </button>
          <p className="label tools-group">Response style</p>
          {STYLES.map((style) => (
            <button
              key={style.id}
              role="menuitemradio"
              aria-checked={options.style === style.id}
              className="tools-item"
              onClick={() => {
                onOptions({ style: style.id });
                onClose(true);
              }}
            >
              <span className="tools-radio" aria-hidden="true" />
              <span className="tools-text">
                <span>{style.label}</span>
                <span className="tools-note">{style.note}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* On a phone the tools rise as a sheet from the bottom edge, in reach of a
   thumb. It has two pages: what's on (research, the current style) and the
   styles themselves; the sheet's height eases between them as one page
   slides in for the other. Drag it down or tap outside to put it away. */
const CLOSE_AFTER = 80;

function ToolsSheet({ options, onOptions, onClose, guest }) {
  const [page, setPage] = useState("main");
  const [height, setHeight] = useState();
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const pages = { main: useRef(null), role: useRef(null), style: useRef(null) };
  const drag = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const style = STYLES.find((s) => s.id === options.style);
  const role = ROLES.find((r) => r.id === options.role);
  const RoleIcon = role?.Icon || User;

  const dismiss = useCallback((refocus) => {
    setLeaving(true);
    setTimeout(() => close.current(refocus), 340);
  }, []);

  useLayoutEffect(() => {
    setHeight(pages[page].current?.offsetHeight);
    pages[page].current?.querySelector("button")?.focus({ preventScroll: true });
  }, [page]);

  useEffect(() => {
    function keys(event) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (page !== "main") setPage("main");
      else dismiss(true);
    }
    addEventListener("keydown", keys, true);
    return () => removeEventListener("keydown", keys, true);
  }, [page, dismiss]);

  const grip = {
    onPointerDown(event) {
      drag.current = { y: event.clientY, at: performance.now() };
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event) {
      if (drag.current) setPull(Math.max(0, event.clientY - drag.current.y));
    },
    onPointerUp(event) {
      if (!drag.current) return;
      const distance = Math.max(0, event.clientY - drag.current.y);
      const speed = distance / Math.max(1, performance.now() - drag.current.at);
      drag.current = null;
      setDragging(false);
      if (distance > CLOSE_AFTER || speed > 0.6) dismiss(true);
      else setPull(0);
    },
    onPointerCancel() {
      drag.current = null;
      setDragging(false);
      setPull(0);
    },
  };

  return createPortal(
    <div className="tools-sheet-layer" data-leaving={leaving || undefined}>
      <div className="tools-scrim" onClick={() => dismiss(true)} />
      <div
        className="tools-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Tools"
        data-dragging={dragging || undefined}
        style={{ "--pull": `${pull}px` }}
      >
        <div className="tools-grip" {...grip}>
          <span aria-hidden="true" />
        </div>
        <div className="tools-pages" style={{ height }} data-page={page}>
          <div className="tools-page" ref={pages.main} inert={page !== "main"}>
            {!guest && <button
              role="switch"
              aria-checked={options.research}
              className="tools-item"
              onClick={() => onOptions({ research: !options.research })}
            >
              <Globe size={20} />
              <span className="tools-text">
                <span>Research with sources</span>
                <span className="tools-note">Searches the web and cites what it finds.</span>
              </span>
              {options.research && <Check size={18} className="tools-check" />}
            </button>}
            <button className="tools-item" onClick={() => setPage("role")}>
              <RoleIcon size={20} />
              <span className="tools-text">
                <span>Act as</span>
                <span className="tools-note">
                  {role ? `${role.label}. ${role.note}` : "Vaelo as usual. Pick a tutor, skeptic and more."}
                </span>
              </span>
              <CaretRight size={16} className="tools-more" />
            </button>
            <button className="tools-item" onClick={() => setPage("style")}>
              <SlidersHorizontal size={20} />
              <span className="tools-text">
                <span>Response style</span>
                <span className="tools-note">{style?.label}. {style?.note}</span>
              </span>
              <CaretRight size={16} className="tools-more" />
            </button>
          </div>
          <div
            className="tools-page"
            ref={pages.role}
            inert={page !== "role"}
            data-current={page === "role" || undefined}
          >
            <button className="tools-back" onClick={() => setPage("main")}>
              <CaretLeft size={16} /> Act as
            </button>
            <div role="radiogroup" aria-label="Act as">
              {ROLE_CHOICES.map(({ id, label, Icon, note }) => (
                <button
                  key={id}
                  role="radio"
                  aria-checked={(options.role || "none") === id}
                  className="tools-item"
                  onClick={() => {
                    onOptions({ role: id });
                    dismiss(true);
                  }}
                >
                  <Icon size={20} />
                  <span className="tools-text">
                    <span>{label}</span>
                    <span className="tools-note">{note}</span>
                  </span>
                  {(options.role || "none") === id && <Check size={18} className="tools-check" />}
                </button>
              ))}
            </div>
          </div>
          <div
            className="tools-page"
            ref={pages.style}
            inert={page !== "style"}
            data-current={page === "style" || undefined}
          >
            <button className="tools-back" onClick={() => setPage("main")}>
              <CaretLeft size={16} /> Response style
            </button>
            <div role="radiogroup" aria-label="Response style">
              {STYLES.map((option) => (
                <button
                  key={option.id}
                  role="radio"
                  aria-checked={options.style === option.id}
                  className="tools-item"
                  onClick={() => {
                    onOptions({ style: option.id });
                    dismiss(true);
                  }}
                >
                  <span className="tools-radio" aria-hidden="true" />
                  <span className="tools-text">
                    <span>{option.label}</span>
                    <span className="tools-note">{option.note}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export const Composer = forwardRef(function Composer(
  {
    draft,
    busy,
    offline,
    attachments,
    options,
    length,
    onChange,
    onSend,
    onStop,
    onFiles,
    onRemoveFile,
    onOptions,
    onDictating,
    guest = false,
  },
  textarea,
) {
  const [menu, setMenu] = useState(false);
  const phone = usePhone();
  const picker = useRef(null);
  const toolsButton = useRef(null);
  const dictation = useDictation(draft, onChange);
  const voice = useVoice(dictation.listening);
  const over = length > MESSAGE_LIMIT;
  const reading = attachments.some((file) => file.state === "reading");
  const ready = draft.trim() || attachments.some((file) => file.state === "ready");
  const style = STYLES.find((s) => s.id === options.style);
  const role = ROLES.find((r) => r.id === options.role);
  /* Status that belongs to the message, not the buttons: said on its own
     line so the instrument row never grows or shifts. */
  const note = dictation.problem
    ? { tone: "problem", text: dictation.problem }
    : dictation.processing
      ? { text: "Transcribing your recording…" }
    : over
      ? {
          tone: "problem",
          text: `${length.toLocaleString()} / ${MESSAGE_LIMIT.toLocaleString()} characters. Trim the message or a file.`,
        }
      : null;

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 208)}px`;
  }, [draft, textarea]);

  useEffect(() => onDictating?.(dictation.listening), [dictation.listening, onDictating]);

  function send() {
    if (dictation.processing) return;
    if (DESKTOP && dictation.listening) { dictation.toggle(); return; }
    if (dictation.listening) dictation.toggle();
    if (!over && !reading && !offline) onSend();
  }

  return (
    <form
      className="composer"
      data-listening={dictation.listening || undefined}
      data-busy={busy || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <AttachmentList items={attachments} onRemove={onRemoveFile} />
      <textarea
        dir="auto"
        ref={textarea}
        value={draft}
        onChange={(event) => onChange(event.target.value)}
        onPaste={(event) => {
          const files = [...(event.clipboardData?.files || [])];
          if (files.length && !event.clipboardData.getData("text")) {
            event.preventDefault();
            onFiles(files);
          }
        }}
        placeholder={
          dictation.listening
            ? "Listening…"
            : role?.placeholder ||
              (options.research && !guest ? "What should Vaelo look into?" : "Write to Vaelo")
        }
        aria-label="Message Vaelo"
        aria-describedby="composer-status"
        rows={1}
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
      <p className="composer-note" id="composer-status" aria-live="polite" data-tone={note?.tone}>
        {note?.text}
      </p>
      <div className="composer-bar">
        <div className="composer-start">
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            accept={`${guest ? "" : "image/png,image/jpeg,image/webp,image/gif,"}text/*,.md,.markdown,.csv,.tsv,.json,.jsonl,.xml,.yml,.yaml,.toml,.ini,.log,.html,.css,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cpp,.cs,.php,.sh,.ps1,.sql,.svg`}
            onChange={(event) => {
              onFiles([...event.target.files]);
              event.target.value = "";
              textarea.current?.focus();
            }}
          />
          <button
            type="button"
            className="icon-button composer-tool"
            aria-label="Attach images or files"
            data-tip="Attach images or files (or drop or paste them)"
            onClick={() => picker.current?.click()}
          >
            <Paperclip size={20} />
          </button>
          {/* The current way of answering is always in view, one tap from
              changing; research and style live behind it. */}
          <span className="tools-anchor" ref={toolsButton}>
            <button
              type="button"
              className="mode-button"
              aria-label={`Response style: ${style?.label}. Tools and roles`}
              data-tip="Response style, roles and research"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((value) => !value)}
            >
              <SlidersHorizontal size={17} aria-hidden="true" />
              <span>{style?.label}</span>
              <CaretUp size={12} aria-hidden="true" className="mode-caret" />
            </button>
            {menu && phone && (
              <ToolsSheet
                guest={guest}
                options={options}
                onOptions={onOptions}
                onClose={(refocus) => {
                  setMenu(false);
                  if (refocus) toolsButton.current?.querySelector("button")?.focus();
                }}
              />
            )}
            {menu && !phone && (
              <ToolsMenu
                guest={guest}
                options={options}
                onOptions={onOptions}
                anchor={toolsButton}
                onClose={(refocus) => {
                  setMenu(false);
                  if (refocus) textarea.current?.focus();
                }}
              />
            )}
          </span>
          {/* The note rides along as a tip, so a role chosen a while ago
              still says what it does without opening the menu. */}
          {role && (
            <span className="mode-chip" data-tip={role.note}>
              <role.Icon size={14} aria-hidden="true" />
              <span className="mode-chip-text">{role.label}</span>
              <button
                type="button"
                aria-label={`Stop acting as ${role.label.toLowerCase()}`}
                data-tip={`Stop acting as ${role.label.toLowerCase()}`}
                onClick={() => onOptions({ role: "none" })}
              >
                <X size={12} />
              </button>
            </span>
          )}
          {options.research && (
            <span className="mode-chip">
              <Globe size={14} aria-hidden="true" />
              <span className="mode-chip-text">Research</span>
              <button
                type="button"
                aria-label="Turn off research"
                onClick={() => onOptions({ research: false })}
              >
                <X size={12} />
              </button>
            </span>
          )}
        </div>
        {dictation.listening && (
          <span className="composer-live" role="status">
            <span
              className="voice-bars"
              ref={voice.bars}
              data-heard={voice.heard || undefined}
              aria-hidden="true"
            >
              {BAR_WEIGHTS.map((_, i) => (
                <span key={i} />
              ))}
            </span>
            <span className="composer-live-text">Listening</span>
            <span className="voice-time" aria-hidden="true">
              {voice.time}
            </span>
          </span>
        )}
        <div className="composer-end">
          {!draft && !note && (
            <span className="composer-hint">Enter to send · Shift+Enter for a new line</span>
          )}
          {dictation.supported && !guest && (
            <button
              type="button"
              className="icon-button composer-tool composer-mic"
              aria-label={dictation.listening ? "Stop dictation" : "Dictate"}
              aria-pressed={dictation.listening}
              disabled={dictation.processing}
              data-tip={dictation.listening ? "Stop dictation" : "Dictate"}
              onClick={dictation.toggle}
            >
              <Microphone size={20} weight={dictation.listening ? "fill" : undefined} />
            </button>
          )}
          <button
            type={busy ? "button" : "submit"}
            className="send"
            data-mode={busy ? "stop" : "send"}
            aria-label={busy ? "Stop" : "Send"}
            data-tip={busy ? "Stop (Esc)" : "Send"}
            disabled={!busy && (!ready || over || reading || offline)}
            onClick={busy ? onStop : undefined}
          >
            <ArrowUp className="send-arrow" size={20} weight="bold" />
            <Stop className="send-stop" size={16} weight="fill" />
          </button>
        </div>
      </div>
    </form>
  );
});
