import React, { createContext, useMemo, useState } from "react";
import { collectSources } from "../../lib/sources.js";
import { copyText } from "../../lib/desktop.js";
import { SourceIcon } from "./SourceIcon.jsx";
import { Rolling } from "../Rolling.jsx";
export { download } from "../../lib/file-download.js";
export const PresentationContext = createContext("adaptive");
export function useCopy() {
  const [done, setDone] = useState(false);
  const copy = async (text) => {
    try {
      await copyText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      /* clipboard can be blocked; the text stays selectable */
    }
  };
  return [done, copy];
}


export function looksLikeSvg(language, source) {
  return language === "svg" || (language === "xml" && /^\s*<svg[\s>]/.test(source));
}


export function SourceStrip({ sources, onOpen, arriving = false }) {
  if (!sources.length) return null;
  const shown = sources.slice(0, 4);
  return (
    <button
      className="source-strip"
      data-arriving={arriving || undefined}
      onClick={onOpen}
      aria-description={`Show all ${sources.length} sources`}
    >
      <span className="label">Sources</span>
      <span className="source-stack">
        {shown.map((source) => (
          <span key={source.id} className="source-pip" data-kind={source.kind}>
            <SourceIcon kind={source.kind} size={12} />
            <span>{source.domain}</span>
          </span>
        ))}
      </span>
      {sources.length > shown.length && (
        <span className="source-more">
          +<Rolling value={sources.length - shown.length} />
        </span>
      )}
    </button>
  );
}


export const IMAGE_COLUMNS = 8;
export const IMAGE_ROWS = 6;

export function imageTiles(className) {
  return Array.from({ length: IMAGE_COLUMNS * IMAGE_ROWS }, (_, i) => (
    <span
      key={i}
      className={className}
      style={{ "--i": (i % IMAGE_COLUMNS) + Math.floor(i / IMAGE_COLUMNS) }}
    />
  ));
}


export function useSources(content) {
  const parsed = useMemo(() => collectSources(content || ""), [content]);
  const key = JSON.stringify(parsed);
  return useMemo(() => parsed, [key]);
}
