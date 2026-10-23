import React, { useEffect, useRef, useState } from "react";
import { PHONE } from "../lib/use-phone.js";
import { buzz } from "../lib/haptics.js";
import "./toast.css";

/* A plain notice is read at a glance and goes; one with an action (Undo)
   waits a little longer, and resting a pointer on it holds it. */
const NOTICE_LIFE = 2500;
const ACTION_LIFE = 4000;
const PHONE_ACTION_LIFE = 3500;
const AWAY = 40;

/* A toast keeps its own time. A gilt line along its foot shortens as that
   time runs out, so an Undo says how long it will wait. Resting a pointer
   on it, focusing it or holding it pauses the time.

   It can be dragged down and away. The drag writes straight to the element
   (no re-render per move) so it tracks the finger frame for frame: down
   follows 1:1, up pulls against a rubber band. On release the finger's
   speed is projected forward, so a flick goes however short it was, a slow
   drag goes only past a third of the toast, and anything less springs back.
   Whichever way it leaves, it slides the rest of the way off the screen at
   the speed the finger left it. */
const FLICK = 0.35; /* px per ms */
const PROJECT = 160; /* ms of travel the release speed is worth */
const SEND = 0.4; /* share of its own height a slow drag must pass */
const RUBBER = 22; /* px the toast can be pulled upward, at most */

const SPRING = "cubic-bezier(0.32, 1.35, 0.5, 1)";
const SWEEP = "cubic-bezier(0.3, 0.5, 0.6, 1)";
const SINK = "cubic-bezier(0.55, 0, 0.85, 0.45)";

function Slip({ toast, onDismiss, gone = false }) {
  const life = toast.duration || (!toast.action ? NOTICE_LIFE : matchMedia(PHONE).matches ? PHONE_ACTION_LIFE : ACTION_LIFE);
  const [held, setHeld] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const el = useRef(null);
  const left = useRef(life);
  const since = useRef(0);
  const drag = useRef(null);
  const exit = useRef(0);
  const done = useRef(onDismiss);
  done.current = onDismiss;
  const paused = held > 0;
  const hold = (on) => setHeld((n) => Math.max(0, n + (on ? 1 : -1)));

  useEffect(() => () => clearTimeout(exit.current), []);

  const shift = (y, ms = 0, curve = SPRING) => {
    const node = el.current;
    if (!node) return;
    node.style.transition = ms ? `transform ${ms}ms ${curve}` : "none";
    node.style.transform = `translate3d(0, ${y}px, 0)`;
  };

  /* Slide the rest of the way off the bottom of the screen. `v` is the speed
     the finger left it at (px/ms); 0 means no finger, just time. */
  function away(from = 0, v = 0) {
    const node = el.current;
    if (!node || exit.current) return;
    setLeaving(true);
    const base = node.getBoundingClientRect().top - from;
    const target = window.innerHeight - base + 24;
    const ms = v ? Math.min(340, Math.max(160, (target - from) / v)) : 340;
    node.style.animation = "none";
    shift(from);
    void node.offsetHeight;
    shift(target, ms, v ? SWEEP : SINK);
    exit.current = setTimeout(() => done.current(), ms + 20);
  }

  useEffect(() => {
    if (gone) away();
  }, [gone]);

  useEffect(() => {
    if (paused || leaving) return;
    since.current = performance.now();
    const timer = setTimeout(() => away(), left.current);
    return () => {
      clearTimeout(timer);
      left.current -= performance.now() - since.current;
    };
  }, [paused, leaving]);

  const release = (event, cancelled) => {
    const g = drag.current;
    if (!g) return;
    drag.current = null;
    hold(false);
    el.current.removeAttribute("data-dragging");
    const y = g.y;
    const v = g.v;
    const height = el.current.offsetHeight;
    const sends = !cancelled && (y > 0 ? y + v * PROJECT > height * SEND || v > FLICK : false);
    if (sends) {
      buzz();
      away(y, Math.max(v, 0.9));
    } else {
      shift(0, 420, SPRING);
    }
  };

  return (
    <div
      ref={el}
      className="toast"
      data-paused={paused || undefined}
      data-leaving={leaving || undefined}
      style={{ "--life": `${life}ms` }}
      onPointerEnter={(event) => event.pointerType === "mouse" && hold(true)}
      onPointerLeave={(event) => event.pointerType === "mouse" && hold(false)}
      onFocus={() => hold(true)}
      onBlur={() => hold(false)}
      onPointerDown={(event) => {
        if (leaving || drag.current || event.button > 0 || event.target.closest("button")) return;
        /* Catching it mid-spring: pick up from where it visibly is */
        const node = event.currentTarget;
        const now = new DOMMatrixReadOnly(getComputedStyle(node).transform).m42 || 0;
        node.style.animation = "none";
        node.setAttribute("data-dragging", "");
        drag.current = { y0: event.clientY - now, y: now, v: 0, lastY: event.clientY, lastT: performance.now() };
        shift(now);
        node.setPointerCapture(event.pointerId);
        hold(true);
      }}
      onPointerMove={(event) => {
        const g = drag.current;
        if (!g) return;
        const raw = event.clientY - g.y0;
        g.y = raw >= 0 ? raw : -Math.min(RUBBER, Math.sqrt(-raw) * 2.5);
        shift(g.y);
        /* speed, smoothed over recent moves so one jittery sample can't decide it */
        const t = performance.now();
        const dt = t - g.lastT;
        if (dt > 0) {
          g.v = g.v * 0.6 + ((event.clientY - g.lastY) / dt) * 0.4;
          g.lastY = event.clientY;
          g.lastT = t;
        }
      }}
      onPointerUp={(event) => release(event, false)}
      onPointerCancel={(event) => release(event, true)}
    >
      <span>{toast.text}</span>
      {toast.action && (
        <button
          className="text-button"
          onClick={() => {
            toast.onAction?.();
            away();
          }}
        >
          {toast.action}
        </button>
      )}
      <span className="toast-fuse" aria-hidden="true" />
    </div>
  );
}

