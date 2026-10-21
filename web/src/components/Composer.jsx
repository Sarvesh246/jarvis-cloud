import React, { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Binoculars,
  Camera,
  CaretLeft,
  CaretRight,
  CaretUp,
  Check,
  FileArrowUp,
  Footprints,
  Globe,
  GraduationCap,
  ImageSquare,
  MagnifyingGlass,
  Microphone,
  Paperclip,
  PlusCircle,
  Scales,
  SlidersHorizontal,
  Stop,
  Toolbox,
  User,
  X,
} from "@phosphor-icons/react";
import { AttachmentList } from "./Message.jsx";
import { Sheet } from "./Sheet.jsx";
import { MESSAGE_LIMIT } from "../lib/attachments.js";
import { usePhone } from "../lib/use-phone.js";
import { buzz } from "../lib/haptics.js";
import "./composer.css";
import { ActivityIsland } from "./UITools.jsx";
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

function useDictation(draft, onChange, conversationId) {
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [problem, setProblem] = useState("");
  const live = useRef(null);
  const finishing = useRef(null);
  const queued = useRef(0);
  const latest = useRef(draft);
  const conversation = useRef(conversationId);
  latest.current = draft;
  conversation.current = conversationId;

  useEffect(
    () => {
      setListening(false);
      setProcessing(false);
      setProblem("");
      return () => {
        clearTimeout(queued.current);
        queued.current = 0;
        const takes = [live.current, finishing.current];
        live.current = finishing.current = null;
        takes.forEach(take => take?.abort());
      };
    },
    [conversationId],
  );

  function begin() {
    const r = new Recognition();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    const base = latest.current ? `${latest.current.replace(/\s+$/, "")} ` : "";
    /* A finishing take may still deliver its last words, but never once a
       newer take is listening */
    const current = () => conversation.current === conversationId &&
      (live.current === r || (finishing.current === r && !live.current));
    r.onprocessing = () => { if (current()) { setListening(false); setProcessing(true); } };
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
      if (!current()) return;
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

  /* Put the take away: nothing it heard is kept */
  function cancel() {
    clearTimeout(queued.current);
    queued.current = 0;
    const takes = [live.current, finishing.current];
    live.current = finishing.current = null;
    setListening(false);
    setProcessing(false);
    takes.forEach(take => take?.abort());
  }

  return { supported: !!Recognition, listening, processing, problem, toggle, cancel };
}

/* While dictating, five gilt hairlines follow your voice and a clock counts
   the take, so an open microphone is never in doubt and you can see it
   hears you. The levels come from a quiet listen to the same microphone;
   where that isn't possible (iPhone and iPad keep the microphone to the
   speech service) the lines simply breathe. */
const IOS = typeof navigator !== "undefined" && /iP(hone|ad|od)/.test(navigator.userAgent);
const BAR_WEIGHTS = [0.55, 0.85, 1, 0.8, 0.6];
/* The phone's dictation panel draws nine, tallest in the middle */
const PHONE_BAR_WEIGHTS = [0.45, 0.62, 0.8, 0.92, 1, 0.9, 0.78, 0.6, 0.48];

function useVoice(listening, weights = BAR_WEIGHTS) {
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
            bar.style.setProperty("--level", (0.18 + level * (weights[i] ?? 0.6) * 0.82).toFixed(3));
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
   thumb: where a file comes from, research, how Vaelo answers, and who it
   answers as. Everything is on one page. Drag it down or tap outside to put
   it away. */
function ToolsSheet({ open, options, onOptions, onClose, guest, onAttach }) {
  const pick = (patch) => {
    buzz();
    onOptions(patch);
  };
  return (
    <Sheet open={open} onClose={onClose} label="Tools" tall>
      <div className="sh-attach" data-count={guest ? 1 : 3}>
        {!guest && (
          <button type="button" className="sh-tile" onClick={() => onAttach("photos")}>
            <ImageSquare size={26} />
            Photos
          </button>
        )}
        {!guest && (
          <button type="button" className="sh-tile" onClick={() => onAttach("camera")}>
            <Camera size={26} />
            Camera
          </button>
        )}
        <button type="button" className="sh-tile" onClick={() => onAttach("files")}>
          <FileArrowUp size={26} />
          Files
        </button>
      </div>

      {/* Guests are answered without tools, so there is no research to offer. */}
      {!guest && (
        <button
          type="button"
          role="switch"
          aria-checked={options.research}
          className="sh-row sh-feature"
          onClick={() => pick({ research: !options.research })}
        >
          <Binoculars size={24} />
          <span className="sh-row-text">
            <span>Research</span>
            <span className="sh-row-note">Search wide and cite beside each claim</span>
          </span>
          <span className="sh-switch" data-on={options.research || undefined} aria-hidden="true" />
        </button>
      )}

      <h3 className="label sh-label">Response style</h3>
      <div role="radiogroup" aria-label="Response style">
        {STYLES.map((style) => (
          <button
            key={style.id}
            type="button"
            role="radio"
            aria-checked={options.style === style.id}
            className="sh-row sh-radio-row"
            onClick={() => onOptions({ style: style.id })}
          >
            <span className="sh-row-text">
              <span>{style.label}</span>
              <span className="sh-row-note">{style.note}</span>
            </span>
            <span className="sh-radio" aria-hidden="true" />
          </button>
        ))}
      </div>

      <h3 className="label sh-label">Act as</h3>
      <div className="sh-roles" role="radiogroup" aria-label="Act as">
        {ROLES.map(({ id, label, Icon, note }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={options.role === id}
            className="sh-role"
            onClick={() => pick({ role: options.role === id ? "none" : id })}
          >
            <Icon size={24} />
            <span>{label}</span>
            <span>{note}</span>
          </button>
        ))}
      </div>
    </Sheet>
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
    conversationId,
    guest = false,
    workContext,
    onClearWork,
    sendKey = "enter",
  },
  textarea,
) {
  // The desktop composer moves into the welcome on a new chat. Focus after
  // that box mounts, including the first authenticated page load.
  useLayoutEffect(() => {
    textarea.current?.focus({ preventScroll: true });
  }, [conversationId, textarea]);

  const [menu, setMenu] = useState(false);
  const phone = usePhone();
  const picker = useRef(null);
  const photos = useRef(null);
  const camera = useRef(null);
  const toolsButton = useRef(null);
  const dictation = useDictation(draft, onChange, conversationId);
  const voice = useVoice(dictation.listening, phone ? PHONE_BAR_WEIGHTS : BAR_WEIGHTS);
  const over = length > MESSAGE_LIMIT;
  const reading = attachments.some((file) => file.state === "reading");
  const ready = draft.trim() || attachments.some((file) => file.state === "ready");
  const style = STYLES.find((s) => s.id === options.style);
  const role = ROLES.find((r) => r.id === options.role);
  /* On a phone, dictation takes the place of the box: what is being said
     shows large above one row of controls. What was already written stays
     out of it, and cancelling gives that back. */
  const panel = phone && dictation.listening;
  const written = useRef(draft);
  const spokenFrom = useRef("");
  written.current = draft;
  useEffect(() => {
    if (dictation.listening) spokenFrom.current = written.current;
  }, [dictation.listening]);
  const spoken = draft.startsWith(spokenFrom.current) ? draft.slice(spokenFrom.current.length).trim() : draft.trim();
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
    el.style.height = `${Math.min(el.scrollHeight, phone ? 132 : 208)}px`;
  }, [draft, textarea, phone]);

  useEffect(() => onDictating?.(dictation.listening), [dictation.listening, onDictating]);

  function send() {
    if (dictation.processing) return;
    if (DESKTOP && dictation.listening) { dictation.toggle(); return; }
    if (dictation.listening) dictation.toggle();
    if (!over && !reading && !offline) onSend();
  }

  const accept = `${guest ? "" : "image/png,image/jpeg,image/webp,image/gif,"}text/*,.md,.markdown,.csv,.tsv,.json,.jsonl,.xml,.yml,.yaml,.toml,.ini,.log,.html,.css,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cpp,.cs,.php,.sh,.ps1,.sql,.svg`;
  const taken = (event) => {
    onFiles([...event.target.files]);
    event.target.value = "";
    textarea.current?.focus();
  };

  return (
    <form
      className="composer"
      data-phone={phone || undefined}
      data-panel={panel || undefined}
      data-listening={dictation.listening || undefined}
      data-busy={busy || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      {(dictation.listening || dictation.processing || reading) && <ActivityIsland title={dictation.listening ? "Recording your voice" : dictation.processing ? "Transcribing your recording" : "Reading attachments"}><p>{dictation.listening ? "Use the microphone button to stop recording. Your words appear in the message field." : dictation.processing ? "The recording is being transcribed. You can send once the text is ready." : `${attachments.filter(file => file.state === "reading").length} attachment(s) being read. See the file previews below.`}</p></ActivityIsland>}

      {panel && (
        <div className="dictation" role="group" aria-label="Dictation">
          <p className="dictation-text" aria-live="polite">
            {spoken || "Listening…"}
          </p>
          <div className="dictation-row">
            <button
              type="button"
              className="dictation-cancel"
              aria-label="Cancel dictation"
              onClick={() => {
                buzz();
                dictation.cancel();
                onChange(spokenFrom.current);
              }}
            >
              <X size={20} />
            </button>
            <div className="dictation-live" role="status">
              <span className="voice-bars" ref={voice.bars} data-heard={voice.heard || undefined} aria-hidden="true">
                {PHONE_BAR_WEIGHTS.map((_, i) => (
                  <span key={i} />
                ))}
              </span>
              <span className="voice-time" aria-label="Recording time">
                {voice.time}
              </span>
            </div>
            <button
              type="button"
              className="dictation-done"
              aria-label="Done"
              onClick={() => {
                buzz();
                dictation.toggle();
                textarea.current?.focus();
              }}
            >
              <Check size={20} />
            </button>
          </div>
        </div>
      )}

      <div className="composer-main" hidden={panel || undefined}>
        {phone ? (
          (options.research || role || workContext || attachments.length > 0) && (
            <div className="composer-chips">
              {options.research && !guest && (
                <span className="mode-chip">
                  <Binoculars size={15} aria-hidden="true" />
                  <span className="mode-chip-text">Research</span>
                  <button type="button" aria-label="Turn off research" onClick={() => onOptions({ research: false })}>
                    <X size={13} />
                  </button>
                </span>
              )}
              {role && (
                <span className="mode-chip">
                  <role.Icon size={15} aria-hidden="true" />
                  <span className="mode-chip-text">{role.label}</span>
                  <button type="button" aria-label={`Stop acting as ${role.label.toLowerCase()}`} onClick={() => onOptions({ role: "none" })}>
                    <X size={13} />
                  </button>
                </span>
              )}
              {workContext && (
                <span className="mode-chip">
                  <Toolbox size={15} aria-hidden="true" />
                  <span className="mode-chip-text">{workContext.title}</span>
                  <button type="button" aria-label="Stop using this workspace" onClick={onClearWork}>
                    <X size={13} />
                  </button>
                </span>
              )}
              <AttachmentList items={attachments} onRemove={onRemoveFile} />
            </div>
          )
        ) : (
          <AttachmentList items={attachments} onRemove={onRemoveFile} />
        )}
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
                (phone
                  ? "Ask anything"
                  : options.research && !guest ? "What should Vaelo look into?" : "Write to Vaelo")
          }
          aria-label="Message Vaelo"
          aria-describedby="composer-status"
          rows={1}
          onKeyDown={(event) => {
            /* "enter" sends on Enter and breaks the line on Shift+Enter; "mod-enter"
               sends only on Ctrl or Cmd+Enter and lets Enter write a new line. */
            const sends = sendKey === "mod-enter" ? event.ctrlKey || event.metaKey : !event.shiftKey;
            if (
              event.key === "Enter" &&
              sends &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229 &&
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
            {phone ? (
              <>
                <button
                  type="button"
                  className="icon-button composer-tool composer-plus"
                  aria-label="Attach files, turn on research, choose a role"
                  aria-haspopup="dialog"
                  onClick={() => {
                    buzz();
                    setMenu(true);
                  }}
                >
                  <PlusCircle size={22} />
                </button>
                <button
                  type="button"
                  className="mode-button"
                  aria-label={`Response style: ${style?.label}. Tools and roles`}
                  aria-haspopup="dialog"
                  aria-expanded={menu}
                  onClick={() => {
                    buzz();
                    setMenu(true);
                  }}
                >
                  <span>{style?.label}</span>
                  <CaretUp size={13} aria-hidden="true" className="mode-caret" />
                </button>
              </>
            ) : (
              <>
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
                  {menu && (
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
              </>
            )}
          </div>
          {!phone && dictation.listening && (
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
              <span className="composer-hint">{sendKey === "mod-enter" ? "Ctrl+Enter to send · Enter for a new line" : "Enter to send · Shift+Enter for a new line"}</span>
            )}
            {dictation.supported && !guest && (
              <button
                type="button"
                className="icon-button composer-tool composer-mic"
                aria-label={dictation.listening ? "Stop dictation" : "Dictate"}
                aria-pressed={dictation.listening}
                disabled={dictation.processing}
                data-tip={dictation.listening ? "Stop dictation" : "Dictate"}
                onClick={() => {
                  if (phone) buzz();
                  dictation.toggle();
                }}
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
              onClick={busy ? () => onStop() : undefined}
            >
              <ArrowUp className="send-arrow" size={20} weight="bold" />
              <Stop className="send-stop" size={16} weight="fill" />
            </button>
          </div>
        </div>
      </div>

      <input ref={picker} type="file" multiple hidden accept={accept} onChange={taken} />
      {phone && !guest && (
        <>
          <input ref={photos} type="file" multiple hidden accept="image/*" onChange={taken} />
          <input ref={camera} type="file" hidden accept="image/*" capture="environment" onChange={taken} />
        </>
      )}
      {phone && (
        <ToolsSheet
          open={menu}
          guest={guest}
          options={options}
          onOptions={onOptions}
          onClose={() => setMenu(false)}
          onAttach={(kind) => {
            buzz();
            setMenu(false);
            (kind === "photos" ? photos : kind === "camera" ? camera : picker).current?.click();
          }}
        />
      )}
    </form>
  );
});
