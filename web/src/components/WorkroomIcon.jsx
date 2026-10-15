import React from "react";
import "./workroom-icon.css";

/* The case stays planted; the lid (with its handle) swings up on a hinge at
   the back-left corner, uncovering the open top of the case. */
export function WorkroomIcon({ open = false, size = 20 }) {
  return (
    <svg
      className="workroom-icon"
      data-open={open || undefined}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.5 12.5h17v6.75a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z" />
      <path d="M8 12.5v2M16 12.5v2" />
      <g className="workroom-icon-lid">
        <path d="M3.5 12.5V10A1.5 1.5 0 0 1 5 8.5h14a1.5 1.5 0 0 1 1.5 1.5v2.5Z" />
        <path d="M9 8.5V6.75A1.25 1.25 0 0 1 10.25 5.5h3.5A1.25 1.25 0 0 1 15 6.75V8.5" />
      </g>
    </svg>
  );
}
