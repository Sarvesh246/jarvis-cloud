import React, { useState } from "react";

export function SeriesChart({ data }) {
  const [selected, setSelected] = useState(0);
  const point = data.points[selected];
  return (
    <section className="series-chart" aria-label="Stacked breakdown">
      <p className="local-note">
        Stacked view adds the selected series. Use it only when the amounts form
        parts of the same whole. Scale starts at zero.
      </p>
      <div className="series-legend">
        {data.columns.map((name, i) => (
          <span key={i} style={{ "--series": i }}>
            {name}
          </span>
        ))}
      </div>
      <div className="series-bars">
        {data.points.map((p, i) => (
          <button
            key={i}
            className="series-row"
            aria-pressed={selected === i}
            onClick={() => setSelected(i)}
            onPointerEnter={() => setSelected(i)}
          >
            <span>{p.label}</span>
            <span className="series-track" aria-hidden="true">
              {p.values.map((value, j) => (
                <span
                  key={j}
                  style={{
                    width: `${(value / data.max) * 100}%`,
                    "--series": j,
                  }}
                />
              ))}
            </span>
            <span>{p.original.join(" + ")}</span>
          </button>
        ))}
      </div>
      {point && (
        <dl className="series-reading" aria-live="polite">
          <dt>{point.label}</dt>
          {data.columns.map((name, i) => (
            <div key={i}>
              <dt>{name}</dt>
              <dd>{point.original[i]}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
