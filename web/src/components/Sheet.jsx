import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { containSheetFocus } from "../lib/sheet-focus.js";
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
  const content = useRef(null);
  const last = useRef(children);
  const close = useRef(onClose);
  const pull = useRef(null);
  close.current = onClose;
  if (open) last.current = children;

  useEffect(() => {
    if (open) {
      setMounted(true);
      /* One frame at rest below the screen, so the rise is a transition */
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setShown(true));
      });
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), SLIDE);
    return () => clearTimeout(timer);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !mounted || !panel.current) return;
    return containSheetFocus(panel.current, () => close.current());
  }, [open, mounted]);

  useEffect(() => {
    if (!open || !mounted || !content.current || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      if (!panel.current || !content.current) return;
      const body = content.current.parentElement;
      const style = getComputedStyle(body);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      panel.current.style.height = `${Math.ceil(content.current.getBoundingClientRect().height + padding + 28)}px`;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(content.current); measure();
    addEventListener('resize', measure);
    return () => { observer.disconnect(); removeEventListener('resize', measure); };
  }, [open, mounted]);

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
        <div className="sheet-body"><div ref={content} className="sheet-content">{last.current}</div></div>
      </div>
    </div>,
    document.body,
  );
}
