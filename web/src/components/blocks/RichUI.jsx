import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { diffLines } from "diff";
import { fileTree, parseRichUI } from "../../lib/rich-ui.js";
import { blockKey } from "../../lib/intelligent-ui.js";
import "./rich-ui.css";

export function StepPlayer({ items, render = (x) => x }) {
  const [step, setStep] = useState(0);
  const current = Math.min(step, items.length - 1);
  const [all, setAll] = useState(false);
  return (
    <section className="rich-steps" aria-label="Step by step">
      <div className="rich-toolbar">
        <strong>
          Step {current + 1} of {items.length}
        </strong>
        <button
          className="block-tool"
          onClick={() => setAll(!all)}
          aria-expanded={all}
        >
          {all ? "Focus on one step" : "Show all steps"}
        </button>
      </div>
      <progress
        aria-label="Position in instructions"
        max={items.length}
        value={current + 1}
      />
      {all ? (
        <ol>
          {items.map((x, i) => (
            <li key={i}>{render(x)}</li>
          ))}
        </ol>
      ) : (
        <div className="rich-step" aria-live="polite">
          {render(items[current])}
        </div>
      )}
      <div className="rich-toolbar">
        <button
          className="block-tool"
          disabled={!current}
          onClick={() => setStep(current - 1)}
        >
          Previous step
        </button>
        <button
          className="block-tool"
          disabled={current === items.length - 1}
          onClick={() => setStep(current + 1)}
        >
          Next step
        </button>
        <button className="block-tool" onClick={() => setStep(0)}>
          Start again
        </button>
      </div>
    </section>
  );
}

