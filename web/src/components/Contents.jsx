import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import "./contents.css";

/* A document's contents, set in the margin. A paper plane travels a fine
   rule to the section you're reading; behind it the rule is inked in.
   Shown only for a document with at least three headings and room beside
   it. */

const RAIL_X = 5;
const INDENT = 12;
const LABEL_GAP = 14;
const OFFSET = 72;
/* How far the plane must back up before it turns, so scroll jitter can't flip it */
const TURN_SLACK = 2;
const PLANE = "M12 2 20.5 21 12 17.5 3.5 21z";

const still = () =>
  document.documentElement.dataset.motion === "reduce" ||
  matchMedia("(prefers-reduced-motion: reduce)").matches;

function buildPath(nodes) {
  const points = [{ x: nodes[0].x, y: 0 }, nodes[0]];
  for (let i = 1; i < nodes.length; i++) {
    const from = nodes[i - 1];
    const to = nodes[i];
    if (from.x !== to.x) {
      const bend = (to.y - from.y) * 0.3;
      points.push({ x: from.x, y: from.y + bend }, { x: to.x, y: to.y - bend });
    }
    points.push(to);
  }
  return points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
}

/* The rule only runs downward, so y rises steadily along its length */
function lengthAtY(path, total, y) {
  let lo = 0;
  let hi = total;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (path.getPointAtLength(mid).y < y) lo = mid;
    else hi = mid;
  }
  return hi;
}

