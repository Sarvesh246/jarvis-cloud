import React, { useId, useLayoutEffect, useRef, useState } from "react";

// Explain clipped columns only when the actual table is wider than its viewport.
export function TableScroll({ children, className = "table-scroll", wrapClassName = "", label = "Table, scrolls sideways" }) {
  const viewport = useRef(null);
  const hintId = useId();
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const element = viewport.current;
    const measure = () => setOverflow(element.scrollWidth > element.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const table = element.querySelector("table");
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, []);
  return <div className={`table-scroll-wrap ${wrapClassName}`}>
    <div ref={viewport} className={className} tabIndex={0} role="region" aria-label={label} aria-describedby={overflow ? hintId : undefined}>{children}</div>
    {overflow && <p id={hintId} className="table-scroll-note">Scroll sideways to see all columns.</p>}
  </div>;
}