function Overview({ data }) {
  const [view, setView] = useState(data.type === "widgets" ? "stack" : "grid");
  const stack = useRef(null);
  const [card, setCard] = useState(0);
  return (
    <>
      <div className="rich-toolbar" role="group" aria-label="Summary layout">
        {["grid", "stack"].map((x) => (
          <button
            key={x}
            className="block-tool"
            aria-pressed={view === x}
            onClick={() => setView(x)}
          >
            {x === "grid" ? "Overview" : "Widget stack"}
          </button>
        ))}
      </div>
      <dl
        ref={stack}
        tabIndex={view === "stack" ? 0 : undefined}
        aria-label="Overview cards"
        onScroll={(e) => {
          const width =
            e.currentTarget.firstElementChild?.getBoundingClientRect().width;
          if (width)
            setCard(
              Math.min(
                data.items.length - 1,
                Math.round(e.currentTarget.scrollLeft / (width + 10)),
              ),
            );
        }}
        className={`rich-overview ${view === "stack" ? "rich-widget-stack" : ""}`}
      >
        {data.items.map((x, i) => (
          <div key={i} className="rich-spotlight" onPointerMove={spotlight}>
            <dt>{x.label}</dt>
            <dd>
              {x.value}
              {x.detail && <span className="rich-card-detail">{x.detail}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {view === "stack" && (
        <div className="rich-toolbar" role="group" aria-label="Choose a widget">
          {data.items.map((item, i) => (
            <button
              key={i}
              className="block-tool"
              aria-pressed={card === i}
              aria-label={`Show widget ${i + 1}: ${item.label}`}
              onClick={() => {
                setCard(i);
                const child = stack.current?.children[i];
                if (child)
                  stack.current.scrollTo({
                    left:
                      child.offsetLeft -
                      stack.current.firstElementChild.offsetLeft,
                    behavior: "instant",
                  });
              }}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
export function spotlight(event) {
  if (event.pointerType !== "mouse") return;
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty(
    "--pointer-x",
    `${event.clientX - rect.left}px`,
  );
  event.currentTarget.style.setProperty(
    "--pointer-y",
    `${event.clientY - rect.top}px`,
  );
}

function Graph({ data }) {
  const [focus, setFocus] = useState(null);
  const arrowId = useId().replaceAll(":", "");
  const points = data.nodes.map((n, i) => ({
    ...n,
    x:
      310 + Math.cos((i / data.nodes.length) * Math.PI * 2 - Math.PI / 2) * 205,
    y:
      220 + Math.sin((i / data.nodes.length) * Math.PI * 2 - Math.PI / 2) * 155,
  }));
  const byId = new Map(points.map((n) => [n.id, n]));
  return (
    <>
      <div
        className="rich-graph-scroll"
        role="region"
        aria-label="Relationship diagram, scroll sideways if needed"
        tabIndex={0}
      >
        <svg
          viewBox="0 0 620 440"
          className="rich-graph"
          role="img"
          aria-label={data.title || "Relationship diagram"}
        >
          <defs>
            <marker
              id={arrowId}
              viewBox="0 0 10 10"
              refX="17"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path
                d="M 0 0 L 10 5 L 0 10 z"
                style={{ fill: "currentColor", stroke: "none" }}
              />
            </marker>
          </defs>
          {data.edges.map((edge, i) => {
            const a = byId.get(edge.from),
              b = byId.get(edge.to);
            return (
              <g
                key={i}
                data-lit={!focus || edge.from === focus || edge.to === focus}
              >
                <path
                  d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`}
                  className="rich-beam"
                  markerEnd={`url(#${arrowId})`}
                />
                <circle cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} r="3" />
              </g>
            );
          })}
          {points.map((n) => (
            <g key={n.id}>
              <circle cx={n.x} cy={n.y} r="8" />
              <text x={n.x} y={n.y - 16} textAnchor="middle">
                {n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div
        className="rich-toolbar"
        role="group"
        aria-label="Highlight connections"
      >
        <button
          className="block-tool"
          onClick={() => setFocus(null)}
          aria-pressed={!focus}
        >
          All connections
        </button>
        {data.nodes.map((n) => (
          <button
            className="block-tool"
            key={n.id}
            aria-pressed={focus === n.id}
            onClick={() => setFocus(n.id)}
          >
            {n.label}
          </button>
        ))}
      </div>
      <ul className="rich-edges">
        {data.edges
          .filter((e) => !focus || e.from === focus || e.to === focus)
          .map((e, i) => (
            <li key={i}>
              {byId.get(e.from).label} → {byId.get(e.to).label}
              {e.label && `: ${e.label}`}
            </li>
          ))}
      </ul>
    </>
  );
}

function Files({ branch }) {
  return (
    <ul className="rich-files">
      {[...branch].map(([name, children]) => (
        <li key={name}>
          {children.size ? (
            <details open>
              <summary>{name}</summary>
              <Files branch={children} />
            </details>
          ) : (
            <span>▧ {name}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function LensImage({ image }) {
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(false);
  return (
    <figure className="rich-image">
      <div
        className="rich-image-scroll"
        tabIndex={0}
        aria-label={`${image.alt}, scroll to inspect when magnified`}
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
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
          />
        )}
      </div>
      <figcaption>{image.alt}</figcaption>
      <label>
        Magnification{" "}
        <input
          aria-label={`Magnification: ${image.alt}`}
          type="range"
          min="1"
          max="3"
          step="0.25"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        />
      </label>
    </figure>
  );
}
function Gallery({ data }) {
  const [view, setView] = useState("grid");
  const [index, setIndex] = useState(0);
  return (
    <>
      <div className="rich-toolbar">
        {["grid", "carousel"].map((x) => (
          <button
            className="block-tool"
            key={x}
            aria-pressed={view === x}
            onClick={() => setView(x)}
          >
            {x === "grid" ? "Image board" : "Carousel"}
          </button>
        ))}
      </div>
      {view === "grid" ? (
        <div className="rich-masonry">
          {data.images.map((x, i) => (
            <LensImage key={i} image={x} />
          ))}
        </div>
      ) : (
        <>
          <LensImage key={index} image={data.images[index]} />
          <div className="rich-toolbar">
            <button
              className="block-tool"
              disabled={!index}
              onClick={() => setIndex(index - 1)}
            >
              Previous image
            </button>
            <span aria-live="polite">
              {index + 1} / {data.images.length}
            </span>
            <button
              className="block-tool"
              disabled={index === data.images.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              Next image
            </button>
          </div>
        </>
      )}
    </>
  );
}
function ImageCompare({ data }) {
  const [position, setPosition] = useState(50);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <div className="rich-compare-images">
        <img
          src={data.before.src}
          alt={data.before.alt}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
        <img
          className="rich-after"
          src={data.after.src}
          alt={data.after.alt}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          style={{ clipPath: `inset(0 0 0 ${position}%)` }}
        />
        <span className="rich-divider" style={{ left: `${position}%` }} />
      </div>
      <label>
        Before / after split{" "}
        <input
          type="range"
          min="0"
          max="100"
          value={position}
          aria-valuetext={`${position}% before, ${100 - position}% after`}
          onChange={(e) => setPosition(Number(e.target.value))}
        />
      </label>
      <p>
        {data.before.alt} / {data.after.alt}
      </p>
      {failed && (
        <p role="status">An image couldn’t load. Use the links below.</p>
      )}
      <div className="rich-toolbar">
        <a href={data.before.src} target="_blank" rel="noopener noreferrer">
          Open before
        </a>
        <a href={data.after.src} target="_blank" rel="noopener noreferrer">
          Open after
        </a>
      </div>
    </>
  );
}

export function CodeCompare({ before, after, stateKey = "temporary" }) {
  const id = useId();
  const [view, setView] = useState("diff");
  const [notes, setNotes] = useState({});
  const [storageOK, setStorageOK] = useState(true);
  const key = blockKey(stateKey, 0, before + "\n---\n" + after);
  useEffect(() => {
    try {
      const value = JSON.parse(
        sessionStorage.getItem(`vaelo-review:${key}`) || "{}",
      );
      setNotes(
        value && typeof value === "object" && !Array.isArray(value)
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
      before.length <= 8000 &&
      after.length <= 8000 &&
      before.split("\n").length <= 240 &&
      after.split("\n").length <= 240
        ? diffLines(before, after, { maxEditLength: 500, timeout: 50 })
        : undefined,
    [before, after],
  );
  let oldLine = 0,
    newLine = 0;
  const lines = (parts || []).flatMap((part) =>
    part.value
      .replace(/\n$/, "")
      .split("\n")
      .map((text) => ({
        text,
        kind: part.added ? "added" : part.removed ? "removed" : "same",
        old: part.added ? "" : ++oldLine,
        next: part.removed ? "" : ++newLine,
      })),
  );
  function note(line, value) {
    const next = { ...notes, [line]: value.slice(0, 2000) };
    setNotes(next);
    try {
      sessionStorage.setItem(`vaelo-review:${key}`, JSON.stringify(next));
    } catch {
      setStorageOK(false);
    }
  }
  return (
    <>
      <div
        className="rich-toolbar"
        role="group"
        aria-label="Code comparison view"
      >
        {["diff", "split"].map((x) => (
          <button
            className="block-tool"
            key={x}
            aria-pressed={view === x}
            onClick={() => setView(x)}
          >
            {x === "diff" ? "Changes and notes" : "Side by side"}
          </button>
        ))}
      </div>
      {view === "split" || !parts ? (
        <div className="rich-code-split">
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
        <div className="rich-diff">
          {lines.map((line, i) => (
            <div key={i} className="rich-diff-row" data-kind={line.kind}>
              <div className="rich-code-line">
                <span>{line.old}</span>
                <span>{line.next}</span>
                <code>
                  {line.kind === "added"
                    ? "+"
                    : line.kind === "removed"
                      ? "−"
                      : " "}{" "}
                  {line.text}
                </code>
              </div>
              <details>
                <summary>
                  {notes[i] ? "Edit note" : "Add note"} on line{" "}
                  {line.next || line.old}
                </summary>
                <label htmlFor={`${id}-${i}`}>Your review note</label>
                <textarea
                  id={`${id}-${i}`}
                  maxLength={2000}
                  value={typeof notes[i] === "string" ? notes[i] : ""}
                  onChange={(e) => note(i, e.target.value)}
                />
              </details>
            </div>
          ))}
        </div>
      )}
      <p className="local-note">
        {storageOK
          ? "Review notes stay in this tab until it closes."
          : "Storage is unavailable; notes last for this view."}{" "}
        Notes are not sent to Vaelo.
      </p>
    </>
  );
}

export function QRLink({ url }) {
  const [image, setImage] = useState("");
  const [problem, setProblem] = useState("");
  useEffect(() => {
    let active = true;
    setImage("");
    setProblem("");
    import("qrcode")
      .then((m) =>
        (m.default || m).toDataURL(url, {
          margin: 4,
          width: 240,
          errorCorrectionLevel: "M",
          color: { dark: "#16110f", light: "#ffffff" },
        }),
      )
      .then((value) => {
        if (active) setImage(value);
      })
      .catch(() => {
        if (active) setProblem("QR code couldn’t be created. Use the link.");
      });
    return () => {
      active = false;
    };
  }, [url]);
  return (
    <div className="rich-qr">
      {image ? (
        <img
          src={image}
          alt="QR code for the link below"
          width="240"
          height="240"
        />
      ) : (
        <p role="status">{problem || "Preparing QR code…"}</p>
      )}
      <a href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>
      <p className="local-note">
        Opens this address; it does not transfer your account or private
        conversation.
      </p>
    </div>
  );
}
function Model({ data }) {
  const [state, setState] = useState("idle");
  const element = useRef(null);
  useEffect(() => {
    const el = element.current;
    if (!el) return;
    const fail = () => setState("error");
    el.addEventListener("error", fail);
    return () => el.removeEventListener("error", fail);
  }, [state]);
  async function load() {
    setState("loading");
    try {
      await import("@google/model-viewer");
      setState("ready");
    } catch {
      setState("error");
    }
  }
  return (
    <>
      {state === "idle" ? (
        <button className="block-tool" onClick={load}>
          Load 3D model
        </button>
      ) : state === "loading" ? (
        <p role="status">Preparing 3D viewer…</p>
      ) : state === "error" ? (
        <p role="status">The model couldn’t load on this device.</p>
      ) : (
        <model-viewer
          ref={element}
          src={data.src}
          alt={data.alt}
          camera-controls
          touch-action="pan-y"
          loading="lazy"
        />
      )}
      <p>{data.alt}</p>
      <a href={data.src} target="_blank" rel="noopener noreferrer">
        Open model file
      </a>
    </>
  );
}

function Receipt({ data }) {
  const format = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: data.currency,
  });
  const total = data.items.reduce((sum, item) => sum + item.amount, 0);
  return (
    <div className="rich-receipt">
      <dl>
        {data.items.map((x, i) => (
          <div key={i}>
            <dt>{x.label}</dt>
            <dd>{format.format(x.amount)}</dd>
          </div>
        ))}
        <div className="rich-total">
          <dt>Total of listed items</dt>
          <dd>{format.format(total)}</dd>
        </div>
      </dl>
      <p className="local-note">
        Calculated locally from the listed amounts. This is a summary, not proof
        of payment.
      </p>
    </div>
  );
}
export function RichUI({ source, enabled, stateKey }) {
  const data = useMemo(() => parseRichUI(source), [source]);
  const [original, setOriginal] = useState(false);
  if (!data || !enabled) return <pre className="block-plain">{source}</pre>;
  return (
    <section className="rich-block" aria-label={data.title || data.type}>
      <header className="rich-toolbar">
        <strong>{data.title || data.type.replaceAll("-", " ")}</strong>
        <button className="block-tool" onClick={() => setOriginal(!original)}>
          {original ? "Show interactive view" : "Show original data"}
        </button>
      </header>
      {original ? (
        <pre className="block-plain">{source}</pre>
      ) : (
        <>
          {["overview", "widgets", "integrations"].includes(data.type) && (
            <Overview data={data} />
          )}
          {data.type === "steps" && <StepPlayer items={data.items} />}
          {data.type === "graph" && <Graph data={data} />}
          {data.type === "files" && <Files branch={fileTree(data.paths)} />}
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
        </>
      )}
    </section>
  );
}
