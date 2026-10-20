import React from "react";
import "./mark.css";
import { markGeometry as geometry } from "./markGeometry.js";

/* Vaelo's mark: a Didone V. One weighted stroke and one hairline, the
   contrast that gives a high-contrast serif its composure, with fine
   bracket serifs at the top. It is also Vaelo's face: state is a data
   attribute so CSS owns all motion. */

/* With `inked`, the mark is set down the way a pen would: its outline is
   drawn first, then the ink floods in. Used once, where Vaelo first greets
   you; everywhere else the mark simply is. */
export function Mark({ state = "idle", size = 64, className = "", inked = false }) {
  const g = geometry(size);
  return (
    <span
      className={`mark ${className}`}
      data-state={state}
      data-inked={inked || undefined}
      style={{ "--mark-size": `${size}px` }}
      aria-hidden="true"
    >
      <span className="mark-glow" />
      <svg viewBox="0 0 64 64" className="mark-v">
        <path className="mark-heavy" d={g.heavyPath} pathLength="1" />
        <path className="mark-hair" d={g.hairPath} pathLength="1" />
        {g.serifs.map(([x, y, w, h], i) => (
          <rect key={i} className="mark-serif" x={x} y={y} width={w} height={h} pathLength="1" />
        ))}
        <line
          className="mark-trace"
          x1={g.hairLine[0]}
          y1={g.hairLine[1]}
          x2={g.hairLine[2]}
          y2={g.hairLine[3]}
          pathLength="100"
        />
      </svg>
    </span>
  );
}

export function Wordmark({ size = 22 }) {
  return (
    <span className="wordmark" style={{ "--wordmark-size": `${size}px` }}>
      vaelo
    </span>
  );
}

/* The mark and the word as one: the gilt V is the first letter of "vaelo",
   cut to cap height and set on the same baseline as the rest of the name. */
export function BrandWordmark({ size = 30 }) {
  const g = geometry(64);
  return (
    <span
      className="brandmark"
      style={{ "--wordmark-size": `${size}px` }}
      role="img"
      aria-label="vaelo"
    >
      <svg viewBox="6 11.2 52 41.8" className="brandmark-v" aria-hidden="true">
        <path d={g.heavyPath} />
        <path d={g.hairPath} />
        {g.serifs.map(([x, y, w, h], i) => (
          <rect key={i} x={x} y={y} width={w} height={h} />
        ))}
      </svg>
      <span aria-hidden="true">aelo</span>
    </span>
  );
}
