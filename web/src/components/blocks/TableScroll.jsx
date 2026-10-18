import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { usePhone } from "../../lib/use-phone.js";

// Explain clipped columns only when the actual table is wider than its viewport.
export function TableScroll({ children, className = "table-scroll", wrapClassName = "", label = "Table, scrolls sideways", resizable = false }) {
  const viewport = useRef(null);
  const phone = usePhone();
  const baseline = useRef(0), gesture = useRef(null), frame = useRef(null);
  const [height, setHeight] = useState(null), [dragging, setDragging] = useState(false);
  const requestedHeight = useRef(height);
  requestedHeight.current = height;
  const [bounds, setBounds] = useState({ min: 0, max: 0 });
  const hintId = useId();
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const element = viewport.current;
    const measure = () => {
      setOverflow(element.scrollWidth > element.clientWidth + 1);
      if (!resizable || phone) return;
      if (requestedHeight.current === null) baseline.current = element.clientHeight;
      const max = element.querySelector('table')?.offsetHeight || element.scrollHeight;
      const min = Math.min(baseline.current, max);
      setBounds(previous => previous.min === min && previous.max === max ? previous : { min, max });
      setHeight(previous => previous === null ? null : Math.max(min, Math.min(max, previous)));
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const table = element.querySelector("table");
    if (table) observer.observe(table);
    return () => { observer.disconnect(); cancelAnimationFrame(frame.current); };
  }, [resizable, phone]);
  const resize = value => setHeight(Math.max(bounds.min, Math.min(bounds.max, value)));
  const expanded = height !== null && height > bounds.min + 1;
  return <div className={`table-scroll-wrap ${wrapClassName}`} data-resizing={dragging || undefined}>
    <div ref={viewport} className={className} style={!phone && resizable && height !== null ? { height, maxHeight: 'none' } : undefined} tabIndex={0} role="region" aria-label={label} aria-describedby={overflow ? hintId : undefined}>{children}</div>
    {!phone && resizable && bounds.max > bounds.min + 1 && <div className="table-resize-bar">
      <div role="separator" tabIndex={0} aria-label="Resize table height" aria-orientation="horizontal" aria-valuemin={Math.round(bounds.min)} aria-valuemax={Math.round(bounds.max)} aria-valuenow={Math.round(height ?? bounds.min)}
        className="table-resize-handle" title="Drag to resize. Arrow keys adjust height; Home resets; End shows all rows."
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); gesture.current = { y: event.clientY, height: viewport.current.clientHeight }; setDragging(true); }}
        onPointerMove={event => { if (!gesture.current) return; const next = gesture.current.height + event.clientY - gesture.current.y; cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => resize(next)); }}
        onLostPointerCapture={() => { gesture.current = null; setDragging(false); }}
        onPointerUp={event => { if (gesture.current) { cancelAnimationFrame(frame.current); resize(gesture.current.height + event.clientY - gesture.current.y); } if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onKeyDown={event => { if (!['ArrowUp','ArrowDown','Home','End'].includes(event.key)) return; event.preventDefault(); resize(event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max : (height ?? bounds.min) + (event.key === 'ArrowDown' ? 48 : -48)); }}>
        <span className="table-resize-grip" aria-hidden="true" /><span>Drag to show more rows</span>
      </div>
      {expanded && <button className="block-tool" onClick={() => setHeight(null)}>Reset height</button>}
    </div>}
    {overflow && <p id={hintId} className="table-scroll-note">Scroll sideways to see all columns.</p>}
  </div>;
}
