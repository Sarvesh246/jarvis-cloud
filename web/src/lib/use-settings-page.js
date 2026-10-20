import { useCallback, useEffect, useState } from "react";

// A history entry lets browser Back leave Settings without leaving Vaelo.
export function useSettingsPage(enabled) {
  const [open, setOpen] = useState(() => enabled && location.hash === "#settings");
  useEffect(() => {
    if (!enabled) return;
    const sync = () => setOpen(location.hash === "#settings");
    addEventListener("popstate", sync);
    addEventListener("hashchange", sync);
    return () => {
      removeEventListener("popstate", sync);
      removeEventListener("hashchange", sync);
    };
  }, [enabled]);
  const navigate = useCallback((next) => {
    if (!enabled) return setOpen(next);
    if (next) {
      if (location.hash !== "#settings") {
        history.pushState({ ...history.state, vaeloSettings: true }, "", "#settings");
      }
      setOpen(true);
    } else {
      setOpen(false);
      if (location.hash !== "#settings") return;
      if (history.state?.vaeloSettings) history.back();
      else history.replaceState(history.state, "", location.pathname + location.search);
    }
  }, [enabled]);
  return [open, navigate];
}
