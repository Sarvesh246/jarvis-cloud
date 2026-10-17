// Development-only integration fixture. Synthetic data, no model requests or private account.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/newsreader/opsz.css";
import "../../src/design/tokens.css";
import "../../src/design/base.css";
import {
  Rendered,
  PresentationContext,
} from "../../src/components/blocks/Blocks.jsx";
import { CommandPalette } from "../../src/components/CommandPalette.jsx";
import { UITools, useInterfaceKeys } from "../../src/components/UITools.jsx";
import { Toast } from "../../src/components/Toast.jsx";
import { Workroom } from "../../src/components/Workroom.jsx";
import { Settings } from "../../src/components/Settings.jsx";
import { Rail } from "../../src/components/Rail.jsx";
import { Chart } from "../../src/components/blocks/Chart.jsx";
import { DEFAULTS, applyPrefs } from "../../src/lib/preferences.js";

import "../../src/design/refinements.css";

const imageA =
  "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg";
const imageB =
  "https://upload.wikimedia.org/wikipedia/commons/3/3f/Fronalpstock_big.jpg";
const samples = {
  overview: {
    type: "overview",
    title: "Trip overview",
    items: [
      { label: "Total", value: "$715", detail: "Hotel, food and travel" },
      { label: "Hotel", value: "$480" },
      { label: "Food", value: "$160" },
      { label: "Travel", value: "$75" },
    ],
  },
  widgets: {
    type: "widgets",
    title: "Supporting details",
    items: [
      { label: "Assumption", value: "Two people" },
      { label: "Budget", value: "$715" },
    ],
  },
  steps: {
    type: "steps",
    title: "Prepare a document",
    items: [
      "Gather the source notes.",
      "Check the names and dates.",
      "Export the final copy.",
    ],
  },
  graph: {
    type: "graph",
    title: "Request path",
    nodes: [
      { id: "browser", label: "Browser" },
      { id: "api", label: "API" },
      { id: "db", label: "Database" },
    ],
    edges: [
      { from: "browser", to: "api", label: "Sends request" },
      { from: "api", to: "db", label: "Reads data" },
    ],
  },
  files: {
    type: "files",
    title: "Project files",
    paths: [
      "src/App.jsx",
      "src/components/Button.jsx",
      "src/design/tokens.css",
      "package.json",
    ],
  },
  gallery: {
    type: "gallery",
    title: "Reference board",
    images: [
      { src: imageA, alt: "Example illustration" },
      { src: imageB, alt: "Mountain landscape" },
    ],
  },
  "image-compare": {
    type: "image-compare",
    title: "Before and after",
    before: { src: imageA, alt: "Before" },
    after: { src: imageB, alt: "After" },
  },
  "code-compare": {
    type: "code-compare",
    title: "Safer total",
    before:
      "function total(items) {\n  return items.reduce((a, b) => a + b);\n}",
    after:
      "function total(items) {\n  return items.reduce((a, b) => a + b, 0);\n}",
  },
  receipt: {
    type: "receipt",
    title: "Weekend expenses",
    currency: "USD",
    items: [
      { label: "Hotel", amount: 480 },
      { label: "Food", amount: 160 },
      { label: "Travel", amount: 75 },
    ],
  },
  qr: { type: "qr", title: "Open documentation", url: "https://react.dev/" },
  model: {
    type: "model",
    title: "Model preview",
    src: "https://modelviewer.dev/shared-assets/models/Astronaut.glb",
    alt: "Astronaut example",
  },
  integrations: {
    type: "integrations",
    title: "Supplied system roles",
    items: [
      { label: "Browser", value: "Renders the interface" },
      { label: "API", value: "Handles requests" },
    ],
  },
};
const chats = [
  {
    id: "demo-a",
    title: "Trip planning",
    pinned: true,
    messages: [
      {
        id: "reply-a",
        role: "assistant",
        content: "## Trip overview\n\n" + JSON.stringify(samples.overview),
      },
    ],
  },
  {
    id: "demo-b",
    title: "Code review",
    pinned: true,
    messages: [
      { id: "reply-b", role: "assistant", content: "A review of reduce()." },
    ],
  },
];
function Fixture() {
  const [kind, setKind] = useState("overview"),
    [format, setFormat] = useState('json'),
    [minimal, setMinimal] = useState(false),
    [live, setLive] = useState(false),
    [narrow, setNarrow] = useState(false),
    [palette, setPalette] = useState(false),
    [tools, setTools] = useState(false),
    [work, setWork] = useState(false),
    [settings, setSettings] = useState(false),
    [toasts, setToasts] = useState([]),
    [result, setResult] = useState(""),
    [prefs, setPrefs] = useState(DEFAULTS);
  useInterfaceKeys();
  const json = JSON.stringify(samples[kind], null, 2);
  const content = format === 'bare' ? json : `~~~${format === 'unlabeled' ? '' : format}\n${json}${live ? '' : '\n~~~'}`;
  return (
    <main
      style={{ maxWidth: narrow ? 350 : 960, padding: "1rem", margin: "auto" }}
    >
      <h1>Rich interface checks</h1>
      <p>Synthetic examples, no model calls.</p>
      <div className="rich-toolbar">
        <label>
          Example{" "}
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.keys(samples).map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>Response format <select value={format} onChange={e => setFormat(e.target.value)}>{['json','vaelo-ui','unlabeled','bare'].map(x => <option key={x}>{x}</option>)}</select></label>
        <button onClick={() => setMinimal((v) => !v)}>Toggle minimal</button>
        <button onClick={() => setLive((v) => !v)}>Toggle streaming</button>
        <button onClick={() => setNarrow((v) => !v)}>Toggle narrow</button>
        <button
          onClick={() => {
            const theme =
              document.documentElement.dataset.theme === "dark"
                ? "light"
                : "dark";
            applyPrefs({ ...prefs, theme });
          }}
        >
          Toggle theme
        </button>
        <button onClick={() => setPalette(true)}>Open commands</button>
        <button onClick={() => setTools(true)}>Open tools</button>
        <button onClick={() => setWork(true)}>Open Workroom</button>
        <button onClick={() => setSettings(true)}>Open settings</button>
        <button
          onClick={() =>
            setToasts((t) => [
              ...t,
              {
                id: crypto.randomUUID(),
                text: `Saved item ${t.length + 1}`,
                duration: 30000,
              },
            ])
          }
        >
          Add notice
        </button>
      </div>
      <p role="status">{result}</p>
      <PresentationContext.Provider value={minimal ? "minimal" : "adaptive"}>
        <div className="prose">
          <Rendered
            key={kind}
            content={content}
            sources={[]}
            stateKey={`fixture-${kind}`}
            live={live}
          />
        </div>
      </PresentationContext.Provider>
      <details>
        <summary>Additional chart and list checks</summary>
        <Chart
          columns={["Month", "Rent", "Food"]}
          rows={[
            ["Jan", "$1200", "$300"],
            ["Feb", "$1200", "$280"],
          ]}
          plan={{ values: [1, 2], label: 0 }}
        />
        <Rendered
          content={
            "1. Gather the notes.\n2. Review the draft.\n3. Save the final document."
          }
          sources={[]}
          stateKey="fixture-list"
        />
      </details>
      <details>
        <summary>Pinned conversations</summary>
        <div style={{ maxWidth: 320 }}>
          <Rail
            chats={chats}
            user={{ sub: "component-fixture", name: "Test" }}
            onSelect={(id) => setResult(`Selected ${id}`)}
            onNew={() => {}}
            onPin={() => {}}
            onDelete={() => {}}
            onSettings={() => setSettings(true)}
            onWorkroom={() => setWork(true)}
            onSignOut={() => {}}
            onOpenWork={() => {}}
          />
        </div>
      </details>
      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        chats={chats}
        onSelect={(id) => setResult(`Selected ${id}`)}
        onOpenWork={(item) => setResult(`Opened ${item.title}`)}
        actions={[
          {
            id: "test",
            label: "Open test action",
            run: () => setResult("Test action selected"),
          },
        ]}
      />
      <UITools open={tools} onClose={() => setTools(false)} />
      <Workroom
        open={work}
        onClose={() => setWork(false)}
        session={{ user: { sub: "", name: "Test" }, offline: true }}
      />
      <Settings
        open={settings}
        prefs={prefs}
        onClose={() => setSettings(false)}
        onTools={() => {
          setSettings(false);
          setTools(true);
        }}
        onChange={(patch) => {
          setPrefs((p) => ({ ...p, ...patch }));
          applyPrefs({ ...prefs, ...patch });
        }}
      />
      <Toast
        toasts={toasts}
        onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))}
      />
    </main>
  );
}
createRoot(document.getElementById("root")).render(<Fixture />);