export function Contents({ article, content }) {
  const prefix = useId().replace(/[^\w-]/g, "");
  const [items, setItems] = useState([]);
  const [geometry, setGeometry] = useState(null);
  const [reached, setReached] = useState(1);
  const list = useRef(null);
  const rows = useRef([]);
  const path = useRef(null);
  const ink = useRef(null);
  const plane = useRef(null);
  const hole = useRef(null);
  const turn = useRef(null);
  const motion = useRef({ at: 0, target: 0, frame: 0, facing: 1, turnFrom: 0, heading: 180 });
  const lengths = useRef([]);
  const total = useRef(0);
  const pinned = useRef(null);
  const intent = useRef(false);
  const placed = useRef(false);

  /* The headings are read from the rendered page, and given ids to jump to */
  useLayoutEffect(() => {
    const root = article.current;
    if (!root) return;
    const heads = [...root.querySelectorAll("h1, h2, h3")];
    const top = Math.min(...heads.map((h) => Number(h.tagName[1])));
    setItems(
      heads.map((h, i) => {
        if (!h.id) h.id = `${prefix}-part-${i + 1}`;
        return {
          id: h.id,
          label: h.textContent.trim(),
          depth: Math.min(1, Number(h.tagName[1]) - top),
        };
      }),
    );
  }, [article, content, prefix]);

  const scroller = useCallback(() => article.current?.closest(".ws-body"), [article]);

  const pose = useCallback((l) => {
    const p = path.current;
    const length = total.current;
    if (!p || !length) return;
    const m = motion.current;
    const at = p.getPointAtLength(l);
    const behind = p.getPointAtLength(Math.max(0, l - 1));
    const ahead = p.getPointAtLength(Math.min(length, l + 1));
    plane.current.style.transform = `translate(${at.x}px, ${at.y}px)`;
    hole.current.setAttribute("cx", at.x);
    hole.current.setAttribute("cy", at.y);
    const angle =
      (Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180) / Math.PI + 90 + (m.facing < 0 ? 180 : 0);
    /* Unwrapped against the current heading, so a turn takes the short way round */
    m.heading = angle + 360 * Math.round((m.heading - angle) / 360);
    turn.current.style.transform = `rotate(${m.heading}deg)`;
    ink.current.style.strokeDashoffset = `${length - l}`;
    setReached(lengths.current.filter((n) => n <= l + 0.5).length);
  }, []);

  /* The plane eases toward where the reader is: quick to start, slow to
     settle, never overshooting. */
  const travel = useCallback(() => {
    const m = motion.current;
    cancelAnimationFrame(m.frame);
    if (still()) {
      m.at = m.target;
      pose(m.at);
      return;
    }
    const step = () => {
      const gap = m.target - m.at;
      m.at = Math.abs(gap) < 0.3 ? m.target : m.at + gap * 0.14;
      pose(m.at);
      if (m.at !== m.target) m.frame = requestAnimationFrame(step);
    };
    m.frame = requestAnimationFrame(step);
  }, [pose]);

  const aim = useCallback(
    (next) => {
      const m = motion.current;
      if ((next - m.turnFrom) * m.facing > 0) m.turnFrom = next;
      else if (Math.abs(next - m.turnFrom) > TURN_SLACK) {
        m.facing = -m.facing;
        m.turnFrom = next;
      }
      m.target = next;
      if (!placed.current) {
        placed.current = true;
        m.at = next;
        turn.current?.style.setProperty("transition", "none");
        pose(next);
        requestAnimationFrame(() => turn.current?.style.removeProperty("transition"));
      } else travel();
    },
    [pose, travel],
  );

  const sync = useCallback(() => {
    const nodes = lengths.current;
    const box = scroller();
    if (!nodes.length || !box) return;
    /* A chosen heading holds the plane until the reader scrolls, since
       headings near the end can't scroll up to the line. */
    if (pinned.current !== null) {
      aim(nodes[pinned.current] ?? nodes[0]);
      return;
    }
    const origin = box.getBoundingClientRect().top;
    /* The reading line starts at the top and sweeps to the bottom near the
       end, so the first and last headings can both be reached. The sweep
       grows with how far you've read, so a short document still starts at
       its first heading. */
    const travel = Math.max(0, box.scrollHeight - box.clientHeight);
    const remaining = Math.max(0, travel - box.scrollTop);
    const read = travel ? box.scrollTop / travel : 1;
    const line = Math.min(OFFSET, box.scrollTop);
    const anchor = line + Math.max(0, box.clientHeight - line - remaining) * read;
    const tops = items.map((item) => {
      const el = document.getElementById(item.id);
      return el ? el.getBoundingClientRect().top - origin : Infinity;
    });
    const index = tops.findLastIndex((top) => top <= anchor);
    let next;
    if (index === -1) next = nodes[0];
    else if (index === nodes.length - 1) next = nodes[index];
    else {
      const span = tops[index + 1] - tops[index];
      const progress = span > 0 ? (anchor - tops[index]) / span : 0;
      next = nodes[index] + Math.min(1, Math.max(0, progress)) * (nodes[index + 1] - nodes[index]);
    }
    aim(next);
  }, [items, scroller, aim]);

  useLayoutEffect(() => {
    const el = list.current;
    if (!el || items.length < 3) return;
    const measure = () => {
      if (!el.offsetHeight) return;
      const nodes = items.map((item, i) => {
        const row = rows.current[i];
        return { x: RAIL_X + item.depth * INDENT, y: row ? row.offsetTop + row.offsetHeight / 2 : 0 };
      });
      setGeometry({
        nodes,
        d: buildPath(nodes),
        width: Math.max(...nodes.map((n) => n.x)) + RAIL_X + 4,
        height: el.offsetHeight,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => observer.disconnect();
  }, [items]);

  useLayoutEffect(() => {
    const p = path.current;
    if (!p || !geometry) return;
    total.current = p.getTotalLength();
    ink.current.style.strokeDasharray = `${total.current}`;
    lengths.current = geometry.nodes.map((n) => lengthAtY(p, total.current, n.y));
    placed.current = false;
    sync();
  }, [geometry, sync]);

  useEffect(() => {
    const box = scroller();
    if (!box || items.length < 3) return;
    const onIntent = () => {
      intent.current = true;
    };
    const onScroll = () => {
      if (pinned.current !== null && intent.current) pinned.current = null;
      sync();
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    box.addEventListener("wheel", onIntent, { passive: true });
    box.addEventListener("touchstart", onIntent, { passive: true });
    box.addEventListener("pointerdown", onIntent);
    addEventListener("keydown", onIntent);
    addEventListener("resize", sync);
    return () => {
      box.removeEventListener("scroll", onScroll);
      box.removeEventListener("wheel", onIntent);
      box.removeEventListener("touchstart", onIntent);
      box.removeEventListener("pointerdown", onIntent);
      removeEventListener("keydown", onIntent);
      removeEventListener("resize", sync);
    };
  }, [items, scroller, sync]);

  useEffect(() => () => cancelAnimationFrame(motion.current.frame), []);

  function select(index) {
    const el = document.getElementById(items[index].id);
    const box = scroller();
    if (!el || !box) return;
    pinned.current = index;
    intent.current = false;
    sync();
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTo({ top: top - OFFSET, behavior: still() ? "auto" : "smooth" });
  }

  if (items.length < 3) return null;
  const active = Math.max(0, reached - 1);

  return (
    <nav className="doc-contents" aria-label="Contents">
      <p className="label doc-contents-title">Contents</p>
      <ul ref={list} className="doc-contents-list">
        {geometry && (
          <svg
            className="doc-contents-rail"
            width={geometry.width}
            height={geometry.height}
            aria-hidden="true"
          >
            <path ref={path} d={geometry.d} className="doc-contents-track" />
            <path ref={ink} d={geometry.d} className="doc-contents-ink" />
            {geometry.nodes.map((node, i) => (
              <circle
                key={items[i]?.id ?? i}
                cx={node.x}
                cy={node.y}
                r={3}
                className="doc-contents-node"
                data-covered={i < reached || undefined}
              />
            ))}
            <circle ref={hole} r={5.5} className="doc-contents-hole" />
          </svg>
        )}
        {geometry && (
          <span className="doc-contents-plane" ref={plane} aria-hidden="true">
            <svg ref={turn} viewBox="0 0 24 24">
              <path d={PLANE} />
            </svg>
          </span>
        )}
        {items.map((item, i) => (
          <li
            key={item.id}
            ref={(el) => {
              rows.current[i] = el;
            }}
          >
            <button
              type="button"
              aria-current={i === active ? "location" : undefined}
              style={{ paddingLeft: RAIL_X + item.depth * INDENT + LABEL_GAP }}
              onClick={() => select(i)}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
