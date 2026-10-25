import React, { useState } from "react";
import { compactNumber } from "../../lib/charts.js";
export function SeriesChart({ data }) {
  const [selected, setSelected] = useState(0),
    [hidden, setHidden] = useState([]);
  const totals = data.points.map((p) =>
    p.values.reduce((sum, n, i) => sum + (hidden.includes(i) ? 0 : n), 0),
  );
  const max = Math.max(...totals) || 1,
    point = data.points[selected];
  return (
    <section className="series-chart" aria-label="Stacked breakdown">
      <div className="series-legend">
        {data.columns.map((name, i) => (
          <button
            key={i}
            aria-pressed={!hidden.includes(i)}
            onClick={() =>
              setHidden((prev) =>
                prev.includes(i)
                  ? prev.filter((x) => x !== i)
                  : prev.length < data.columns.length - 1
                    ? [...prev, i]
                    : prev,
              )
            }
          >
            {name}
          </button>
        ))}
      </div>
      <div className="series-columns">
        {data.points.map((p, i) => (
          <button
            key={i}
            className="series-column"
            aria-pressed={selected === i}
            aria-label={`${p.label}: ${compactNumber(totals[i])}`}
            onClick={() => setSelected(i)}
            onPointerEnter={() => setSelected(i)}
            onFocus={() => setSelected(i)}
            style={{ "--height": `${(totals[i] / max) * 100}%` }}
          >
            <b>{compactNumber(totals[i])}</b>
            <span>
              {p.values.map((value, j) => (
                <i
                  key={j}
                  style={{
                    // Flex factors below one leave unused space; large raw
                    // numbers can also exceed the browser's CSS range.
                    flex: hidden.includes(j) || !totals[i] ? 0 : value / totals[i] * 100,
                    display: hidden.includes(j) ? "none" : undefined,
                  }}
                />
              ))}
            </span>
            <small>{p.label}</small>
          </button>
        ))}
      </div>
      {point && (
        <dl className="series-reading" aria-live="polite">
          <dt>{point.label}</dt>
          {data.columns.map(
            (name, i) =>
              !hidden.includes(i) && (
                <div key={i}>
                  <dt>{name}</dt>
                  <dd>
                    {point.original[i]}{" "}
                    <small>
                      {totals[selected]
                        ? Math.round((point.values[i] / totals[selected]) * 100)
                        : 0}
                      %
                    </small>
                  </dd>
                  <i
                    className="series-share"
                    style={{
                      width: `${totals[selected] ? (point.values[i] / totals[selected]) * 100 : 0}%`,
                    }}
                  />
                </div>
              ),
          )}
        </dl>
      )}
      <p className="local-note">
        Stacked totals use the visible series. Scale starts at zero.
      </p>
    </section>
  );
}
