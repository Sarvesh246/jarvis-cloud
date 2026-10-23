import { useRef } from "react";
import { dragProps } from "./gesture.js";

/* The same, for a component that re-renders mid-drag (any drag that sets
   state): the gesture lives in a ref, so a fresh set of handlers carries on
   the drag the last set began instead of dropping it. */
export function useDrag(options) {
  const store = useRef({ g: null });
  return dragProps(options, store.current);
}