export function Toast({ toast, toasts, onDismiss }) {
  const region = useRef(null);
  /* Follow the middle of the chat area as the rail or workspace opens and
     closes. The observer fires on every frame of those transitions. */
  useEffect(() => {
    const stage = document.querySelector(".stage");
    const el = region.current;
    if (!stage || !el) return;
    const place = () => {
      const { left, width } = stage.getBoundingClientRect();
      el.style.setProperty("--toast-x", `${left + width / 2}px`);
    };
    place();
    const watch = new ResizeObserver(place);
    watch.observe(stage);
    addEventListener("resize", place);
    return () => {
      watch.disconnect();
      removeEventListener("resize", place);
    };
  }, []);
  /* A toast replaced by a newer one slides away rather than blinking out.
     Worked out during render so there is no frame without it. */
  const list = toast ? [toast] : toasts || [];
  const key = list.map((item) => item.id).join();
  const [ghosts, setGhosts] = useState([]);
  const [last, setLast] = useState({ key, list });
  if (last.key !== key) {
    const lost = last.list.filter((item) => !list.some((now) => now.id === item.id));
    setLast({ key, list });
    if (lost.length && list.length) setGhosts((current) => [...current, ...lost]);
  }
  useEffect(() => {
    if (!ghosts.length) return;
    const timer = setTimeout(() => setGhosts([]), 420);
    return () => clearTimeout(timer);
  }, [ghosts]);
  return (
    <div className="toast-region" role="status" aria-live="polite" ref={region}>
      {ghosts.map(item => <Slip key={`gone-${item.id}`} toast={item} gone onDismiss={() => {}} />)}
      {list.map(item => <Slip key={item.id} toast={item} onDismiss={() => onDismiss(item.id)} />)}
    </div>
  );
}

export function Notice({ tone = "clay", role = "alert", children, action, onAction, disabled }) {
  return (
    <div className="notice" data-tone={tone} role={role}>
      <span>{children}</span>
      {action && (
        <button className="text-button" onClick={onAction} disabled={disabled}>
          {action}
        </button>
      )}
    </div>
  );
}
