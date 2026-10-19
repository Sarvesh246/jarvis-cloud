// Every output type stacked on one page; ?theme=light|dark picks the paper.
import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/newsreader/opsz.css";
import "../../src/design/tokens.css";
import "../../src/design/base.css";
import "../../src/shell.css";
import "../../src/design/refinements.css";
import { Message } from "../../src/components/Message.jsx";
import { automaticSamples } from "./automatic-samples.js";
import { cases, prompts, DESK } from "./prompt-cases.js";

const theme = new URLSearchParams(location.search).get("theme");
if (theme) document.documentElement.dataset.theme = theme;
const match = new URLSearchParams(location.search).get("match");
const extra = [
  ["Itinerary", "Plan a 3-day trip to Lisbon.", "### Day 1: Alfama\n- Morning: Walk the streets\n- Evening: Fado dinner\n\n### Day 2: Belém\n- Morning: Monastery\n- Afternoon: Tower\n\n### Day 3: Sintra\n- Pena Palace"],
  ["Compare sections", "Compare React and Vue.", "### React\n- **Curve:** Moderate\n- **Ecosystem:** Huge\n\n### Vue\n- **Curve:** Gentle\n- **Ecosystem:** Smaller"],
  ["Pros/cons", "Pros and cons of remote work?", "**Pros**\n- Flexible\n- No commute\n\n**Cons**\n- Isolation\n- Hard to unplug"],
  ["Quarter series", "How did sales change by quarter?", "Sales grew. Q1: $120k, Q2: $150k, Q3: $180k, Q4: $240k."],
];
createRoot(document.getElementById("root")).render(
  <main style={{ maxWidth: 900, margin: "auto", padding: "1rem", background: "var(--canvas)", color: "var(--ink)" }}>
    {[...automaticSamples, ...extra, ...cases.map(([name, request, reply]) => ["Prompt · " + name, request, reply]), ["Prompt · attached image", prompts.image, "A tidy desk with a lamp.", [{ src: DESK, alt: "desk.jpg" }]]].filter(([name]) => !match || name.toLowerCase().includes(match.toLowerCase())).map(([name, requestText, content, requestImages], i) => (
      <section key={name} style={{ marginBottom: "2rem" }}>
        <h2 style={{ font: "600 .8rem var(--font-ui)", color: "var(--muted)" }}>{i}. {name}</h2>
        <Message message={{ id: "a" + i, role: "assistant", content, createdAt: 1 }} requestText={requestText} requestImages={requestImages} isLast={false} busy={false} live={false} onAction={() => {}} />
      </section>
    ))}
  </main>,
);
