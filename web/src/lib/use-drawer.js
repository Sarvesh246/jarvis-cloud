import { useEffect, useRef } from "react";
import { buzz } from "./haptics.js";

/* The conversations drawer on a phone pushes the chat aside and leaves a
   56px strip of it showing. One number, p (0 closed, 1 open), drives the
   whole picture through CSS, so the finger can scrub it directly.

   Opening: a drag that starts within 22px of the left edge and moves more
   than a few pixels sideways. Closing: a tap or a drag left on the chat
   that is left showing. Let go past 30% to open, or before 70% to close;
   anything else springs back. While the finger is down the page is told
   (data-dragging) so nothing eases behind it.

   The drag writes straight to the shell's style rather than through React
   state, so scrubbing never re-renders the app. */
const STRIP = 56;
const EDGE = 22;
const SLOP = 5;
const OPENS_AT = 0.3;
const STAYS_AT = 0.7;
const SETTLE = 620;

const clamp = (n) => Math.max(0, Math.min(1, n));

/* `shell` is the shell element itself (held in state, since the shell only
   exists once someone is signed in), or null while there is none. */
export function useDrawer({ phone, open, setOpen, shell }) {
  // Revoke old events as soon as their state/shell changes, even before cleanup.
  const latest = useRef({ open, phone, shell, generation: 0 });
  const previous = latest.current;
  latest.current = { open, setOpen, phone, shell, generation: previous.generation +
    Number(previous.open !== open || previous.phone !== phone || previous.shell !== shell) };
  const cancelActive = useRef(null);

  useEffect(() => { cancelActive.current?.(); }, [open]);

  useEffect(() => {
    const el = shell;
    if (!phone || !el) return;
    let g = null;
    let settle = 0;
    let unswallow = 0;
    let swallow = false;
    let release = 0;
    let settledOpen = null;

    function clearRelease() {
      // A queued callback must not clear a newer gesture's preview or suppression.
      release++;
      clearTimeout(settle);
      clearTimeout(unswallow);
      swallow = false;
      settledOpen = null;
    }

    function cancel() {
      g = null;
      clearRelease();
      delete el.dataset.dragging;
      el.style.removeProperty("--p");
    }
    const cancelGesture = () => {
      if (g || settledOpen !== null && settledOpen !== latest.current.open) cancel();
    };
    cancelActive.current = cancelGesture;
    function active() {
      if (g && g.generation !== latest.current.generation) cancel();
      return Boolean(g);
    }

    /* The drawer is as wide as its own panel, whatever transform it is in */
    const width = () => Math.max(1, el.querySelector(":scope > .rail")?.offsetWidth || el.clientWidth - STRIP);
    const covered = (target) =>
      !!target.closest?.("dialog, .sheet-layer, .workspace, .settings-page, .quote-ask, input, textarea");

    function begin(x, y, target, kind, id) {
      if (active() || !latest.current.phone || latest.current.shell !== el) return;
      const isOpen = latest.current.open;
      const onCover = !!target.closest?.(".drawer-cover");
      const fromEdge = x - el.getBoundingClientRect().left <= EDGE;
      if (isOpen ? !onCover : !fromEdge || covered(target)) return;
      clearRelease();
      el.style.removeProperty("--p");
      g = { kind, id, generation: latest.current.generation,
        mode: isOpen ? "close" : "open", x0: x, y0: y, moved: false, p: isOpen ? 1 : 0 };
    }

    function move(x, y, event) {
      if (!g) return;
      const dx = x - g.x0;
      const dy = y - g.y0;
      if (!g.moved) {
        if (Math.hypot(dx, dy) < SLOP) return;
        /* Mostly vertical: that is scrolling, not the drawer */
        if (Math.abs(dy) > Math.abs(dx)) {
          g = null;
          return;
        }
        g.moved = true;
        el.dataset.dragging = "";
      }
      g.p = clamp(g.mode === "open" ? dx / width() : 1 + dx / width());
      el.style.setProperty("--p", g.p.toFixed(4));
      if (event.cancelable && event.type === "touchmove") event.preventDefault();
    }

    function end() {
      const done = g;
      g = null;
      if (!done?.moved) return;
      const next = done.mode === "open" ? done.p > OPENS_AT : done.p > STAYS_AT;
      delete el.dataset.dragging;
      /* Hold the dragged-to value until React has the new state, so the
         release glides to rest instead of flashing back first */
      el.style.setProperty("--p", next ? "1" : "0");
      if (next !== latest.current.open) {
        buzz();
        latest.current.setOpen(next);
      }
      swallow = true;
      settledOpen = next;
      const ownedRelease = ++release;
      unswallow = setTimeout(() => { if (release === ownedRelease) swallow = false; }, 350);
      settle = setTimeout(() => {
        if (release !== ownedRelease) return;
        settledOpen = null;
        el.style.removeProperty("--p");
      }, SETTLE);
    }

    const touchStart = (event) => {
      if (event.touches.length > 1) return;
      const t = event.touches[0];
      begin(t.clientX, t.clientY, event.target, "touch", t.identifier);
    };
    const touchMove = (event) => {
      if (!active() || g.kind !== "touch") return;
      const t = Array.from(event.touches).find(t => t.identifier === g.id);
      if (t) move(t.clientX, t.clientY, event);
    };
    const ownsTouch = event => active() && g.kind === "touch" &&
      Array.from(event.changedTouches).some(t => t.identifier === g.id);
    const touchEnd = event => { if (ownsTouch(event)) end(); };
    const touchCancel = event => { if (ownsTouch(event)) cancel(); };
    const mouseDown = (event) => {
      if (event.pointerType === "touch" || event.button > 0) return;
      begin(event.clientX, event.clientY, event.target, "pointer", event.pointerId);
    };
    const ownsPointer = event => active() && g.kind === "pointer" && g.id === event.pointerId && event.pointerType !== "touch";
    const mouseMove = (event) => {
      if (ownsPointer(event)) move(event.clientX, event.clientY, event);
    };
    const mouseUp = (event) => {
      if (ownsPointer(event)) end();
    };
    const pointerCancel = event => { if (ownsPointer(event)) cancel(); };
    /* A drag that ends on the cover must not also count as a tap on it */
    const click = (event) => {
      if (swallow && event.target.closest?.(".drawer-cover")) {
        event.stopPropagation();
        event.preventDefault();
      }
    };

    el.addEventListener("touchstart", touchStart, { passive: true });
    el.addEventListener("touchmove", touchMove, { passive: false });
    el.addEventListener("touchend", touchEnd);
    el.addEventListener("touchcancel", touchCancel);
    el.addEventListener("pointerdown", mouseDown);
    addEventListener("pointermove", mouseMove);
    addEventListener("pointerup", mouseUp);
    addEventListener("pointercancel", pointerCancel);
    addEventListener("blur", cancel);
    el.addEventListener("click", click, true);
    return () => {
      cancel();
      if (cancelActive.current === cancelGesture) cancelActive.current = null;
      el.removeEventListener("touchstart", touchStart);
      el.removeEventListener("touchmove", touchMove);
      el.removeEventListener("touchend", touchEnd);
      el.removeEventListener("touchcancel", touchCancel);
      el.removeEventListener("pointerdown", mouseDown);
      removeEventListener("pointermove", mouseMove);
      removeEventListener("pointerup", mouseUp);
      removeEventListener("pointercancel", pointerCancel);
      removeEventListener("blur", cancel);
      el.removeEventListener("click", click, true);
    };
  }, [phone, shell]);
}
