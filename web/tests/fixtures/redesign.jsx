import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/source-serif-4/standard.css";
import "@fontsource-variable/source-sans-3";
import "../../src/design/tokens.css";
import "../../src/design/base.css";
import { Message } from "../../src/components/Message.jsx";
import { PresentationContext } from "../../src/components/blocks/Blocks.jsx";
import { Workspace } from "../../src/components/Workspace.jsx";
import { samples } from "./redesign-samples.js";

function Fixture() {
  const [raster, setRaster] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/icons/icon-512.png")
      .then((response) => response.blob())
      .then((blob) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (active) setRaster(String(reader.result));
        };
        reader.readAsDataURL(blob);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const [imported, setImported] = useState([]);
  const [phoneReport, setPhoneReport] = useState(null);
  const choices = [...samples, ...imported];
  const [index, setIndex] = useState(
      Math.min(
        samples.length - 1,
        Number(new URLSearchParams(location.search).get("style")) || 0,
      ),
    ),
    [narrow, setNarrow] = useState(false),
    [theme, setTheme] = useState("light"),
    [live, setLive] = useState(false),
    [minimal, setMinimal] = useState(false),
    [open, setOpen] = useState(null);
  const [name, request, suppliedContent] = choices[index];
  const content =
    index === 13 && raster
      ? `![Inline raster example](${raster})\n\n${suppliedContent}`
      : suppliedContent;
  useEffect(() => {
    const receive = (event) => {
      if (event.origin !== location.origin) return;
      if (event.data?.kind === "redesign-layout" && event.source !== window)
        setPhoneReport(event.data);
      if (
        event.data?.kind === "redesign-sample" &&
        event.source === window.parent &&
        window.parent !== window &&
        Array.isArray(event.data.sample) &&
        event.data.sample.every((x) => typeof x === "string")
      ) {
        setImported([event.data.sample]);
        setIndex(samples.length);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => {
    if (window.parent === window) return;
    const report = () =>
      window.parent.postMessage(
        {
          kind: "redesign-layout",
          style: index,
          width: document.documentElement.clientWidth,
          overflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth + 1,
          fallback: !!document.querySelector(".block-plain"),
          rendered: !!document.querySelector("article"),
        },
        location.origin,
      );
    const observer = new ResizeObserver(report);
    observer.observe(document.body);
    report();
    return () => observer.disconnect();
  }, [index, content]);
  document.documentElement.dataset.theme = theme;
  const message = {
    id: `redesign-${index}`,
    role: "assistant",
    content,
    createdAt: Date.now(),
  };
  return (
    <PresentationContext.Provider value={minimal ? "minimal" : "adaptive"}>
      <nav
        aria-label="Design checks"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          padding: 16,
          borderBottom: "1px solid var(--hairline)",
          font: "14px var(--font-ui)",
        }}
      >
        <label>
          Output style{" "}
          <select
            value={index}
            onChange={(e) => {
              setPhoneReport(null);
              setIndex(Number(e.target.value));
            }}
          >
            {choices.map(([label], i) => (
              <option key={i} value={i}>
                {i + 1}. {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Load live responses{" "}
          <input
            type="file"
            accept="application/json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file || file.size > 200000) return;
              const records = JSON.parse(await file.text());
              if (!Array.isArray(records)) return;
              const next = records
                .filter(
                  (x) =>
                    x.complete &&
                    typeof x.content === "string" &&
                    typeof x.prompt === "string",
                )
                .slice(0, 12)
                .map((x) => [`Live ${x.name}`, x.prompt, x.content]);
              setImported(next);
              if (next.length) setIndex(samples.length);
            }}
          />
        </label>
        <button onClick={() => setNarrow(!narrow)}>Toggle phone width</button>
        <button onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
          Toggle theme
        </button>
        <label>
          <input
            type="checkbox"
            checked={minimal}
            onChange={(e) => setMinimal(e.target.checked)}
          />
          Minimal
        </label>
        <label>
          <input
            type="checkbox"
            checked={live}
            onChange={(e) => setLive(e.target.checked)}
          />
          Streaming
        </label>
      </nav>
      <main
        style={{
          maxWidth: 940,
          margin: "32px auto",
          padding: "0 16px",
          minWidth: 0,
        }}
      >
        <p style={{ font: "14px var(--font-ui)", color: "var(--muted)" }}>
          Style {index + 1} / {choices.length} · {name}
        </p>
        <p
          style={{
            font: "18px var(--font-read)",
            padding: "12px 16px",
            background: "var(--slip)",
            borderRadius: 12,
          }}
        >
          {request}
        </p>
        {narrow ? (
          <iframe
            title="Phone preview"
            data-layout-report={phoneReport ? JSON.stringify(phoneReport) : ""}
            onLoad={(event) => {
              if (index >= samples.length)
                event.currentTarget.contentWindow.postMessage(
                  { kind: "redesign-sample", sample: choices[index] },
                  location.origin,
                );
            }}
            src={`/tests/fixtures/redesign.html?style=${index}`}
            style={{
              display: "block",
              width: 390,
              maxWidth: "100%",
              height: 844,
              border: "1px solid var(--hairline)",
              margin: "auto",
            }}
          />
        ) : (
          <Message
            key={index}
            message={message}
            requestText={request}
            isLast
            busy={false}
            live={live}
            streaming={live}
            phase={live ? "speaking" : "idle"}
            onAction={(action, id, item) => {
              if (action === "open") setOpen(item);
            }}
          />
        )}
      </main>
      <Workspace
        item={open}
        messages={[message]}
        works={{}}
        onClose={() => setOpen(null)}
        onOpen={setOpen}
      />
    </PresentationContext.Provider>
  );
}
const root = createRoot(document.getElementById("root"));
root.render(<Fixture />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
