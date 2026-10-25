import { useCallback, useLayoutEffect, useRef } from 'react';

// Stable event identity for memoized controls, with the latest committed
// handler. Update before child events can run; never capture an old chat/run.
export function useEventCallback(handler) {
  const latest = useRef(handler);
  useLayoutEffect(() => { latest.current = handler; });
  return useCallback((...args) => latest.current(...args), []);
}
