import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "./design/tokens.css";
import "./design/base.css";
import { App } from "./App.jsx";

createRoot(document.getElementById("root")).render(<App />);

/* Home-screen installs open instantly and survive a lost connection. Only in
   production builds, so development never serves stale files. */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* the app works the same without it, just not offline */
    });
  });
}
