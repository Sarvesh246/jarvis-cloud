import "./ui-tools.css";
import React, { useEffect, useState } from "react";
export function ActivityIsland({ title, children }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="activity-island">
      <button
        className="block-tool"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        {title} <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && <div>{children}</div>}
    </section>
  );
}

export function ReadingProgress({ target, content }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const article = target.current;
    let container = article?.parentElement;
    while (
      container &&
      !/(auto|scroll)/.test(getComputedStyle(container).overflowY)
    )
      container = container.parentElement;
    if (!article || !container) return;
    const update = () => {
      const total = container.scrollHeight - container.clientHeight;
      setProgress(
        total > 0
          ? Math.max(0, Math.min(100, (container.scrollTop / total) * 100))
          : 100,
      );
    };
    update();
    container.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(article);
    observer.observe(container);
    return () => {
      container.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [target, content]);
  return (
    <progress
      className="reading-progress"
      value={progress}
      max="100"
      aria-label="Document reading position"
    />
  );
}
