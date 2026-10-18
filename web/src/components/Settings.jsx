import React, { useEffect, useRef, useState } from "react";
import { BellSimple, CaretLeft, CaretRight, DeviceMobile, QrCode, Sparkle, SignOut, X } from "@phosphor-icons/react";
import { notifySupport } from "../lib/preferences.js";
import { allowNotifications, DESKTOP, STORE_BUILD } from "../lib/desktop.js";
import { usePhone } from "../lib/use-phone.js";
import { dragProps } from "../lib/gesture.js";
import { buzz } from "../lib/haptics.js";
import { DesktopUpdates } from "./DesktopUpdates.jsx";
import { InstallSteps } from "./Onboarding.jsx";
import { Sheet } from "./Sheet.jsx";
import "./settings.css";
import "./settings-page.css";

/* How Vaelo looks and how much it shows. A short sheet, not a control
   panel: each choice is one row of options with a plain note under it.
   On a phone it is a page of its own, pushed in from the right. */

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
      { value: "adaptive", label: "Adaptive", note: "Charts, comparisons and checklists. Controls run locally." },
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

/* The notification switch, shared by both layouts: asking the system for
   permission, and saying plainly when it is refused. */
function useNotify(prefs, onChange) {
  const [problem, setProblem] = useState("");
  async function toggle(on) {
    setProblem("");
    if (!on) return onChange({ notify: false });
    try {
      if (await allowNotifications()) onChange({ notify: true });
      else setProblem(DESKTOP ? "Allow notifications for Vaelo in your system settings." : "Notifications are blocked for Vaelo. Allow them in your browser’s settings.");
    } catch {
      setProblem("This browser can’t show notifications.");
    }
  }
  return { problem, toggle, support: notifySupport() };
}

