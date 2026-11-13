import React, { useEffect, useId, useRef, useState } from "react";

/* Confirm by holding the pointer, or by activating twice within three seconds. */
function holdTime() {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return 1100;
  const value = getComputedStyle(document.documentElement).getPropertyValue("--dur-hold");
  return parseFloat(value) || 1100;
}

export function HoldButton({ className = "", disabled, onConfirm, children, holding = "Keep holding…" }) {
  const [state, setState] = useState("rest");
  const [hint, setHint] = useState(false);
  const timer = useRef(0);
  const live = useRef(false);
  const began = useRef(0);
  const armed = useRef(false);
  const hintTimer = useRef(0);
  const hintId = useId();

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(hintTimer.current);
    },
    [],
  );

  /* If the answer didn't go through, the button is ready to be held again */
  useEffect(() => {
    if (disabled) {
      clearTimeout(timer.current); clearTimeout(hintTimer.current);
      live.current = false; armed.current = false; setHint(false); setState("rest");
    } else setState((current) => (current === "done" ? "rest" : current));
  }, [disabled]);

  function start() {
    if (disabled || state === "done" || live.current) return;
    live.current = true;
    began.current = performance.now();
    setState("holding");
    timer.current = setTimeout(() => {
      live.current = false;
      armed.current = false;
      clearTimeout(hintTimer.current);
      setHint(false);
      setState("done");
      onConfirm();
    }, holdTime());
  }

  function activate() {
    if (disabled || state === "done") return;
    if (armed.current) {
      armed.current = false;
      clearTimeout(hintTimer.current);
      setHint(false);
      setState("done");
      onConfirm();
      return;
    }
    armed.current = true;
    setHint(true);
    hintTimer.current = setTimeout(() => { armed.current = false; setHint(false); }, 3000);
  }

  function release(cancelled = false) {
    if (!live.current) return;
    live.current = false;
    clearTimeout(timer.current);
    setState("rest");
    if (!cancelled && performance.now() - began.current < 400) activate();
  }

  return (
    <button
      type="button"
      className={`hold ${className}`}
      data-state={state}
      disabled={disabled}
      aria-describedby={hintId}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        start();
      }}
      onPointerUp={() => release()}
      onPointerCancel={() => release(true)}
      onLostPointerCapture={() => release(true)}
      onClick={(event) => { if (event.detail === 0) activate(); }}
      onBlur={() => release(true)}
      onContextMenu={(event) => event.preventDefault()}
      style={{ "--hold": `${holdTime()}ms` }}
    >
      <span className="hold-fill" aria-hidden="true" />
      {/* Every wording is laid out at once, so the button never changes size */}
      <span className="hold-label">
        <span data-on={state !== "holding" && !hint ? true : undefined}>{children}</span>
        <span data-on={state === "holding" ? true : undefined}>{holding}</span>
        <span data-on={state !== "holding" && hint ? true : undefined}>Press again to confirm</span>
      </span>
      <span id={hintId} className="sr-only">
        Press and hold, or activate twice within three seconds, to confirm.
      </span>
    </button>
  );
}
