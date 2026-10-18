import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./sheet.css";

/* The bottom sheet every phone choice rises in: tools, sources, a message's
   actions, install steps. Scrim behind it, a handle to drag it away, and
   focus that goes in on opening and back out on closing.

   It stays mounted just long enough to slide away, and keeps showing what it
   last held while it does. */
const CLOSE_PULL = 100;
const SLIDE = 340;

export function Sheet({ open, onClose, label, tall = false, children }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const panel = useRef(null);
  const last = useRef(children);
  const returnTo = useRef(null);
  const close = useRef(onClose);
  const pull = useRef(null);
  close.current = onClose;
  if (open) last.current = children;

  useEffect(() => {
    if (open) {
      returnTo.current = document.activeElement;
      setMounted(true);
      /* One frame at rest below the screen, so the rise is a transition */
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), SLIDE);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (shown) panel.current?.focus({ preventScroll: true });
    else if (mounted && !open) {
      const back = returnTo.current;
      if (back && document.contains(back) && (document.activeElement === document.body || panel.current?.contains(document.activeElement)))
        back.focus?.({ preventScroll: true });
    }
  }, [shown, mounted, open]);

  useEffect(() => {
    if (!open) return;
    function keys(event) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.stopPropagation();
      close.current();
    }
    addEventListener("keydown", keys, true);
    return () => removeEventListener("keydown", keys, true);
  }, [open]);

  const grip = {
    onPointerDown(event) {
      pull.current = { y: event.clientY, at: performance.now(), dy: 0 };
      panel.current?.setAttribute("data-dragging", "");
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* capture is a convenience */
      }
    },
    onPointerMove(event) {
      const p = pull.current;
      if (!p) return;
      p.dy = Math.max(0, event.clientY - p.y);
      panel.current?.style.setProperty("--pull", `${p.dy}px`);
    },
    onPointerUp() {
      const p = pull.current;
      pull.current = null;
      panel.current?.removeAttribute("data-dragging");
      panel.current?.style.removeProperty("--pull");
      if (p && p.dy > CLOSE_PULL) close.current();
    },
    onPointerCancel() {
      pull.current = null;
      panel.current?.removeAttribute("data-dragging");
      panel.current?.style.removeProperty("--pull");
    },
  };

  const dismiss = useCallback(() => close.current(), []);
  if (!mounted) return null;
  return createPortal(
    <div className="sheet-layer" data-shown={shown || undefined}>
      <div className="sheet-scrim" onClick={dismiss} />
      <div
        ref={panel}
        className="sheet"
        data-tall={tall || undefined}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        inert={open ? undefined : true}
      >
        <div className="sheet-handle" {...grip}>
          <span aria-hidden="true" />
        </div>
        <div className="sheet-body">{last.current}</div>
      </div>
    </div>,
    document.body,
  );
}
