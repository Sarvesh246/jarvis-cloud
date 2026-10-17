// Runs the actual application with disposable, tab-local guest data and stubbed API responses.
import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "../../src/design/tokens.css";
import "../../src/design/base.css";
import { App } from "../../src/App.jsx";

const now = Date.now();
const user = { sub: "component-guest", name: "Test reader", guest: true };
const data = {
  type: "overview",
  title: "A weekend within budget",
  items: [
    { label: "Total", value: "$715", detail: "Hotel, food and travel" },
    { label: "Hotel", value: "$480" },
    { label: "Food", value: "$160" },
    { label: "Travel", value: "$75" },
  ],
};
const content =
  "## Your weekend\n\nHere are your supplied costs.\n\n~~~\n" +
  JSON.stringify(data) +
  "\n~~~\n\n### Before leaving\n1. Confirm your booking.\n2. Pack your essentials.\n3. Check the departure time.\n\n### Costs\n| Item | Cost |\n|---|---:|\n| Hotel | $480 |\n| Food | $160 |\n| Travel | $75 |";
if (!sessionStorage.getItem("component-fixture-seeded")) {
  sessionStorage.setItem(
    "vaelo-guest-chats",
    JSON.stringify([
      {
        id: "component-trip",
        title: "Weekend budget",
        pinned: true,
        updated: now,
        messages: [
          {
            id: "component-question",
            role: "user",
            content:
              "Show my weekend as a bento overview: hotel $480, food $160, travel $75.",
          },
          { id: "component-answer", role: "assistant", content, at: now },
        ],
      },
      {
        id: "component-review",
        title: "Code review",
        pinned: true,
        updated: now - 1000,
        messages: [
          {
            id: "component-review-answer",
            role: "assistant",
            content: "Use an initial value in reduce to handle empty arrays.",
          },
        ],
      },
    ]),
  );
  sessionStorage.setItem("component-fixture-seeded", "yes");
}
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" ? input : input.url,
    location.href,
  );
  if (url.pathname === "/api/session")
    return Response.json({ user, csrf: "fixture-only", configured: true });
  if (url.pathname === "/api/status") return Response.json({ ready: true });
  if (url.pathname.startsWith("/api/"))
    return Response.json(
      { error: "This integration fixture does not call live services." },
      { status: 503 },
    );
  return originalFetch(input, init);
};
createRoot(document.getElementById("root")).render(<App />);
