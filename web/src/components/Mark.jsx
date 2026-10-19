import React from "react";
import "./mark.css";

/* Vaelo's mark: a Didone V. One weighted stroke and one hairline, the
   contrast that gives a high-contrast serif its composure, with fine
   bracket serifs at the top. It is also Vaelo's face: state is a data
   attribute so CSS owns all motion. */
const TOP = 13;
const BOTTOM = 53;
const LEFT = 11;
const RIGHT = 53;

/* Small marks get a sturdier hairline and serif so they survive at 20px. */
function geometry(size) {
  const small = size < 36;
  const heavy = small ? 10 : 9;
  const hair = small ? 4.2 : 2.6;
  const serif = small ? 2.6 : 1.5;
  const foot = small ? 2.4 : 1.6;
  const h = BOTTOM - TOP;
  const leftSlope = (32 - foot / 2 - LEFT) / h;
  const rightSlope = (RIGHT - 32 - foot / 2) / h;
  const t = (RIGHT - hair - (LEFT + heavy)) / (leftSlope + rightSlope);
  const crotch = [LEFT + heavy + leftSlope * t, TOP + t];
  const heavyPath = `M${LEFT} ${TOP}H${LEFT + heavy}L${crotch[0]} ${crotch[1]}L${32 + foot / 2} ${BOTTOM}H${32 - foot / 2}Z`;
  const hairPath = `M${RIGHT - hair} ${TOP}H${RIGHT}L${32 + foot / 2} ${BOTTOM}H${32 - foot / 2}L${crotch[0]} ${crotch[1]}Z`;
  return {
    heavyPath,
    hairPath,
    hairLine: [RIGHT - hair / 2, TOP, 32, BOTTOM - 1],
    serifs: [
      [LEFT - 4.5, TOP - serif, heavy + 9, serif],
      [RIGHT - hair - 4, TOP - serif, hair + 8, serif],
    ],
  };
}

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