function PhoneSettings({ open, user, prefs, onChange, onClose, onTools, onWelcome, onSignOut }) {
  const page = useRef(null);
  const edge = useRef(false);
  const [install, setInstall] = useState(false);
  const notify = useNotify(prefs, onChange);
  const guest = !!user?.guest;
  const initial = (user?.name || "?").trim().charAt(0).toUpperCase();

  useEffect(() => {
    if (open) page.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function keys(event) {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector(".sheet-layer")) return;
      onClose();
    }
    addEventListener("keydown", keys);
    return () => removeEventListener("keydown", keys);
  }, [open, onClose]);

  /* Swiped in from the left edge: the page follows, and past 110px it goes */
  const clear = () => {
    page.current?.removeAttribute("data-dragging");
    page.current?.style.removeProperty("--drag");
  };
  const back = dragProps({
    axis: "x",
    start: (event) => {
      const x = event.touches ? event.touches[0].clientX : event.clientX;
      edge.current = x <= 28;
    },
    claim: (dx) => edge.current && dx > 0,
    move: (dx) => {
      page.current?.setAttribute("data-dragging", "");
      page.current?.style.setProperty("--drag", `${Math.max(0, dx)}px`);
    },
    end: (dx) => {
      clear();
      if (dx > 110) {
        buzz();
        onClose();
      }
    },
    cancel: clear,
  });

  const push = notify.support === "available" && prefs.notify;
  return (
    <div
      ref={page}
      className="settings-page"
      data-open={open}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      tabIndex={-1}
      inert={open ? undefined : true}
      {...back}
    >
      <header className="sp-head">
        <button className="sp-back" onClick={onClose}>
          <CaretLeft size={24} aria-hidden="true" />
          Back
        </button>
      </header>
      <div className="sp-body">
        <h1 id="settings-title">Settings</h1>

        <div className="sp-account">
          <span className="sp-avatar" aria-hidden="true">
            <span>
              <span>{initial}</span>
            </span>
          </span>
          <span className="sp-who">
            <span className="sp-name">{user?.name}</span>
            <span className="sp-sub">
              {guest ? "Guest · nothing is saved after you close this tab" : "Signed in with Google · synced across devices"}
            </span>
          </span>
        </div>

        {GROUPS.map((group) => {
          const chosen = group.options.find((option) => option.value === prefs[group.key]);
          return (
            <section key={group.key} className="sp-group">
              <h3 className="label">{group.label}</h3>
              <div className="sp-seg" role="radiogroup" aria-label={group.label}>
                {group.options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={prefs[group.key] === option.value}
                    onClick={() => onChange({ [group.key]: option.value })}
                  >
                    {option.value === "system" ? "System" : option.label}
                  </button>
                ))}
              </div>
              {chosen?.note && <p className="sp-note">{chosen.note}</p>}
            </section>
          );
        })}

        <div className="sp-rows">
          {notify.support === "available" ? (
            <button
              type="button"
              className="sp-row"
              role="switch"
              aria-checked={!!prefs.notify}
              onClick={() => {
                buzz();
                notify.toggle(!prefs.notify);
              }}
            >
              <BellSimple size={22} aria-hidden="true" />
              <span className="sp-row-text">
                <span>Tell me when a reply finishes</span>
                <span className="sp-row-note">While Vaelo is out of view</span>
              </span>
              <span className="sh-switch" data-on={push || undefined} aria-hidden="true" />
            </button>
          ) : (
            <div className="sp-row sp-row-still">
              <BellSimple size={22} aria-hidden="true" />
              <span className="sp-row-text">
                <span>Tell me when a reply finishes</span>
                <span className="sp-row-note">
                  {notify.support === "install"
                    ? "Add Vaelo to your Home Screen to be told when a reply is ready."
                    : "This browser can’t tell you when a reply is ready. The tab title still changes."}
                </span>
              </span>
            </div>
          )}
          {notify.problem && (
            <p className="sp-note" data-tone="problem" role="alert">
              {notify.problem}
            </p>
          )}
          <button type="button" className="sp-row" aria-haspopup="dialog" onClick={() => setInstall(true)}>
            <DeviceMobile size={22} aria-hidden="true" />
            <span className="sp-row-text">Add to home screen</span>
            <CaretRight size={16} aria-hidden="true" />
          </button>
          {onTools && (
            <button type="button" className="sp-row" onClick={onTools}>
              <QrCode size={22} aria-hidden="true" />
              <span className="sp-row-text">QR link and interface guide</span>
              <CaretRight size={16} aria-hidden="true" />
            </button>
          )}
          <button type="button" className="sp-row" onClick={onWelcome}>
            <Sparkle size={22} aria-hidden="true" />
            <span className="sp-row-text">Show the welcome again</span>
            <CaretRight size={16} aria-hidden="true" />
          </button>
          <button type="button" className="sp-row" data-tone="clay" onClick={onSignOut}>
            <SignOut size={22} aria-hidden="true" />
            <span className="sp-row-text">{guest ? "Leave guest mode" : "Sign out"}</span>
          </button>
        </div>

        <p className="sp-foot">Kept on this device. Private conversations and saved work sync with your account.</p>
      </div>

      <Sheet open={install} onClose={() => setInstall(false)} label="Add to home screen">
        <h2 className="sh-title">Keep Vaelo on your home screen</h2>
        <p className="sh-note">It opens without browser bars, and saved conversations stay readable offline.</p>
        <InstallSteps />
      </Sheet>
    </div>
  );
}

export function Settings(props) {
  const phone = usePhone();
  return phone ? <PhoneSettings {...props} /> : <WideSettings {...props} />;
}

function WideSettings({ open, prefs, onChange, onClose, onTools }) {
  const dialog = useRef(null);
  const { problem, toggle: toggleNotify, support } = useNotify(prefs, onChange);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

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

        {DESKTOP && <DesktopUpdates store={STORE_BUILD} />}
        {onTools && <button className="text-button" onClick={onTools}>QR link and interface guide</button>}
        <p className="settings-foot">Kept on this device only.</p>
      </div>
    </dialog>
  );
}
