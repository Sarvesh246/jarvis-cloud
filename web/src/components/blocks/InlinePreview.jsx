import React, { useState } from "react";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { Highlighted } from "./Highlighted.jsx";
import { CopyButton, SaveButton } from "./AfterUI.jsx";

// A separate CSP inside a sandbox with no capabilities: no scripts, resource fetches,
// forms, parent access or storage, including CSS URLs and nested documents.
export function previewDocument(source) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; frame-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${source}</body></html>`;
}
export function InlinePreview({ source, language, src }) {
  const [view, setView] = useState("preview"),
    [phone, setPhone] = useState(false),
    [revision, setRevision] = useState(0);
  return (
    <figure
      className="inline-preview"
      data-src={src}
      data-phone={phone || undefined}
    >
      <figcaption className="inline-preview-title"><strong>{language === 'html' ? 'Web artifact' : 'Graphic artifact'}</strong><small>Preview · source · export</small></figcaption>
      <div className="after-tabs" role="group" aria-label="Preview view">
        {["preview", "code", "split"].map((x) => (
          <button key={x} aria-pressed={view === x} onClick={() => setView(x)}>
            {x[0].toUpperCase() + x.slice(1)}
          </button>
        ))}
        <span />
        <button aria-pressed={!phone} onClick={() => setPhone(false)}>
          Desktop
        </button>
        <button aria-pressed={phone} onClick={() => setPhone(true)}>
          Phone
        </button>
        <button
          aria-label="Reload preview"
          onClick={() => setRevision(revision + 1)}
        >
          <ArrowCounterClockwise size={16} />
        </button>
      </div>
      <div className={view === "split" ? "inline-preview-split" : ""}>
        {view !== "code" && (
          <div className="inline-preview-stage">
            <iframe
              key={revision}
              title={`${language.toUpperCase()} preview`}
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={previewDocument(source)}
            />
          </div>
        )}
        {view !== "preview" && (
          <div className="inline-preview-code">
            <pre tabIndex={0}>
              <Highlighted source={source} language={language} />
            </pre>
          </div>
        )}
      </div>
      <footer className="after-footer">
        <span>Sandboxed · scripts off · external resources blocked</span>
        <CopyButton text={source} />
        <SaveButton
          text={source}
          name={`preview.${language === "html" ? "html" : "svg"}`}
        />
      </footer>
    </figure>
  );
}
