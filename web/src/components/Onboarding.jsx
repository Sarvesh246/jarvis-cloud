import React, { useState } from "react";
import { BellSimpleRinging, DeviceMobile, Export, PlusSquare } from "@phosphor-icons/react";
import { Mark } from "./Mark.jsx";
import { greeting } from "../lib/format.js";
import { notifySupport } from "../lib/preferences.js";
import { buzz } from "../lib/haptics.js";
import "./onboarding.css";

/* The first minute on a phone: sign in, keep Vaelo on the home screen, and
   say when a reply is ready. Sign-in is its own screen (SignIn.jsx, the same
   layout); the other two follow it, once. "Show the welcome again" in
   Settings replays all three.

   `vaelo-onboarding` is "pending" from the moment the sign-in screen is
   shown on a phone until the last step is finished, "replay" while it is
   shown again, and "done" afterwards. A person who was already signed in
   when this arrived never sees it unasked. */
const KEY = "vaelo-onboarding";

export function readOnboarding() {
  try {
    const value = localStorage.getItem(KEY);
    return value === "pending" || value === "replay" ? value : null;
  } catch {
    return null;
  }
}

export function writeOnboarding(value) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* without storage the welcome simply isn't remembered */
  }
}

const standalone = () =>
  typeof matchMedia !== "undefined" &&
  (matchMedia("(display-mode: standalone)").matches || navigator.standalone === true);

/* Only the steps that can still do something here: nothing to install once
   Vaelo is on the home screen, nothing to allow when notifications are off
   the table or already refused. */
export function onboardingSteps(mode) {
  if (!mode) return [];
  const steps = [];
  if (mode === "replay") steps.push("welcome");
  if (!standalone()) steps.push("install");
  const refused = typeof Notification !== "undefined" && Notification.permission === "denied";
  if (notifySupport() === "available" && !refused) steps.push("notify");
  return steps;
}

const IOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);

export function InstallSteps({ compact = false }) {
  const steps = IOS
    ? [
        ["i.", "Tap Share in the browser bar", Export],
        ["ii.", "Choose Add to Home Screen", PlusSquare],
        ["iii.", "Open Vaelo from its icon", DeviceMobile],
      ]
    : [
        ["i.", "Open the browser’s menu", Export],
        ["ii.", "Choose Install app or Add to Home screen", PlusSquare],
        ["iii.", "Open Vaelo from its icon", DeviceMobile],
      ];
  return (
    <ol className="sh-steps" data-compact={compact || undefined}>
      {steps.map(([n, text, Icon]) => (
        <li key={n} className="sh-step">
          <span className="sh-step-n">{n}</span>
          <span className="sh-step-t">{text}</span>
          <Icon size={22} aria-hidden="true" />
        </li>
      ))}
    </ol>
  );
}

/* The screen's frame: the step above, the buttons at its foot, then dots
   that say how far along it is. */
export function OnboardingFrame({ index, total, children, actions }) {
  return (
    <main className="onb">
      <div className="onb-body" key={index}>
        {children}
      </div>
      <div className="onb-actions">{actions}</div>
      <div className="onb-dots" role="img" aria-label={`Step ${index + 1} of ${total}`}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} data-on={i === index || undefined} />
        ))}
      </div>
    </main>
  );
}

/* Step one, in both its forms: signing in, or (replayed) just continuing */
export function WelcomeStep({ children }) {
  return (
    <>
      <Mark size={84} state="idle" />
      <h1 className="onb-greeting">
        {greeting()}.
        <br />
        <em>I’m Vaelo.</em>
      </h1>
      <p className="onb-line">Considered answers, with sources you can check. Your conversations stay private.</p>
      {children}
    </>
  );
}

function InstallStep() {
  return (
    <>
      <span className="onb-tile">
        <Mark size={52} state="idle" />
      </span>
      <h1 className="onb-title">Keep Vaelo on your home screen.</h1>
      <p className="onb-line onb-line-sm">It opens like an app, and conversations stay readable offline.</p>
      <InstallSteps />
    </>
  );
}

function NotifyStep() {
  return (
    <>
      <BellSimpleRinging size={64} weight="light" className="onb-bell" aria-hidden="true" />
      <h1 className="onb-title onb-title-bell">Know when a reply is ready.</h1>
      <p className="onb-line onb-line-sm">
        Replies keep going if you lock your phone or switch apps. Vaelo can tell you when one finishes.
      </p>
    </>
  );
}

/* The steps after signing in. `steps` says which are shown. */
export function Onboarding({ steps, replay, onAllow, onDone }) {
  const [at, setAt] = useState(0);
  const step = steps[at];
  /* Signing in was the first step of the three, unless this is a replay */
  const offset = replay ? 0 : 1;
  const total = steps.length + offset;
  const last = at >= steps.length - 1;
  const next = () => {
    buzz();
    if (last) onDone();
    else setAt(at + 1);
  };

  const pill = (label, onClick, extra) => (
    <button key={label} className="onb-primary" onClick={onClick}>
      {extra}
      {label}
    </button>
  );
  const quiet = (label, onClick) => (
    <button key={label} className="onb-quiet" onClick={onClick}>
      {label}
    </button>
  );

  if (step === "welcome")
    return (
      <OnboardingFrame index={at + offset} total={total} actions={[pill("Continue", next)]}>
        <WelcomeStep />
      </OnboardingFrame>
    );
  if (step === "install")
    return (
      <OnboardingFrame index={at + offset} total={total} actions={[pill("I’ve added it", next), quiet("Later", next)]}>
        <InstallStep />
      </OnboardingFrame>
    );
  return (
    <OnboardingFrame
      index={at + offset}
      total={total}
      actions={[
        pill("Allow notifications", async () => {
          await onAllow?.();
          next();
        }),
        quiet("Not now", next),
      ]}
    >
      <NotifyStep />
    </OnboardingFrame>
  );
}
