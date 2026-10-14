import React from "react";
import "./halo.css";

/* Vaelo's face. One mark, eight states; each maps to something the agent is
   actually doing. State is a data attribute so CSS owns all motion. */
export const HALO_STATES = [
  "idle",
  "listening",
  "waking",
  "thinking",
  "working",
  "speaking",
  "settling",
  "concern",
];

export function Halo({ state = "idle", size = 64, className = "" }) {
  return (
    <span
      className={`halo ${className}`}
      data-state={state}
      style={{ "--halo-size": `${size}px` }}
      aria-hidden="true"
    >
      <span className="halo-glow" />
      <svg viewBox="0 0 64 64" className="halo-ring">
        <circle className="halo-track" cx="32" cy="32" r="24" />
        <circle className="halo-arc" cx="32" cy="32" r="24" pathLength="100" />
        <circle className="halo-work" cx="32" cy="32" r="24" pathLength="100" />
        <circle className="halo-core" cx="32" cy="32" r="4.5" />
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
