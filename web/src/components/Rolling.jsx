import React, { useLayoutEffect, useRef, useState } from "react";
import "./rolling.css";

/* A figure whose digits turn on a wheel to their new value, like an
   odometer. Only digits move; currency signs, separators and units hold
   still, so "$4.2M" and "18%" work as written. With `enter`, the digits
   start from zero, for a figure that has just been set down. */

function Digit({ digit, enter, order }) {
  const [at, setAt] = useState(enter ? 0 : digit);
  const column = useRef(null);

  useLayoutEffect(() => {
    if (at === digit) return;
    /* Read layout so the starting position is drawn before the move. */
    void column.current?.offsetHeight;
    setAt(digit);
  }, [digit, at]);

  return (
    <span className="rolling-digit" ref={column} style={{ "--at": at, "--order": order }}>
      <span className="rolling-hold">{digit}</span>
      <span className="rolling-wheel">
        {"0123456789".split("").map((n) => (
          <span key={n}>{n}</span>
        ))}
      </span>
    </span>
  );
}

export function Rolling({ value, enter = false, className = "" }) {
  const text = String(value ?? "");
  const chars = [...text];
  let digits = 0;
  return (
    <span className={`rolling ${className}`}>
      <span className="sr-only">{text}</span>
      <span className="rolling-face" aria-hidden="true">
        {chars.map((char, i) => {
          /* Keyed from the right, so 9 → 10 adds a wheel on the left and the
             others keep turning. */
          const key = chars.length - i;
          if (!/\d/.test(char)) return <span key={`c${key}`}>{char}</span>;
          return <Digit key={`d${key}`} digit={Number(char)} enter={enter} order={digits++} />;
        })}
      </span>
    </span>
  );
}
