import React, { useEffect, useRef, useState } from "react";
import "./toast.css";

const LIFE = 6500;
const AWAY = 40;

/* A toast keeps its own time. A gilt line along its foot shortens as that
   time runs out, so an Undo says how long it will wait. Resting a pointer
   on it, focusing it or holding it pauses the time; swiping it down puts
   it away early. */
function Slip({ toast, onDismiss }) {
  const life = toast.duration || LIFE;
  const [held, setHeld] = useState(0);
  const [pull, setPull] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const left = useRef(life);
  const since = useRef(0);
  const drag = useRef(null);
  const done = useRef(onDismiss);
  done.current = onDismiss;
  const paused = held > 0;

  useEffect(() => {
    if (paused || leaving) return;
    since.current = performance.now();
    const timer = setTimeout(() => done.current(), left.current);
    return () => {
      clearTimeout(timer);
      left.current -= performance.now() - since.current;
    };
  }, [paused, leaving]);

  function away() {
    setLeaving(true);
    setTimeout(() => done.current(), 340);
  }

  const hold = (on) => setHeld((n) => Math.max(0, n + (on ? 1 : -1)));

  return (
    <div
      className="toast"
      data-paused={paused || undefined}
      data-dragging={drag.current ? true : undefined}
      data-leaving={leaving || undefined}
      style={{ "--life": `${life}ms`, "--pull": `${pull}px`, "--fade": 1 - Math.min(pull, 100) / 140 }}
      onPointerEnter={(event) => event.pointerType === "mouse" && hold(true)}
      onPointerLeave={(event) => event.pointerType === "mouse" && hold(false)}
      onFocus={() => hold(true)}
      onBlur={() => hold(false)}
      onPointerDown={(event) => {
        if (event.target.closest("button")) return;
        drag.current = { y: event.clientY, at: performance.now() };
        event.currentTarget.setPointerCapture(event.pointerId);
        hold(true);
      }}
      onPointerMove={(event) => {
        if (drag.current) setPull(Math.max(0, event.clientY - drag.current.y));
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        const distance = Math.max(0, event.clientY - drag.current.y);
        const speed = distance / Math.max(1, performance.now() - drag.current.at);
        drag.current = null;
        hold(false);
        if (distance > AWAY || speed > 0.5) away();
        else setPull(0);
      }}
      onPointerCancel={() => {
        drag.current = null;
        hold(false);
        setPull(0);
      }}
    >
      <span>{toast.text}</span>
      {toast.action && (
        <button
          className="text-button"
          onClick={() => {
            toast.onAction?.();
            onDismiss();
          }}
        >
          {toast.action}
        </button>
      )}
      <span className="toast-fuse" aria-hidden="true" />
    </div>
  );
}

export function Toast({ toast, onDismiss }) {
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && <Slip key={toast.id} toast={toast} onDismiss={onDismiss} />}
    </div>
  );
}

export function Notice({ tone = "clay", children, action, onAction, disabled }) {
  return (
    <div className="notice" data-tone={tone} role="alert">
      <span>{children}</span>
      {action && (
        <button className="text-button" onClick={onAction} disabled={disabled}>
          {action}
        </button>
      )}
    </div>
  );
}
