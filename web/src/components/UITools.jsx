import React, { useEffect, useRef, useState } from "react";
import { QRLink } from "./blocks/RichUI.jsx";
import { safeMedia } from "../lib/rich-ui.js";
import "./ui-tools.css";

export function UITools({ open, onClose }) {
  const dialog = useRef(null);
  const [url, setUrl] = useState("https://vaelo.chat/"),
    [chosen, setChosen] = useState("");
  const [tab, setTab] = useState("link");
  const [device, setDevice] = useState("desktop");
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    addEventListener("online", update);
    addEventListener("offline", update);
    return () => {
      removeEventListener("online", update);
      removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    const el = dialog.current;
    if (open && !el.open) {
      setUrl(`${location.origin}/`);
      setChosen("");
      el.showModal();
    } else if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="ui-tools-dialog"
      aria-labelledby="ui-tools-title"
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <header className="rich-toolbar">
        <h2 id="ui-tools-title">Tools and interface guide</h2>
        <button className="block-tool" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="rich-toolbar" role="group" aria-label="Tools section">
        {[
          ["link", "QR link"],
          ["guide", "Where to find things"],
        ].map(([id, label]) => (
          <button
            className="block-tool"
            aria-pressed={tab === id}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "link" ? (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (safeMedia(url) && url.length <= 1800) setChosen(url);
            }}
          >
            <label>
              Address to open on another device
              <input
                type="url"
                required
                maxLength={1800}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <button
              className="block-tool"
              disabled={!safeMedia(url) || url.length > 1800}
            >
              Create QR code
            </button>
          </form>
          {chosen && <QRLink url={chosen} />}
        </>
      ) : (
        <>
          <p className="ui-live-badge" role="status">
            {online ? "● Browser online" : "○ Browser offline"}
          </p>
          <dl className="ui-guide">
            <dt>Find anything</dt>
            <dd>
              Use Find in the conversation header or Ctrl/⌘ Shift P. Search
              conversations, saved outputs and actions.
            </dd>
            <dt>Pinned conversations</dt>
            <dd>
              Pin a conversation using its menu. Choose Reorder, then use Move
              up / Move down or drag the handle in the Pinned section. Order
              stays on this device.
            </dd>
            <dt>Files and Workroom</dt>
            <dd>
              Drop files over the conversation or a named Workroom file slot.
              Workroom shows file, check and result stages; field errors appear
              beside inputs.
            </dd>
            <dt>Documents</dt>
            <dd>
              Open a long answer, code or table using its expand button. Resize
              the side panel with its divider or arrow keys. Documents have a
              reading-position bar; saved revisions can be compared.
            </dd>
            <dt>Interactive answers</dt>
            <dd>
              Settings → Replies → Adaptive enables local charts, what-if
              controls, checklists, steps and rich blocks. Original content is
              always available. Minimal keeps text and tables.
            </dd>
            <dt>Optional media</dt>
            <dd>
              Image galleries include zoom and carousel controls. Image
              comparisons need two actual image URLs. A 3D model needs a public
              HTTPS .glb link and loads only when you choose it.
            </dd>
            <dt>Appearance and motion</dt>
            <dd>
              Settings controls paper, reading size and reduced motion. All
              interface tools work without additional model requests.
            </dd>
          </dl>
          <details className="work-demo-frame">
            <summary>A quick tour</summary>
            <div
              className="rich-toolbar"
              role="group"
              aria-label="Tour preview size"
            >
              <button
                className="block-tool"
                aria-pressed={device === "desktop"}
                onClick={() => setDevice("desktop")}
              >
                Desktop
              </button>
              <button
                className="block-tool"
                aria-pressed={device === "phone"}
                onClick={() => setDevice("phone")}
              >
                Phone
              </button>
            </div>
            <div className="ui-tour-device" data-device={device}>
              <div className="browser-chrome">● ● ● · Vaelo</div>
              <h3>Your work, in one place</h3>
              <div className="ui-tour-features">
                <article>
                  <strong>Chat</strong>
                  <p>Ask a question, attach a file, or dictate a message.</p>
                </article>
                <article>
                  <strong>Workroom</strong>
                  <p>Keep task instructions, files and checks together.</p>
                </article>
                <article>
                  <strong>Sources</strong>
                  <p>Inspect cited links and the evidence behind an answer.</p>
                </article>
              </div>
            </div>
          </details>
        </>
      )}
    </dialog>
  );
}

export function ActivityIsland({ title, children }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="activity-island">
      <button
        className="block-tool"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        {title} <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && <div>{children}</div>}
    </section>
  );
}

export function ReadingProgress({ target, content }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const article = target.current;
    let container = article?.parentElement;
    while (
      container &&
      !/(auto|scroll)/.test(getComputedStyle(container).overflowY)
    )
      container = container.parentElement;
    if (!article || !container) return;
    const update = () => {
      const total = container.scrollHeight - container.clientHeight;
      setProgress(
        total > 0
          ? Math.max(0, Math.min(100, (container.scrollTop / total) * 100))
          : 100,
      );
    };
    update();
    container.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(article);
    observer.observe(container);
    return () => {
      container.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [target, content]);
  return (
    <progress
      className="reading-progress"
      value={progress}
      max="100"
      aria-label="Document reading position"
    />
  );
}

export function useInterfaceKeys() {
  useEffect(() => {
    function keys(event) {
      const tab = event.target.closest?.("[role=tab]");
      if (
        !tab ||
        !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
      )
        return;
      const list = tab.closest("[role=tablist]");
      if (!list) return;
      const tabs = [...list.querySelectorAll("[role=tab]:not(:disabled)")];
      const index = tabs.indexOf(tab);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
              tabs.length;
      event.preventDefault();
      tabs[next]?.focus();
      tabs[next]?.click();
    }
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, []);
}
