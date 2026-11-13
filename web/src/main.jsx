import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "./design/tokens.css";
import "./design/base.css";
import "./design/personal.css";
import { Opening } from "./components/SignIn.jsx";
const App = lazy(() => import("./App.jsx").then(module => ({ default: module.App })));
import { DESKTOP, installDesktopTransport } from "./lib/desktop.js";
import { trackViewport } from "./lib/viewport.js";

installDesktopTransport();
trackViewport();

// Programmatic focus after a tap can inherit the composer's focus ring on
// Safari. Keep focus in place, but reserve control outlines for keyboards.
document.documentElement.dataset.input = "pointer";
addEventListener("pointerdown", () => {
  document.documentElement.dataset.input = "pointer";
}, { capture: true });
addEventListener("keydown", (event) => {
  if (["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
    document.documentElement.dataset.input = "keyboard";
}, { capture: true });

createRoot(document.getElementById("root")).render(<Suspense fallback={<Opening />}><App /></Suspense>);

/* Home-screen installs open instantly and survive a lost connection. Only in
   production builds, so development never serves stale files. */
if (!DESKTOP && import.meta.env.PROD && "serviceWorker" in navigator) {
  addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* the app works the same without it, just not offline */
    });
  });
}
