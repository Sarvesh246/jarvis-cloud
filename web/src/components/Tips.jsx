import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./tips.css";

/* Labels for the icon controls, in Vaelo's own type instead of the
   browser's. Any element with `data-tip` gets one. The first waits a beat,
   so passing over a control never flashes a label; while one is showing, or
   just after, the next opens at once and glides across from where the last
   one was, so reading along a row of tools feels like one movement. */
const DELAY = 450;
const WARM = 300;
const GAP = 8;
const EDGE = 8;

function target(node) {
  return node instanceof Element ? node.closest("[data-tip]") : null;
}

export function Tips() {
  const [tip, setTip] = useState(null);
  const box = useRef(null);
  const timer = useRef(0);
  const shownFor = useRef(null);
  const closedAt = useRef(0);

  useEffect(() => {
    const hover = matchMedia("(hover: hover)");

    function show(el) {
      clearTimeout(timer.current);
      const warm = !!shownFor.current || performance.now() - closedAt.current < WARM;
      const open = () => {
        if (!el.isConnected || !el.dataset.tip) return;
        shownFor.current = el;
        setTip((current) => ({ el, text: el.dataset.tip, glide: !!current }));
      };
      if (warm) open();
      else timer.current = setTimeout(open, DELAY);
    }

    function hide() {
      clearTimeout(timer.current);
      if (shownFor.current) closedAt.current = performance.now();
      shownFor.current = null;
      setTip(null);
    }

    function over(event) {
      if (event.pointerType !== "mouse" || !hover.matches) return;
      const el = target(event.target);
      if (el && el !== shownFor.current) show(el);
    }
    function out(event) {
      if (event.pointerType !== "mouse") return;
      const from = target(event.target);
      if (from && !from.contains(event.relatedTarget)) {
        const into = target(event.relatedTarget);
        if (into) show(into);
        else hide();
      }
    }
    function focus(event) {
      const el = target(event.target);
      if (el && event.target.matches(":focus-visible")) show(el);
    }
    function blur(event) {
      if (target(event.target)) hide();
    }
    function keys(event) {
      if (event.key === "Escape" && shownFor.current) hide();
    }

    addEventListener("pointerover", over);
    addEventListener("pointerout", out);
    addEventListener("focusin", focus);
    addEventListener("focusout", blur);
    addEventListener("pointerdown", hide, true);
    addEventListener("keydown", keys, true);
    addEventListener("scroll", hide, true);
    addEventListener("blur", hide);
    return () => {
      clearTimeout(timer.current);
      removeEventListener("pointerover", over);
      removeEventListener("pointerout", out);
      removeEventListener("focusin", focus);
      removeEventListener("focusout", blur);
      removeEventListener("pointerdown", hide, true);
      removeEventListener("keydown", keys, true);
      removeEventListener("scroll", hide, true);
      removeEventListener("blur", hide);
    };
  }, []);

  /* Above the control when there is room, below it otherwise, and never
     past the window's edge. */
  useLayoutEffect(() => {
    const node = box.current;
    if (!tip || !node) return;
    const r = tip.el.getBoundingClientRect();
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const below = r.top - GAP - h < EDGE;
    const x = Math.min(Math.max(r.left + r.width / 2 - w / 2, EDGE), innerWidth - w - EDGE);
    const y = below ? r.bottom + GAP : r.top - GAP - h;
    node.style.setProperty("--x", `${Math.round(x)}px`);
    node.style.setProperty("--y", `${Math.round(y)}px`);
    node.dataset.side = below ? "below" : "above";
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={box}
      className="tip"
      data-glide={tip.glide || undefined}
      aria-hidden="true"
    >
      {tip.text}
    </div>,
    document.body,
  );
}
