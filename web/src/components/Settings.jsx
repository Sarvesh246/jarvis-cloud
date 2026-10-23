import React, { useEffect, useRef, useState } from "react";
import { BellSimple, CaretLeft, MapPin, CaretRight, DeviceMobile, QrCode, Sparkle, SignOut, X } from "@phosphor-icons/react";
import { notifySupport } from "../lib/preferences.js";
import { forgetPlace, locate, locationSupport } from "../lib/location.js";
import { allowNotifications, DESKTOP, STORE_BUILD } from "../lib/desktop.js";
import { usePhone } from "../lib/use-phone.js";
import { useDrag } from "../lib/use-drag.js";
import { buzz } from "../lib/haptics.js";
import { DesktopUpdates } from "./DesktopUpdates.jsx";
import { InstallSteps } from "./Onboarding.jsx";
import { Sheet } from "./Sheet.jsx";
import { SettingsDesk } from "./SettingsDesk.jsx";
import {PhoneMemory} from './RecallSettings.jsx';
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

/* The location switch: the browser asks for permission when it is turned
   on, and a refusal is said plainly rather than left looking enabled. */
function useLocate(prefs, onChange) {
  const [problem, setProblem] = useState("");
  async function toggle(on) {
    setProblem("");
    if (!on) {
      forgetPlace();
      return onChange({ location: false });
    }
    try {
      await locate({ force: true });
      onChange({ location: true });
    } catch (error) {
      setProblem(
        error?.code === 1
          ? "Location is blocked for Vaelo. Allow it in your browser’s or system’s settings, then try again."
          : "Vaelo couldn’t work out where you are just now.",
      );
    }
  }
  return { problem, toggle, support: locationSupport() };
}

const LOCATION_NOTE =
  "Shares roughly where you are (about a kilometre) and your nearest city with your messages, so questions like the weather just work. Off by default.";

function PhoneSettings({ open, user, prefs, onChange, onClose, onTools, onWelcome, onSignOut, request }) {
  const page = useRef(null);
  const edge = useRef(false);
  const [install, setInstall] = useState(false);
  const notify = useNotify(prefs, onChange);
  const place = useLocate(prefs, onChange);
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
  const back = useDrag({
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

        {!guest && <PhoneMemory request={request}/>}
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
          {place.support && !guest && (
            <button
              type="button"
              className="sp-row"
              role="switch"
              aria-checked={!!prefs.location}
              onClick={() => {
                buzz();
                place.toggle(!prefs.location);
              }}
            >
              <MapPin size={22} aria-hidden="true" />
              <span className="sp-row-text">
                <span>Use my location</span>
                <span className="sp-row-note">{LOCATION_NOTE}</span>
              </span>
              <span className="sh-switch" data-on={prefs.location || undefined} aria-hidden="true" />
            </button>
          )}
          {place.problem && (
            <p className="sp-note" data-tone="problem" role="alert">
              {place.problem}
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

function WideSettings({ open, user, prefs, onChange, onClose, onTools, onWelcome, onSignOut, request, onRetention }) {
  const surface = useRef(null);
  useEffect(() => {
    if (!open) return;
    const title = document.title;
    document.title = "Settings · Vaelo";
    const siblings = [...(surface.current?.parentElement?.children || [])]
      .filter((node) => node !== surface.current);
    const previous = siblings.map((node) => node.inert);
    siblings.forEach((node) => { node.inert = true; });
    return () => {
      document.title = title;
      siblings.forEach((node, index) => { node.inert = previous[index]; });
    };
  }, [open]);
  const notify = useNotify(prefs, onChange);
  const place = useLocate(prefs, onChange);
  return (
    <div ref={surface} className="settings-surface">
    <SettingsDesk
      open={open}
      user={user}
      prefs={prefs}
      onChange={onChange}
      onClose={onClose}
      onTools={onTools}
      onWelcome={onWelcome}
      onSignOut={onSignOut}
      notify={notify}
      place={{ ...place, note: LOCATION_NOTE }}
      desktop={DESKTOP}
      store={STORE_BUILD}
      request={request}
      onRetention={onRetention}
    />
    </div>
  );
}
