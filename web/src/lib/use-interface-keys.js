import { useEffect } from "react";
export function useInterfaceKeys() {
  useEffect(() => {
    function keys(event) {
      const tab = event.target.closest?.("[role=tab]");
      if (
        !tab ||
        !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
      )
        return;
      const list = tab.closest("[role=tablist]");
      if (!list) return;
      const tabs = [...list.querySelectorAll("[role=tab]:not(:disabled)")];
      const index = tabs.indexOf(tab);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
              tabs.length;
      event.preventDefault();
      tabs[next]?.focus();
      tabs[next]?.click();
    }
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, []);
}
