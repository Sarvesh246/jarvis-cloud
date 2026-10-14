import React, { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { notifySupport } from "../lib/preferences.js";
import "./settings.css";

/* How Vaelo looks and how much it shows. A short sheet, not a control
   panel: each choice is one row of options with a plain note under it. */

const GROUPS = [
  {
    key: "theme",
    label: "Paper",
    options: [
      { value: "system", label: "Match system" },
      { value: "light", label: "Parchment" },
      { value: "dark", label: "Lamplight" },
    ],
  },
  {
    key: "text",
    label: "Reading size",
    options: [
      { value: "standard", label: "Standard" },
      { value: "large", label: "Larger" },
    ],
  },
  {
    key: "presentation",
    label: "Replies",
    options: [
      { value: "adaptive", label: "Adaptive", note: "Figures, timelines and charts when they help." },
      { value: "minimal", label: "Minimal", note: "Plain text and tables, nothing more." },
    ],
  },
  {
    key: "motion",
    label: "Motion",
    options: [
      { value: "system", label: "Match system" },
      { value: "reduce", label: "Reduced", note: "Vaelo’s face and status hold still; their words stay." },
    ],
  },
];

export function Settings({ open, prefs, onChange, onClose }) {
  const dialog = useRef(null);
  const [problem, setProblem] = useState("");
  const support = notifySupport();

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  async function toggleNotify(on) {
    setProblem("");
    if (!on) return onChange({ notify: false });
    try {
      const answer =
        Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (answer === "granted") onChange({ notify: true });
      else setProblem("Notifications are blocked for Vaelo. Allow them in your browser’s settings.");
    } catch {
      setProblem("This browser can’t show notifications.");
    }
  }

  return (
    <dialog
      ref={dialog}
      className="settings"
      aria-labelledby="settings-title"
      onClose={onClose}
      onClick={(event) => {
        /* A tap on the dimmed backdrop closes the sheet */
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="settings-body">
        <header className="settings-head">
          <h2 id="settings-title">Settings</h2>
          <button className="icon-button" aria-label="Close settings" onClick={onClose}>
            <X size={19} />
          </button>
        </header>

        {GROUPS.map((group) => {
          const chosen = group.options.find((option) => option.value === prefs[group.key]);
          return (
            <fieldset key={group.key} className="settings-group">
              <legend className="label">{group.label}</legend>
              <div className="settings-options">
                {group.options.map((option) => (
                  <label key={option.value} className="settings-option">
                    <input
                      type="radio"
                      name={group.key}
                      value={option.value}
                      checked={prefs[group.key] === option.value}
                      onChange={() => onChange({ [group.key]: option.value })}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
              {chosen?.note && <p className="settings-note">{chosen.note}</p>}
            </fieldset>
          );
        })}

        <fieldset className="settings-group">
          <legend className="label">While you’re away</legend>
          {support === "available" ? (
            <label className="settings-switch">
              <span>
                Tell me when a reply is ready
                <span className="settings-note">
                  Only when Vaelo finishes while this window is in the background.
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={prefs.notify}
                onChange={(event) => toggleNotify(event.target.checked)}
              />
            </label>
          ) : (
            <p className="settings-note">
              {support === "install"
                ? "Add Vaelo to your Home Screen (Share → Add to Home Screen) to be told when a reply is ready."
                : "This browser can’t tell you when a reply is ready. The tab title still changes."}
            </p>
          )}
          {problem && (
            <p className="settings-note" data-tone="problem" role="alert">
              {problem}
            </p>
          )}
        </fieldset>

        <p className="settings-foot">Kept on this device only.</p>
      </div>
    </dialog>
  );
}
