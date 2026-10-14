import React, { forwardRef, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  Globe,
  Microphone,
  Paperclip,
  SlidersHorizontal,
  Stop,
  X,
} from "@phosphor-icons/react";
import { AttachmentList } from "./Message.jsx";
import { MESSAGE_LIMIT } from "../lib/attachments.js";
import "./composer.css";

export const STYLES = [
  { id: "balanced", label: "Balanced", note: "Vaelo’s usual voice." },
  { id: "concise", label: "Concise", note: "The answer first, briefly." },
  { id: "thorough", label: "Thorough", note: "Reasoning, trade-offs, detail." },
];

const Recognition =
  typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

/* Dictation through the browser's own speech service. Words arrive in the
   field as you speak, so you can correct them before sending. */
function useDictation(draft, onChange) {
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState("");
  const recognizer = useRef(null);
  const base = useRef("");

  useEffect(() => () => recognizer.current?.abort(), []);

  function toggle() {
    if (listening) {
      recognizer.current?.stop();
      return;
    }
    setProblem("");
    const r = new Recognition();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    base.current = draft ? `${draft.replace(/\s+$/, "")} ` : "";
    r.onresult = (event) => {
      let text = "";
      for (const result of event.results) text += result[0].transcript;
      onChange(base.current + text.trimStart());
    };
    r.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed")
        setProblem("Microphone access is off for this site.");
      else if (event.error !== "aborted" && event.error !== "no-speech")
        setProblem("Dictation stopped. Try again.");
    };
    r.onend = () => setListening(false);
    recognizer.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setProblem("Dictation isn’t available right now.");
    }
  }

  return { supported: !!Recognition, listening, problem, toggle };
}

function ToolsMenu({ options, onOptions, onClose, anchor }) {
  const menu = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    menu.current?.querySelector("[role^=menuitem]")?.focus();
    function away(event) {
      if (!menu.current?.contains(event.target) && !anchor.current?.contains(event.target))
        close.current();
    }
    addEventListener("pointerdown", away);
    return () => removeEventListener("pointerdown", away);
  }, [anchor]);

  function keys(event) {
    const items = [...menu.current.querySelectorAll("[role^=menuitem]")];
    const at = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown") items[(at + 1) % items.length]?.focus();
    else if (event.key === "ArrowUp") items[(at - 1 + items.length) % items.length]?.focus();
    else if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.stopPropagation();
      onClose(true);
      return;
    } else return;
    event.preventDefault();
  }

  return (
    <div className="tools-menu" role="menu" aria-label="Tools" ref={menu} onKeyDown={keys}>
      <button
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
  },
  textarea,
) {
  const [menu, setMenu] = useState(false);
  const picker = useRef(null);
  const toolsButton = useRef(null);
  const dictation = useDictation(draft, onChange);
  const over = length > MESSAGE_LIMIT;
  const reading = attachments.some((file) => file.state === "reading");
  const ready = draft.trim() || attachments.some((file) => file.state === "ready");
  const style = STYLES.find((s) => s.id === options.style);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 208)}px`;
  }, [draft, textarea]);

  useEffect(() => onDictating?.(dictation.listening), [dictation.listening, onDictating]);

  function send() {
    if (dictation.listening) dictation.toggle();
    if (!over && !reading && !offline) onSend();
  }

  return (
    <form
      className="composer"
      data-listening={dictation.listening || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <AttachmentList items={attachments} onRemove={onRemoveFile} />
      <textarea
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
        placeholder={dictation.listening ? "Listening…" : options.research ? "What should Vaelo look into?" : "Write to Vaelo"}
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
      <div className="composer-bar">
        <div className="composer-start">
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            accept="image/png,image/jpeg,image/webp,image/gif,text/*,.md,.markdown,.csv,.tsv,.json,.jsonl,.xml,.yml,.yaml,.toml,.ini,.log,.html,.css,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cpp,.cs,.php,.sh,.ps1,.sql,.svg"
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
            title="Attach images or files (or drop or paste them)"
            onClick={() => picker.current?.click()}
          >
            <Paperclip size={20} />
          </button>
          <span className="tools-anchor" ref={toolsButton}>
            <button
              type="button"
              className="icon-button composer-tool"
              aria-label="Tools"
              title="Tools"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((value) => !value)}
            >
              <SlidersHorizontal size={20} />
            </button>
            {menu && (
              <ToolsMenu
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
          {options.research && (
            <span className="mode-chip">
              <Globe size={14} aria-hidden="true" />
              Research
              <button
                type="button"
                aria-label="Turn off research"
                onClick={() => onOptions({ research: false })}
              >
                <X size={12} />
              </button>
            </span>
          )}
          {options.style !== "balanced" && (
            <span className="mode-chip">
              {style?.label}
              <button
                type="button"
                aria-label={`Return to balanced style`}
                onClick={() => onOptions({ style: "balanced" })}
              >
                <X size={12} />
              </button>
            </span>
          )}
        </div>
        <div className="composer-end">
          <span className="composer-status" id="composer-status" aria-live="polite">
            {dictation.problem ? (
              dictation.problem
            ) : over ? (
              <span className="composer-over">
                {length.toLocaleString()} / {MESSAGE_LIMIT.toLocaleString()} characters. Trim the
                message or a file.
              </span>
            ) : dictation.listening ? (
              <span className="composer-listening">Listening. Press the microphone to stop.</span>
            ) : draft ? null : (
              <span className="composer-hint">Enter to send · Shift+Enter for a new line</span>
            )}
          </span>
          {dictation.supported && (
            <button
              type="button"
              className="icon-button composer-tool composer-mic"
              aria-label={dictation.listening ? "Stop dictation" : "Dictate"}
              aria-pressed={dictation.listening}
              title={dictation.listening ? "Stop dictation" : "Dictate"}
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
            title={busy ? "Stop (Esc)" : "Send"}
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
