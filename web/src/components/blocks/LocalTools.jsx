import React, { useMemo, useState } from "react";
import {
  SlidersHorizontal,
  Info,
  ArrowCounterClockwise,
} from "@phosphor-icons/react";
import { numberSeries, scaleSeries } from "../../lib/intelligent-ui.js";

export function NumberExplorer({ columns, rows }) {
  const available = useMemo(
    () => columns.map((_, i) => i).filter((i) => numberSeries(rows, i)),
    [columns, rows],
  );
  const [choice, setColumn] = useState(available[0] ?? 0);
  const column = available.includes(choice) ? choice : (available[0] ?? 0);
  const [factor, setFactor] = useState("1");
  const original = numberSeries(rows, column);
  const series = scaleSeries(original, factor);
  if (!available.length) return null;
  const total = series?.numbers.reduce((sum, value) => sum + value, 0);
  const suppliedTotal = original.numbers.reduce((sum, value) => sum + value, 0);
  const max = Math.max(
    1,
    ...original.numbers.map(Math.abs),
    ...(series?.numbers || []).map(Math.abs),
  );
  const format = (value) =>
    `${original.unit.startsWith("%") ? "" : original.unit || ""}${value.toLocaleString(undefined, { maximumSignificantDigits: 8 })}${original.unit.endsWith("%") ? "%" : ""}`;
  const canTotal =
    !original.unit.endsWith("%") &&
    Number.isFinite(total) &&
    Number.isFinite(suppliedTotal);
  return (
    <section className="local-explorer" aria-label="Explore numbers">
      <header className="explorer-head">
        <SlidersHorizontal size={19} />
        <div>
          <h4>What if spending changes?</h4>
          <p>Scales the supplied amounts on this device</p>
        </div>
        <div className="explorer-columns" aria-label="Column to scale">
          {available.map((i) => (
            <button
              key={i}
              aria-pressed={i === column}
              onClick={() => setColumn(i)}
            >
              {columns[i]}
            </button>
          ))}
        </div>
      </header>
      <div className="explorer-adjust">
        <label className="explorer-factor-label">
          ×
          <input
            aria-label="Factor"
            className="explorer-factor"
            type="number"
            min="-1000000"
            max="1000000"
            step="any"
            value={factor}
            onChange={(e) => setFactor(e.target.value)}
          />
        </label>
        <div>
          <input
            aria-label="Adjust factor"
            type="range"
            min="0"
            max="3"
            step="0.05"
            value={Math.max(0, Math.min(3, Number(factor) || 0))}
            aria-valuetext={`${factor || 0} times the original amounts`}
            onChange={(e) => setFactor(e.target.value)}
          />
          <div className="explorer-presets">
            {[
              ["−10%", ".9"],
              ["+10%", "1.1"],
              ["+25%", "1.25"],
              ["×2", "2"],
            ].map(([label, value]) => (
              <button
                key={value}
                aria-pressed={Number(factor) === Number(value)}
                onClick={() => setFactor(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {!series ? (
        <p className="explorer-invalid" role="status">
          Enter a finite factor between −1,000,000 and 1,000,000.
        </p>
      ) : (
        <>
          <div className="explorer-rows">
            <div className="explorer-row explorer-labels">
              <span>Category</span>
              <span />
              <span>Supplied</span>
              <span>× factor</span>
            </div>
            {series.numbers.map((value, i) => (
              <div className="explorer-row" key={i}>
                <b>
                  {columns.length > 1 && column !== 0
                    ? rows[i][0]
                    : `Row ${i + 1}`}
                </b>
                <span className="explorer-ghost" aria-hidden="true">
                  <i
                    style={{
                      width: `${(Math.abs(original.numbers[i]) / max) * 100}%`,
                    }}
                  />
                  <i style={{ width: `${(Math.abs(value) / max) * 100}%` }} />
                </span>
                <span>{format(original.numbers[i])}</span>
                <output>{format(value)}</output>
              </div>
            ))}
          </div>
          {canTotal && (
            <dl className="explorer-totals" aria-live="polite">
              <div>
                <dt>Supplied total</dt>
                <dd>{format(suppliedTotal)}</dd>
              </div>
              <div>
                <dt>New total</dt>
                <dd>{format(total)}</dd>
              </div>
              <div>
                <dt>Difference</dt>
                <dd>
                  {total > suppliedTotal ? "+" : ""}
                  {format(total - suppliedTotal)}
                </dd>
              </div>
            </dl>
          )}
        </>
      )}
      <footer className="explorer-foot">
        <Info size={16} />
        <span>
          A local what-if, not a forecast. Vaelo’s answer is unchanged.
        </span>
        <button onClick={() => setFactor("1")}>
          <ArrowCounterClockwise size={15} />
          Reset to ×1
        </button>
      </footer>
    </section>
  );
}
