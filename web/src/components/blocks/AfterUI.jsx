import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowsOut,
  ArrowSquareOut,
  ArrowCounterClockwise,
  CaretLeft,
  CaretRight,
  CaretDown,
  Check,
  Copy,
  DownloadSimple,
  File,
  Folder,
  FolderOpen,
  Cube,
  Stack,
  X,
  GitBranch,
  Link,
  Code,
  Bed,
  ForkKnife,
  Train,
  SuitcaseRolling,
} from "@phosphor-icons/react";
import { diffLines, diffWordsWithSpace } from "diff";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { KATEX_OPTIONS, normalizeMath, remarkMathDisplay } from "../../lib/math.js";
import { plainLine } from "../../lib/structured.js";
import { parseRichUI, fileTree } from "../../lib/rich-ui.js";
import { blockKey } from "../../lib/intelligent-ui.js";
import { toNumber } from "../../lib/table.js";
import { percentageShares } from "../../lib/output-redesign.js";
import { copyText, DESKTOP, saveDesktopFile, saveDesktopBytes } from "../../lib/desktop.js";
import { imageDownload } from '../../lib/image-download.js';

function useCopy() {
  const [done, setDone] = useState(false);
  return [
    done,
    async (text) => {
      try {
        await copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      } catch {
        setDone(false);
      }
    },
  ];
}
export function SaveButton({ text, name, type = "text/plain", children }) {
  return (
    <button
      className="block-tool"
      aria-label={`Save ${name}`}
      onClick={async () => {
        if (DESKTOP) {
          await saveDesktopFile(name, text);
          return;
        }
        const url = URL.createObjectURL(new Blob([text], { type }));
        const link = Object.assign(document.createElement("a"), {
          href: url,
          download: name,
        });
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}
    >
      <DownloadSimple size={17} />
      {children}
    </button>
  );
}
export function CopyButton({ text, label = "Copy" }) {
  const [done, copy] = useCopy();
  return (
    <button
      className="block-tool"
      disabled={!text}
      aria-label={done ? "Copied" : label}
      onClick={() => copy(text)}
    >
      {done ? <Check size={16} /> : <Copy size={16} />}
      <span>{done ? "Copied" : label}</span>
    </button>
  );
}
export function ImageDownload({src}) {
  const [saving,setSaving]=useState(false), [problem,setProblem]=useState('');
  return <><button aria-label="Download image" disabled={saving} onClick={async () => {
    setSaving(true);setProblem('');
    try {
      const file=await imageDownload(src);
      if (DESKTOP) await saveDesktopBytes(file.name,file.bytes);
      else {
        const url=URL.createObjectURL(new Blob([file.bytes],{type:file.mime}));
        const link=Object.assign(document.createElement('a'),{href:url,download:file.name});link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
    } catch {setProblem('Could not save the image. Open the original to save it.');}
    finally {setSaving(false);}
  }}><DownloadSimple size={17} /></button>{problem && <span className="after-image-error" role="status">{problem}</span>}</>;
}
function FactIcon({ label }) {
  const Icon = /hotel|accommodation|lodging/i.test(label)
    ? Bed
    : /food|meal|dining/i.test(label)
      ? ForkKnife
      : /travel|transport|train/i.test(label)
        ? Train
        : /total|trip/i.test(label)
          ? SuitcaseRolling
          : Stack;
  return <Icon size={20} />;
}
export function StepPlayer({ items, render = (x) => x }) {
  const [index, setIndex] = useState(0),
    [view, setView] = useState("guide"),
    [finished, setFinished] = useState(false);
  const step = Math.min(index, items.length - 1);
  if (!items.length) return null;
  const choose = (i) => {
    setIndex(i);
    setFinished(false);
  };
  const stepContent = (item) => {
    if (typeof item !== "string") return render(item);
    const split = item.match(/^(.{1,90}?)(?:\s+[—–]\s+|\n+)([\s\S]+)$/);
    return split ? (
      <>
        <h3>{plainLine(split[1])}</h3>
        <Markdown remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }], remarkMathDisplay]} rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}>{normalizeMath(split[2])}</Markdown>
      </>
    ) : (
      <Markdown remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }], remarkMathDisplay]} rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}>{normalizeMath(item)}</Markdown>
    );
  };
  return (
    <section className="after-steps" aria-label="Step by step">
      <div className="after-tabs">
        <button
          aria-pressed={view === "guide"}
          onClick={() => setView("guide")}
        >
          Guided
        </button>
        <button aria-pressed={view === "all"} onClick={() => setView("all")}>
          All steps
        </button>
        <span>
          {step + 1} of {items.length}
        </span>
        <button aria-label="Restart guide" onClick={() => choose(0)}>
          <ArrowCounterClockwise size={17} />
        </button>
      </div>
      <div className="after-segments" aria-label="Jump to step">
        {items.map((_, i) => (
          <button
            key={i}
            aria-label={`Step ${i + 1}`}
            aria-current={i === step ? "step" : undefined}
            data-done={i < step || finished || undefined}
            onClick={() => choose(i)}
          />
        ))}
      </div>
      {view === "all" ? (
        <ol className="after-all-steps">
          {items.map((item, i) => (
            <li key={i}>
              <button
                onClick={() => {
                  choose(i);
                  setView("guide");
                }}
              >
                <b>{String(i + 1).padStart(2, "0")}</b>
                <span>
                  {typeof item === "string"
                    ? plainLine(item.split("\n")[0])
                    : render(item)}
                </span>
                <CaretRight />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="after-step-card" aria-live="polite">
          <span className="after-step-number">
            {finished ? <Check size={32} /> : String(step + 1).padStart(2, "0")}
          </span>
          <div>{finished ? <h3>All done</h3> : stepContent(items[step])}</div>
        </div>
      )}
      <footer className="after-footer">
        <button
          className="block-tool"
          disabled={!step}
          onClick={() => choose(step - 1)}
        >
          <CaretLeft />
          Back
        </button>
        <span>
          {finished ? "Guide complete" : `Step ${step + 1} of ${items.length}`}
        </span>
        <button
          className="after-primary"
          disabled={finished}
          onClick={() =>
            step === items.length - 1 ? setFinished(true) : choose(step + 1)
          }
        >
          {step === items.length - 1 ? "Finish" : "Next"}
          <CaretRight />
        </button>
      </footer>
    </section>
  );
}
function Overview({ data }) {
  const totalIndex = data.items.findIndex((x) =>
    /^(?:grand total|total|overall|sum)$/i.test(x.label.trim()),
  );
  const items =
    totalIndex > 0
      ? [
          data.items[totalIndex],
          ...data.items.filter((_, i) => i !== totalIndex),
        ]
      : data.items;
  const lead = items[0],
    parts = items.slice(1),
    total = toNumber(lead.value);
  const sum = parts.reduce((s, x) => s + toNumber(x.value), 0);
  const shares =
    total > 0 &&
    parts.length &&
    parts.every((x) => toNumber(x.value) >= 0) &&
    Math.abs(sum - total) < 0.01;
  const percentages = shares
    ? percentageShares(parts.map((x) => toNumber(x.value)))
    : [];
  return (
    <dl
      className="after-overview"
      aria-label="Overview cards"
      style={{ gridTemplateRows: `repeat(${Math.max(1, parts.length)}, auto)` }}
    >
      <div className="after-overview-lead">
        <dt>
          {data.title ? `${data.title} · ${lead.label}` : lead.label}
          <FactIcon label={lead.label} />
        </dt>
        <dd>{lead.value}</dd>
        <p>
          {lead.detail ||
            `${parts.length} supporting ${parts.length === 1 ? "figure" : "figures"}`}
        </p>
        {shares && (
          <div className="after-share">
            <div>
              {parts.map((x, i) => (
                <span
                  key={i}
                  style={{ flex: toNumber(x.value), "--series": i }}
                />
              ))}
            </div>
            <ul>
              {parts.map((x, i) => (
                <li key={i} style={{ "--series": i }}>
                  {x.label} {percentages[i]}%
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {parts.map((item, i) => (
        <div key={i} className="after-overview-part">
          <span className="after-tile-icon" style={{ "--series": i }}>
            <FactIcon label={item.label} />
          </span>
          <div>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
            {item.detail && <p>{item.detail}</p>}
          </div>
          {shares && <b>{percentages[i]}%</b>}
        </div>
      ))}
    </dl>
  );
}
function Widgets({ data }) {
  const [index, setIndex] = useState(0);
  return (
    <div className="after-widgets">
      <div className="after-widget-tools">
        <strong>{data.title || "Details"}</strong>
        <span>
          {index + 1} / {data.items.length}
        </span>
        <button
          className="block-tool"
          aria-label="Previous detail"
          disabled={!index}
          onClick={() => setIndex(index - 1)}
        >
          <CaretLeft />
        </button>
        <button
          className="block-tool"
          aria-label="Next detail"
          disabled={index === data.items.length - 1}
          onClick={() => setIndex(index + 1)}
        >
          <CaretRight />
        </button>
      </div>
      <div className="after-widget-stage">
        <div
          className="after-widget-track"
          style={{ transform: `translateX(calc(${index} * (-76% - 14px)))` }}
        >
          {data.items.map((item, i) => (
            <button
              className="after-widget"
              key={i}
              data-depth={Math.min(2, Math.abs(i - index))}
              onClick={() => setIndex(i)}
              tabIndex={Math.abs(i - index) > 1 ? -1 : 0}
            >
              <span className="after-widget-label">
                <span className="after-tile-icon">
                  <FactIcon label={item.label} />
                </span>
                {item.label}
              </span>
              <strong>{item.value}</strong>
              <p>{item.detail}</p>
              {item.chips?.length > 0 && (
                <span className="after-widget-chips">
                  {item.chips.map((chip, j) => (
                    <span key={j}>{chip}</span>
                  ))}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="after-dots">
        {data.items.map((_, i) => (
          <button
            key={i}
            aria-label={`Detail ${i + 1}`}
            aria-pressed={i === index}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </div>
  );
}
function Graph({ data }) {
  const id = useId().replaceAll(":", ""),
    [focus, setFocus] = useState(null),
    [relation, setRelation] = useState("All");
  const types = [...new Set(data.edges.map((x) => x.label || "Connection"))];
  const levels = new Map(data.nodes.map((n) => [n.id, 0]));
  // Bounded relaxation handles cycles without hanging or pushing nodes off-canvas.
  for (let i = 0; i < data.nodes.length; i++) {
    let changed = false;
    for (const edge of data.edges)
      if (
        levels.get(edge.to) <= levels.get(edge.from) &&
        levels.get(edge.from) < 3
      ) {
        levels.set(edge.to, levels.get(edge.from) + 1);
        changed = true;
      }
    if (!changed) break;
  }
  const groups = [...new Set(levels.values())].sort((a, b) => a - b);
  const points = data.nodes.map((n) => {
    const siblings = data.nodes.filter(
      (x) => levels.get(x.id) === levels.get(n.id),
    );
    return {
      ...n,
      x: groups.indexOf(levels.get(n.id)) * 200 + 10,
      y: siblings.indexOf(n) * 82 + 15,
    };
  });
  const byId = new Map(points.map((n) => [n.id, n]));
  const height = Math.max(...points.map((n) => n.y)) + 76;
  const lit = (e) =>
    (!focus || e.from === focus || e.to === focus) &&
    (relation === "All" || (e.label || "Connection") === relation);
  return (
    <>
      <div className="after-tabs after-relation">
        {["All", ...types].map((t) => (
          <button
            key={t}
            aria-pressed={relation === t}
            onClick={() => setRelation(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="after-graph-scroll">
        <svg
          className="after-graph"
          viewBox={`0 0 ${groups.length * 200} ${height}`}
          role="img"
          aria-label="Relationships, left to right"
        >
          <defs>
            <marker
              id={id}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          {data.edges.map((e, i) => {
            const a = byId.get(e.from),
              b = byId.get(e.to);
            return (
              <path
                key={i}
                className="after-graph-edge"
                data-dim={!lit(e) || undefined}
                style={{
                  stroke: ["var(--gilt)", "var(--sage)", "#7e8fa0"][
                    types.indexOf(e.label || "Connection") % 3
                  ],
                  color: ["var(--gilt)", "var(--sage)", "#7e8fa0"][
                    types.indexOf(e.label || "Connection") % 3
                  ],
                }}
                markerEnd={`url(#${id})`}
                d={`M${a.x + 164},${a.y + 25} C${a.x + 190},${a.y + 25} ${b.x - 26},${b.y + 25} ${b.x},${b.y + 25}`}
              />
            );
          })}
          {points.map((n) => (
            <g
              key={n.id}
              role="button"
              tabIndex={0}
              aria-label={`Highlight ${n.label}`}
              aria-pressed={focus === n.id}
              onClick={() => setFocus(focus === n.id ? null : n.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setFocus(focus === n.id ? null : n.id);
                }
              }}
              className="after-graph-node"
              data-active={focus === n.id || undefined}
            >
              <rect x={n.x} y={n.y} width="164" height="50" rx="12" />
              <Cube x={n.x + 10} y={n.y + 15} width={18} height={18} />
              <text x={n.x + 36} y={n.y + (n.role ? 22 : 30)}>
                {n.label.length > 17 ? `${n.label.slice(0, 16)}…` : n.label}
              </text>
              {n.role && (
                <text className="after-node-role" x={n.x + 36} y={n.y + 38}>
                  {n.role.slice(0, 22)}
                </text>
              )}
              <title>{n.label}</title>
            </g>
          ))}
        </svg>
      </div>
      <ul className="after-connections">
        {data.edges.filter(lit).map((e, i) => (
          <li key={i}>
            <span>{byId.get(e.from).label}</span>
            <span>→</span>
            <span>{byId.get(e.to).label}</span>
            <small>{e.label}</small>
          </li>
        ))}
      </ul>
      {focus && (
        <button className="block-tool" onClick={() => setFocus(null)}>
          All connections
        </button>
      )}
    </>
  );
}
function Files({ paths }) {
  const root = useMemo(() => fileTree(paths), [paths]),
    [selected, setSelected] = useState(""),
    [closed, setClosed] = useState(new Set());
  const folders = [];
  const collect = (branch, prefix = "") => {
    for (const [name, children] of branch)
      if (children.size) {
        const path = prefix + name;
        folders.push(path);
        collect(children, `${path}/`);
      }
  };
  collect(root);
  const tree = (branch, prefix = "") => (
    <ul className="after-files">
      {[...branch].map(([name, children]) => {
        const path = prefix + name,
          folder = children.size > 0,
          open = !closed.has(path);
        return (
          <li key={name}>
            <button
              className="after-file"
              data-selected={selected === path || undefined}
              onClick={() => {
                setSelected(path);
                if (folder)
                  setClosed((prev) => {
                    const next = new Set(prev);
                    open ? next.add(path) : next.delete(path);
                    return next;
                  });
              }}
            >
              <CaretRight
                className="after-file-caret"
                data-open={(folder && open) || undefined}
                style={{ visibility: folder ? "visible" : "hidden" }}
              />
              {folder ? (
                open ? (
                  <FolderOpen />
                ) : (
                  <Folder />
                )
              ) : (
                <File data-ext={name.split(".").at(-1)} />
              )}
              <span>{name}</span>
              {folder && <small>{children.size}</small>}
            </button>
            {folder && open && tree(children, `${path}/`)}
          </li>
        );
      })}
    </ul>
  );
  return (
    <>
      <div className="after-tabs">
        <button onClick={() => setClosed(new Set())}>Expand all</button>
        <button onClick={() => setClosed(new Set(folders))}>
          Collapse all
        </button>
        <span>{paths.length} files</span>
      </div>
      {tree(root)}
      <footer className="after-footer">
        <code>{selected || "Select a file to see its path"}</code>
        <CopyButton text={selected} label="Copy path" />
      </footer>
    </>
  );
}
export function LensImage({ image, inspect = true, onExpand }) {
  const [zoom, setZoom] = useState(2),
    [point, setPoint] = useState(null),
    [failed, setFailed] = useState(false),
    [size, setSize] = useState("");
  const move = (e) => {
    if (!inspect) return;
    const r = e.currentTarget.getBoundingClientRect();
    setPoint({
      x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)),
      width: r.width,
      height: r.height,
    });
  };
  return (
    <figure className="after-image" data-inspect={inspect || undefined}>
      <div
        className="after-image-stage"
        tabIndex={inspect ? 0 : undefined}
        aria-label={
          inspect
            ? `${image.alt}. Use arrow keys to inspect details.`
            : undefined
        }
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={() => setPoint(null)}
        onBlur={() => setPoint(null)}
        onKeyDown={(e) => {
          const delta = {
            ArrowLeft: [-5, 0],
            ArrowRight: [5, 0],
            ArrowUp: [0, -5],
            ArrowDown: [0, 5],
          }[e.key];
          if (!inspect || !delta) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          setPoint((p) => ({
            width: r.width,
            height: r.height,
            x: Math.max(0, Math.min(100, (p?.x ?? 50) + delta[0])),
            y: Math.max(0, Math.min(100, (p?.y ?? 50) + delta[1])),
          }));
        }}
      >
        {failed ? (
          <p role="status">
            Image couldn’t load.{" "}
            <a href={image.src} target="_blank" rel="noopener noreferrer">
              Open image
            </a>
          </p>
        ) : (
          <img
            src={image.src}
            alt={image.alt}
            loading="lazy"
            draggable={false}
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            onLoad={(e) =>
              setSize(
                `${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`,
              )
            }
          />
        )}
        {inspect && point && !failed && (
          <span
            className="after-loupe"
            style={{
              left: `${point.x}%`,
              top: `${point.y}%`,
              backgroundImage: `url(${JSON.stringify(image.src)})`,
              backgroundSize: `${point.width * zoom}px ${point.height * zoom}px`,
              backgroundPosition: `${90 - (point.x / 100) * point.width * zoom}px ${90 - (point.y / 100) * point.height * zoom}px`,
            }}
          />
        )}
        {inspect && !point && (
          <span className="after-lens-note">{zoom}× lens</span>
        )}
        <div className="after-image-tools">
          <a
            href={image.src}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open image"
          >
            <ArrowSquareOut />
          </a>
          <ImageDownload src={image.src} />
          {onExpand && (
            <button aria-label="Expand image" onClick={onExpand}>
              <ArrowsOut />
            </button>
          )}
        </div>
      </div>
      <figcaption>
        <span>
          {image.alt}
          <small>
            {inspect
              ? "Hover or drag over the image to inspect"
              : size || new URL(image.src).hostname}
          </small>
        </span>
        {inspect && (
          <span className="after-zoom">
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                aria-label={`Magnify ${n} times`}
                aria-pressed={zoom === n}
                onClick={() => setZoom(n)}
              >
                {n}×
              </button>
            ))}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
export function Lightbox({ images, index, setIndex, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className="after-lightbox"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") setIndex((index + 1) % images.length);
        if (e.key === "ArrowLeft")
          setIndex((index + images.length - 1) % images.length);
      }}
    >
      <div className="after-lightbox-head">
        <span>
          {index + 1} / {images.length}
        </span>
        <button autoFocus aria-label="Close image viewer" onClick={onClose}>
          <X />
        </button>
      </div>
      <LensImage key={index} image={images[index]} />
      <div className="after-footer">
        <button
          className="block-tool"
          aria-label="Previous image"
          onClick={() => setIndex((index + images.length - 1) % images.length)}
        >
          <CaretLeft />
        </button>
        <span>{images[index].alt}</span>
        <button
          className="block-tool"
          aria-label="Next image"
          onClick={() => setIndex((index + 1) % images.length)}
        >
          <CaretRight />
        </button>
      </div>
    </dialog>
  );
}
function Gallery({ data }) {
  const [view, setView] = useState(
      data.view === "carousel" ? "carousel" : "grid",
    ),
    [index, setIndex] = useState(0),
    [lightbox, setLightbox] = useState(false);
  if (data.images.length === 1)
    return (
      <>
        <LensImage image={data.images[0]} onExpand={() => setLightbox(true)} />
        {lightbox && (
          <Lightbox
            images={data.images}
            index={0}
            setIndex={() => {}}
            onClose={() => setLightbox(false)}
          />
        )}
      </>
    );
  return (
    <>
      <div className="after-tabs">
        <button aria-pressed={view === "grid"} onClick={() => setView("grid")}>
          Image board
        </button>
        <button
          aria-pressed={view === "carousel"}
          onClick={() => setView("carousel")}
        >
          Carousel
        </button>
        <span>{data.images.length} images</span>
      </div>
      {view === "grid" ? (
        <div className="after-masonry">
          {data.images.map((image, i) => (
            <button
              key={i}
              aria-label={image.alt}
              onClick={() => {
                setIndex(i);
                setLightbox(true);
              }}
            >
              <img
                src={image.src}
                alt={image.alt}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
              <span>{image.alt}</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="after-carousel">
            <div className="after-carousel-window">
              <div
                className="after-carousel-track"
                style={{ transform: `translateX(-${index * 100}%)` }}
              >
                {data.images.map((image, i) => (
                  <div
                    key={i}
                    className="after-carousel-slide"
                    inert={i !== index ? true : undefined}
                    aria-hidden={i !== index || undefined}
                  >
                    <LensImage
                      image={image}
                      inspect={false}
                      onExpand={() => setLightbox(true)}
                    />
                  </div>
                ))}
              </div>
            </div>
            <button
              className="after-carousel-prev"
              aria-label="Previous image"
              disabled={!index}
              onClick={() => setIndex(index - 1)}
            >
              <CaretLeft />
            </button>
            <button
              className="after-carousel-next"
              aria-label="Next image"
              disabled={index === data.images.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              <CaretRight />
            </button>
            <span className="after-position">
              {index + 1} / {data.images.length}
            </span>
          </div>
          <div className="after-thumbnails">
            {data.images.map((image, i) => (
              <button
                key={i}
                aria-label={`View ${image.alt}`}
                aria-pressed={index === i}
                onClick={() => setIndex(i)}
              >
                <img src={image.src} alt="" referrerPolicy="no-referrer" />
              </button>
            ))}
          </div>
        </>
      )}
      {lightbox && (
        <Lightbox
          images={data.images}
          index={index}
          setIndex={setIndex}
          onClose={() => setLightbox(false)}
        />
      )}
    </>
  );
}
function ImageCompare({ data }) {
  const [position, setPosition] = useState(50),
    [failed, setFailed] = useState(false);
  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPosition(
      Math.round(
        Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
      ),
    );
  };
  return (
    <>
      <div
        className="after-image-compare"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons) move(e);
        }}
      >
        <img
          src={data.before.src}
          alt={data.before.alt}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
        <img
          className="after-compare-top"
          src={data.after.src}
          alt={data.after.alt}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          style={{ clipPath: `inset(0 0 0 ${position}%)` }}
        />
        <span
          className="after-before-label"
          style={{ opacity: Math.min(1, position / 25) }}
        >
          Before
        </span>
        <span
          className="after-after-label"
          style={{ opacity: Math.min(1, (100 - position) / 25) }}
        >
          After
        </span>
        <span className="after-compare-handle" style={{ left: `${position}%` }}>
          <b>‹ ›</b>
        </span>
        <input
          type="range"
          min="0"
          max="100"
          value={position}
          aria-label="Before / after split"
          aria-valuetext={`${position}% before, ${100 - position}% after`}
          onChange={(e) => setPosition(Number(e.target.value))}
        />
      </div>
      <div className="after-tabs">
        {[100, 50, 0].map((v, i) => (
          <button
            key={v}
            aria-pressed={position === v}
            onClick={() => setPosition(v)}
          >
            {["Before", "50 / 50", "After"][i]}
          </button>
        ))}
      </div>
      {failed && (
        <p role="status">An image couldn’t load. Open an original below.</p>
      )}
      <footer className="after-footer">
        <a href={data.before.src} target="_blank" rel="noopener noreferrer">
          Open before ↗
        </a>
        <a href={data.after.src} target="_blank" rel="noopener noreferrer">
          Open after ↗
        </a>
      </footer>
    </>
  );
}
function Receipt({ data }) {
  const [people, setPeople] = useState(data.people || 1);
  const format = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: data.currency,
  });
  const total = data.items.reduce((sum, x) => sum + x.amount, 0);
  return (
    <div className="after-receipt">
      <div className="after-receipt-heading">
        COST SUMMARY
        <small>
          {data.items.length} listed items · {data.currency}
        </small>
      </div>
      <dl>
        {data.items.map((x, i) => (
          <div key={i}>
            <dt>
              {x.label}
              {x.detail && <small>{x.detail}</small>}
            </dt>
            <span />
            <dd>{format.format(x.amount)}</dd>
          </div>
        ))}
      </dl>
      <div className="after-receipt-total">
        <span>Total</span>
        <strong>{format.format(total)}</strong>
      </div>
      <div className="after-split">
        <span>Split between</span>
        <button
          aria-label="Fewer people"
          disabled={people <= 1}
          onClick={() => setPeople(people - 1)}
        >
          −
        </button>
        <output>{people}</output>
        <button
          aria-label="More people"
          disabled={people >= 100}
          onClick={() => setPeople(people + 1)}
        >
          +
        </button>
        <span>{people === 1 ? "person" : "people"}</span>
        <strong>
          {format.format(total / people)}
          <small>per person</small>
        </strong>
      </div>
      <p className="local-note">
        Calculated from listed amounts. A summary, not proof of payment.
      </p>
    </div>
  );
}
export function QRLink({ url }) {
  const [svg, setSvg] = useState(""),
    [problem, setProblem] = useState("");
  useEffect(() => {
    let active = true;
    setSvg("");
    import("qrcode")
      .then((m) =>
        (m.default || m).toString(url, {
          type: "svg",
          margin: 3,
          errorCorrectionLevel: "M",
          color: { dark: "#1c1614", light: "#ffffff" },
        }),
      )
      .then((value) => {
        if (active) setSvg(value);
      })
      .catch(() => {
        if (active) setProblem("QR unavailable. Use the link below.");
      });
    return () => {
      active = false;
    };
  }, [url]);
  return (
    <div className="after-qr">
      <div className="after-qr-code">
        {svg ? (
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
            alt="QR code for the link below"
          />
        ) : (
          <p role="status">{problem || "Preparing QR code…"}</p>
        )}
      </div>
      <strong>{new URL(url).hostname}</strong>
      <a href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>
      <div className="after-actions">
        <CopyButton text={url} label="Copy link" />
        {svg && (
          <SaveButton text={svg} name="vaelo-qr.svg" type="image/svg+xml">
            Save SVG
          </SaveButton>
        )}
        <a
          className="block-tool"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open
          <ArrowSquareOut />
        </a>
      </div>
      <p className="local-note">
        Made locally. Shares this address, never your account.
      </p>
    </div>
  );
}
function Model({ data }) {
  const [state, setState] = useState("idle"),
    [rotate, setRotate] = useState(false),
    [progress, setProgress] = useState(0),
    [attempt, setAttempt] = useState(0),
    ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const loaded = () => setState("ready"),
      fail = () => setState("error"),
      update = (e) => setProgress(e.detail.totalProgress);
    el.addEventListener("load", loaded);
    el.addEventListener("error", fail);
    el.addEventListener("progress", update);
    return () => {
      el.removeEventListener("load", loaded);
      el.removeEventListener("error", fail);
      el.removeEventListener("progress", update);
    };
  }, [state, attempt]);
  const load = async () => {
    setState("preparing");
    try {
      await import("@google/model-viewer");
      setAttempt((x) => x + 1);
      setProgress(0);
      setState("loading");
    } catch {
      setState("error");
    }
  };
  return (
    <div className="after-model">
      {["loading", "ready"].includes(state) && (
        <model-viewer
          key={attempt}
          ref={ref}
          src={data.src}
          alt={data.alt}
          camera-controls
          auto-rotate={rotate || undefined}
          touch-action="pan-y"
        />
      )}
      {state !== "ready" && (
        <div className="after-model-intro">
          <Cube size={48} />
          <h3>{data.alt}</h3>
          <p>
            {new URL(data.src).pathname.split("/").at(-1)} ·{" "}
            {new URL(data.src).hostname}
          </p>
          {state === "idle" || state === "error" ? (
            <>
              <button className="after-primary" onClick={load}>
                {state === "error" ? "Try again" : "Load 3D model"}
              </button>
              <small>
                {state === "error"
                  ? "The model couldn’t load on this device."
                  : "Loads from the source only when you choose."}
              </small>
            </>
          ) : (
            <>
              <progress aria-label="Loading model" value={progress} max="1" />
              <span role="status">Loading 3D model…</span>
            </>
          )}
        </div>
      )}
      {state === "ready" && (
        <div className="after-model-controls">
          <button
            className="block-tool"
            aria-pressed={rotate}
            onClick={() => setRotate(!rotate)}
          >
            Auto-rotate
          </button>
          <button
            className="block-tool"
            onClick={() => {
              ref.current.cameraOrbit = "auto auto auto";
              ref.current.fieldOfView = "auto";
              ref.current.jumpCameraToGoal();
            }}
          >
            Reset view
          </button>
        </div>
      )}
      <a href={data.src} target="_blank" rel="noopener noreferrer">
        Open model file ↗
      </a>
    </div>
  );
}
function Integrations({ data }) {
  const [selected, setSelected] = useState(0);
  const stage = useRef(null),
    hub = useRef(null),
    marker = useId().replaceAll(":", "");
  const [wires, setWires] = useState([]);
  useEffect(() => {
    const element = stage.current;
    if (!element || !hub.current) return;
    const measure = () => {
      const outer = element.getBoundingClientRect(),
        center = hub.current.getBoundingClientRect();
      const vertical = matchMedia("(max-width:600px)").matches;
      const next = [...element.querySelectorAll("[data-system-index]")].map(
        (node) => {
          const rect = node.getBoundingClientRect(),
            i = Number(node.dataset.systemIndex),
            source = data.items[i].direction === "source";
          const from = source ? rect : center,
            to = source ? center : rect;
          const ax =
              (vertical ? from.left + from.width / 2 : from.right) - outer.left,
            ay =
              (vertical ? from.bottom : from.top + from.height / 2) - outer.top;
          const bx = (vertical ? to.left + to.width / 2 : to.left) - outer.left,
            by = (vertical ? to.top : to.top + to.height / 2) - outer.top;
          return {
            i,
            d: vertical
              ? `M ${ax} ${ay} C ${ax} ${(ay + by) / 2}, ${bx} ${(ay + by) / 2}, ${bx} ${by}`
              : `M ${ax} ${ay} C ${(ax + bx) / 2} ${ay}, ${(ax + bx) / 2} ${by}, ${bx} ${by}`,
          };
        },
      );
      setWires((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [data.items]);
  const sources = data.items
    .map((x, i) => ({ ...x, i }))
    .filter((x) => x.direction === "source");
  const destinations = data.items
    .map((x, i) => ({ ...x, i }))
    .filter((x) => x.direction === "destination");
  const neutral = data.items
    .map((x, i) => ({ ...x, i }))
    .filter((x) => !x.direction);
  const item = (x, i) => (
    <button
      key={i}
      className="after-integration"
      data-system-index={i}
      aria-pressed={selected === i}
      onClick={() => setSelected(i)}
    >
      <Link size={20} />
      <span>
        <b>{x.label}</b>
        <small>{x.value}</small>
      </span>
    </button>
  );
  return (
    <>
      <div className="after-integration-note">
        Illustration · nothing connected
      </div>
      {(sources.length > 0 || destinations.length > 0) && (
        <div className="after-integration-flow" ref={stage}>
          <svg className="after-integration-wires" aria-hidden="true">
            <defs>
              <marker
                id={marker}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto"
              >
                <path d="M0 0 L10 5 L0 10z" fill="context-stroke" />
              </marker>
            </defs>
            {wires.map((wire) => (
              <path
                key={wire.i}
                d={wire.d}
                data-active={selected === wire.i || undefined}
                markerEnd={`url(#${marker})`}
              />
            ))}
          </svg>
          <div>{sources.map((x) => item(x, x.i))}</div>
          <span className="after-integration-line" aria-hidden="true" />
          <div className="after-hub" ref={hub}>
            <GitBranch size={28} />
            <b>{data.title || "Workflow"}</b>
          </div>
          <span className="after-integration-line" aria-hidden="true" />
          <div>{destinations.map((x) => item(x, x.i))}</div>
        </div>
      )}
      {neutral.length > 0 && (
        <div className="after-integration-systems">
          {neutral.map((x) => item(x, x.i))}
        </div>
      )}
      <div className="after-integration-detail" aria-live="polite">
        <b>{data.items[selected].label}</b>
        <span>{data.items[selected].detail || data.items[selected].value}</span>
      </div>
    </>
  );
}
export function CodeCompare({ before, after, stateKey = "temporary" }) {
  const [view, setView] = useState("diff"),
    [notes, setNotes] = useState({}),
    [editing, setEditing] = useState(null),
    [storageOK, setStorageOK] = useState(true);
  const key = blockKey(stateKey, 0, before + "\n---\n" + after);
  useEffect(() => {
    try {
      const value = JSON.parse(
        sessionStorage.getItem(`vaelo-review:${key}`) || "{}",
      );
      setNotes(
        value && !Array.isArray(value) && typeof value === "object"
          ? value
          : {},
      );
    } catch {
      setNotes({});
      setStorageOK(false);
    }
  }, [key]);
  const parts = useMemo(
    () =>
      before.length <= 8000 && after.length <= 8000
        ? diffLines(before, after, { timeout: 50, maxEditLength: 500 })
        : null,
    [before, after],
  );
  let old = 0,
    next = 0;
  const lines = (parts || []).flatMap((part) =>
    part.value
      .replace(/\n$/, "")
      .split("\n")
      .map((text) => ({
        text,
        kind: part.added ? "added" : part.removed ? "removed" : "same",
        old: part.added ? "" : ++old,
        next: part.removed ? "" : ++next,
      })),
  );
  const added = lines.filter((x) => x.kind === "added").length,
    removed = lines.filter((x) => x.kind === "removed").length;
  const pairs = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind !== "removed") continue;
    let middle = i;
    while (lines[middle]?.kind === "removed") middle++;
    let end = middle;
    while (lines[end]?.kind === "added") end++;
    for (let j = 0; j < Math.min(middle - i, end - middle); j++) {
      pairs.set(i + j, middle + j);
      pairs.set(middle + j, i + j);
    }
    i = end - 1;
  }
  const note = (i, value) => {
    const result = { ...notes, [i]: value.slice(0, 2000) };
    setNotes(result);
    try {
      sessionStorage.setItem(`vaelo-review:${key}`, JSON.stringify(result));
    } catch {
      setStorageOK(false);
    }
  };
  const words = (line, i) => {
    const other = lines[pairs.get(i)];
    if (
      !other ||
      line.kind === "same" ||
      line.text.length > 1000 ||
      other.text.length > 1000
    )
      return line.text;
    const changes = diffWordsWithSpace(
      line.kind === "removed" ? line.text : other.text,
      line.kind === "added" ? line.text : other.text,
      { timeout: 10, maxEditLength: 100 },
    );
    return changes
      ? changes
          .filter((x) => (line.kind === "removed" ? !x.added : !x.removed))
          .map((x, j) =>
            x.added || x.removed ? <mark key={j}>{x.value}</mark> : x.value,
          )
      : line.text;
  };
  return (
    <div className="after-code-compare">
      <div className="after-tabs">
        <button aria-pressed={view === "diff"} onClick={() => setView("diff")}>
          Unified
        </button>
        <button
          aria-pressed={view === "split"}
          onClick={() => setView("split")}
        >
          Split
        </button>
        <span className="after-diff-stats">
          <b>+{added}</b>
          <b>−{removed}</b>
          <span className="after-change-bar" aria-hidden="true">{[0,1,2,3,4].map(i => <i key={i} data-kind={i === 4 || !added && !removed ? 'same' : i / 4 < added / (added + removed) ? 'added' : 'removed'} />)}</span>
        </span>
        <CopyButton text={after} label="Copy after" />
      </div>
      {view === "split" || !parts ? (
        <div className="after-code-split">
          <div>
            <strong>Before</strong>
            <pre tabIndex={0}>{before}</pre>
          </div>
          <div>
            <strong>After</strong>
            <pre tabIndex={0}>{after}</pre>
          </div>
        </div>
      ) : (
        <div className="after-diff">
          {lines.map((line, i) => (
            <div key={i} data-kind={line.kind}>
              <div className="after-code-line">
                <button
                  aria-label={`Add note on line ${line.next || line.old}`}
                  onClick={() => setEditing(editing === i ? null : i)}
                >
                  +
                </button>
                <span>{line.old}</span>
                <span>{line.next}</span>
                <code>
                  {line.kind === "added"
                    ? "+"
                    : line.kind === "removed"
                      ? "−"
                      : " "}{" "}
                  {words(line, i)}
                </code>
              </div>
              {(editing === i || notes[i]) && (
                <div className="after-review-note">
                  <label htmlFor={`${key}-${i}`}>Your review note</label>
                  <textarea
                    id={`${key}-${i}`}
                    maxLength={2000}
                    value={notes[i] || ""}
                    onChange={(e) => note(i, e.target.value)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="local-note">
        {storageOK
          ? "Review notes stay in this tab until it closes."
          : "Storage unavailable; notes last for this view."}{" "}
        Notes are not sent to Vaelo.
      </p>
    </div>
  );
}
const TITLES = {
  overview: "Overview",
  widgets: "Details",
  steps: "Step by step",
  graph: "Relationships",
  files: "Files",
  gallery: "Images",
  "image-compare": "Image comparison",
  "code-compare": "Code changes",
  receipt: "Cost summary",
  qr: "Open on another device",
  model: "3D preview",
  integrations: "Connections",
};
export function RichUI({ source, enabled, stateKey, pending = false }) {
  const data = useMemo(() => parseRichUI(source), [source]),
    [original, setOriginal] = useState(false);
  if (pending)
    return (
      <div className="rich-pending" role="status" aria-busy="true">
        Preparing this view…
      </div>
    );
  if (!data || !enabled) return <pre className="block-plain">{source}</pre>;
  const meta = data.items
    ? `${data.items.length} ${data.type === "steps" ? "steps" : "items"}`
    : data.images
      ? `${data.images.length} images`
      : data.paths
        ? `${data.paths.length} paths`
        : data.nodes
          ? `${data.nodes.length} nodes · ${data.edges.length} connections`
          : "Interactive view";
  return (
    <section
      className="after-block"
      data-kind={data.type}
      aria-label={data.title || TITLES[data.type]}
    >
      <header className="after-head">
        <div>
          <strong>{data.title || TITLES[data.type]}</strong>
          <small>{meta}</small>
        </div>
        <button
          className="block-tool"
          aria-label={original ? "Show visual" : "View original data"}
          aria-pressed={original}
          onClick={() => setOriginal(!original)}
        >
          <Code size={18} />
        </button>
        <CopyButton text={source} />
      </header>
      {original ? (
        <pre className="block-plain">{source}</pre>
      ) : (
        <div className="after-body">
          {data.type === "overview" && <Overview data={data} />}
          {data.type === "widgets" && <Widgets data={data} />}
          {data.type === "steps" && <StepPlayer items={data.items} />}
          {data.type === "graph" && <Graph data={data} />}
          {data.type === "files" && <Files paths={data.paths} />}
          {data.type === "gallery" && <Gallery data={data} />}
          {data.type === "image-compare" && <ImageCompare data={data} />}
          {data.type === "code-compare" && (
            <CodeCompare
              before={data.before}
              after={data.after}
              stateKey={stateKey}
            />
          )}
          {data.type === "receipt" && <Receipt data={data} />}
          {data.type === "qr" && <QRLink url={data.url} />}
          {data.type === "model" && <Model data={data} />}
          {data.type === "integrations" && <Integrations data={data} />}
        </div>
      )}
    </section>
  );
}
