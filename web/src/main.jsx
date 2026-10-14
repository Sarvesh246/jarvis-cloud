import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-400-italic.css";
import "@fontsource/nunito/latin-600.css";
import "@fontsource/nunito/latin-700.css";
import "./design/tokens.css";
import "./design/base.css";
import { App } from "./App.jsx";

createRoot(document.getElementById("root")).render(<App />);
