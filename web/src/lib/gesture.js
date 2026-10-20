/* One drag, read the same way from a finger or a mouse. Touch is read from
   touch events (they keep arriving while the browser scrolls, where pointer
   events would be cancelled), and a mouse or pen from pointer events, so the
   gestures can also be tried on a desktop.

   `claim` runs once the movement is clearly a drag of the kind wanted
   (`axis`: "x" or "y"); returning false hands the gesture back to scrolling.
   Anything handed back never calls `move` or `end`. */
export function dragProps({ axis = "x", slop = 6, start, claim, move, end, cancel }) {
  let g = null;
  const begin = (x, y, event) => {
    g = { x0: x, y0: y, claimed: false, dead: false, target: event.currentTarget };
    start?.(event, g);
  };
  const update = (x, y, event) => {
    if (!g || g.dead) return;
    const dx = x - g.x0;
    const dy = y - g.y0;
    if (!g.claimed) {
      if (Math.hypot(dx, dy) < slop) return;
      const wanted = axis === "x" ? Math.abs(dx) > Math.abs(dy) : Math.abs(dy) > Math.abs(dx);
      if (!wanted || claim?.(dx, dy, event) === false) {
        g.dead = true;
        return;
      }
      g.claimed = true;
      // Capturing a press before it becomes a drag retargets the eventual
      // click to this container, swallowing buttons and inputs inside it.
      if (event.pointerId !== undefined) {
        try {
          g.target.setPointerCapture(event.pointerId);
        } catch {
          /* capture is a convenience */
        }
      }
    }
    move?.(dx, dy, event);
  };
  const finish = (x, y, event, cancelled) => {
    const done = g;
    g = null;
    if (!done || done.dead) return;
    if (cancelled) cancel?.(event, done);
    else end?.(x - done.x0, y - done.y0, event, done);
  };
  return {
    onPointerDown(event) {
      if (event.pointerType === "touch" || event.button > 0) return;
      begin(event.clientX, event.clientY, event);
    },
    onPointerMove(event) {
      if (event.pointerType !== "touch") update(event.clientX, event.clientY, event);
    },
    onPointerUp(event) {
      if (event.pointerType !== "touch") finish(event.clientX, event.clientY, event, false);
    },
    onPointerCancel(event) {
      if (event.pointerType !== "touch") finish(event.clientX, event.clientY, event, true);
    },
    onTouchStart(event) {
      if (event.touches.length > 1) return;
      const t = event.touches[0];
      begin(t.clientX, t.clientY, event);
    },
    onTouchMove(event) {
      const t = event.touches[0];
      if (t) update(t.clientX, t.clientY, event);
    },
    onTouchEnd(event) {
      const t = event.changedTouches[0];
      finish(t.clientX, t.clientY, event, false);
    },
    onTouchCancel(event) {
      const t = event.changedTouches[0];
      finish(t?.clientX ?? 0, t?.clientY ?? 0, event, true);
    },
  };
}
