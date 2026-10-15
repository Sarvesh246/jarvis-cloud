import React, { useEffect, useId, useRef, useState } from "react";

/* For the few answers that reach further than a click should: press and
   hold, and gilt ink fills the button from the left. Let go early and it
   drains away; nothing happens. Space or Enter held down does the same, so
   it never needs a pointer. */
function holdTime() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--dur-hold");
  return parseFloat(value) || 1100;
}

export function HoldButton({ className = "", disabled, onConfirm, children, holding = "Keep holding…" }) {
  const [state, setState] = useState("rest");
  const [hint, setHint] = useState(false);
  const timer = useRef(0);
  const live = useRef(false);
  const began = useRef(0);
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
    if (!disabled) setState((current) => (current === "done" ? "rest" : current));
  }, [disabled]);

  function start() {
    if (disabled || state !== "rest" || live.current) return;
    live.current = true;
    clearTimeout(hintTimer.current);
    setHint(false);
    began.current = performance.now();
    setState("holding");
    timer.current = setTimeout(() => {
      live.current = false;
      setState("done");
      onConfirm();
    }, holdTime());
  }

  function release() {
    if (!live.current) return;
    live.current = false;
    clearTimeout(timer.current);
    setState("rest");
    /* A quick tap gets told how this one works */
    if (performance.now() - began.current < 400) {
      setHint(true);
      hintTimer.current = setTimeout(() => setHint(false), 2600);
    }
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
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) {
          event.preventDefault();
          start();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") release();
      }}
      onBlur={release}
      onContextMenu={(event) => event.preventDefault()}
      style={{ "--hold": `${holdTime()}ms` }}
    >
      <span className="hold-fill" aria-hidden="true" />
      {/* Every wording is laid out at once, so the button never changes size */}
      <span className="hold-label">
        <span data-on={state !== "holding" && !hint ? true : undefined}>{children}</span>
        <span data-on={state === "holding" ? true : undefined}>{holding}</span>
        <span data-on={state !== "holding" && hint ? true : undefined}>Press and hold</span>
      </span>
      <span id={hintId} className="sr-only">
        Press and hold to confirm.
      </span>
    </button>
  );
}
