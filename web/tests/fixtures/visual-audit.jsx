// Text, weather, generated-image and edge-case replies for eyeballing in a browser.
import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/newsreader/opsz.css";
import "../../src/design/tokens.css";
import "../../src/design/base.css";
import "../../src/shell.css";
import "../../src/design/refinements.css";
import { Message } from "../../src/components/Message.jsx";
import { weatherContent } from "./weather-data.js";

const theme = new URLSearchParams(location.search).get("theme");
if (theme) document.documentElement.dataset.theme = theme;

const art = (a, b) => {
  const canvas = document.createElement("canvas");
  canvas.width = 1024; canvas.height = 768;
  const g = canvas.getContext("2d");
  const fill = g.createLinearGradient(0, 0, 1024, 768);
  fill.addColorStop(0, a); fill.addColorStop(1, b);
  g.fillStyle = fill; g.fillRect(0, 0, 1024, 768);
  g.fillStyle = "rgba(255,255,255,.35)"; g.beginPath(); g.arc(740, 250, 120, 0, 7); g.fill();
  g.fillStyle = "rgba(0,0,0,.25)"; g.beginPath(); g.moveTo(0, 600); g.quadraticCurveTo(300, 420, 560, 560); g.quadraticCurveTo(800, 660, 1024, 500); g.lineTo(1024, 768); g.lineTo(0, 768); g.fill();
  return canvas.toDataURL("image/jpeg", 0.9);
};

const samples = [
  ["Rich markdown", "Explain how to write well.", `# A heading one
## Heading two
### Heading three
#### Heading four

A paragraph with **bold**, *italic*, ~~strike~~, \`inline code\`, and a [link](https://example.com). Here is a long sentence that keeps going so wrapping and line height can be judged properly across more than one line of text in the column.

> A blockquote that carries a thought worth setting apart from the body copy.
>
> It spans two paragraphs.

- First bullet
- Second bullet with a longer line that should wrap cleanly under its own marker rather than under the bullet
  - Nested bullet
  - Another nested
    - Third level
- Third bullet

1. Ordered one
2. Ordered two
   1. Nested ordered
3. Ordered three

- [x] Task done
- [ ] Task to do

---

Footnote-style line.[^1]

| Plain | Table |
|---|---|
| a | b |

[^1]: The note.`],
  ["Math", "Solve the quadratic.", String.raw`The roots satisfy $ax^2+bx+c=0$, so

$$x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}$$

Which gives two values when the discriminant is positive.`],
  ["Code languages", "Show me code.", "```python\ndef greet(name: str) -> str:\n    return f\"Hello, {name}\"\n```\n\n```bash\nnpm install && npm run build\n```\n\n```json\n{\"name\": \"vaelo\", \"ok\": true, \"n\": 3}\n```\n\n```ts\nconst longLine = (a: number, b: number) => `${a} plus ${b} equals ${a + b} and this line runs far beyond the width of the code block so it must scroll`;\n```"],
  ["Wide table", "Compare plans in a table.", "| Plan | Price | Seats | Storage | Support | SSO | Audit log | Uptime SLA | Notes |\n|---|---:|---:|---:|---|---|---|---:|---|\n| Free | $0 | 1 | 1 GB | Community | No | No | — | Good for trying it out |\n| Team | $12 | 10 | 100 GB | Email | No | Yes | 99.5% | Most popular |\n| Business | $24 | 100 | 1 TB | Priority | Yes | Yes | 99.9% | Adds SAML |\n| Enterprise | Custom | Unlimited | Unlimited | Dedicated | Yes | Yes | 99.99% | Contact sales |"],
  ["Weather", "Weather today in College Station", weatherContent],
  ["Generated image", "Draw a sunset.", `Here is the sunset.\n\n![A sunset over hills](${art("#f59e0b", "#7c3aed")})`],
  ["Two generated images", "Draw two moods.", `Two options.\n\n![Calm morning](${art("#93c5fd", "#34d399")})\n\n![Dusk](${art("#fb7185", "#1e1b4b")})`],
  ["Image failed", "Draw something.", "Here it is.\n\n![Teardrop car could not be shown](vaelo-image:" + "a".repeat(24) + ")"],
  ["Short answer", "Capital of France?", "Paris."],
  ["Long unbroken", "Print a hash.", "The digest is `9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a089f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08` and a url https://example.com/a/very/long/path/that/keeps/going/and/going/and/going/without/any/break/at/all/until/it/ends.html done."],
];
createRoot(document.getElementById("root")).render(
  <main style={{ maxWidth: Number(new URLSearchParams(location.search).get("w")) || 900, margin: "auto", padding: "1rem", background: "var(--canvas)", color: "var(--ink)" }}>
    {samples.map(([name, requestText, content], i) => (
      <section key={name} style={{ marginBottom: "2rem" }}>
        <h2 style={{ font: "600 .8rem var(--font-ui)", color: "var(--muted)" }}>{i}. {name}</h2>
        <Message message={{ id: "v" + i, role: "assistant", content, createdAt: 1 }} requestText={requestText} requestImages={[]} isLast={false} busy={false} live={false} onAction={() => {}} />
      </section>
    ))}
  </main>,
);
