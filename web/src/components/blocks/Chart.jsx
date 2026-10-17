import { SeriesChart } from "./SeriesChart.jsx";
import { stackedSeries } from "../../lib/rich-ui.js";
import React, { useId, useMemo, useState } from 'react';
import { chartData, compactNumber, lineGeometry, temporalColumn } from '../../lib/charts.js';

export function Chart({ columns, rows, plan }) {
  const [choice, setColumn] = useState(plan.values[0]);
  const column = plan.values.includes(choice) ? choice : plan.values[0];
  const data = useMemo(() => chartData(columns, rows, column, plan.label), [columns, rows, column, plan.label]);
  const canLine = temporalColumn(columns[plan.label], data.points);
  const [chosenKind, setKind] = useState(null);
  const kind = canLine ? chosenKind || 'line' : 'bar';
  const [expanded, setExpanded] = useState(false);
  const stacked = useMemo(() => stackedSeries(columns, rows, plan.values, plan.label), [columns, rows, plan.values, plan.label]);
  const [stackedView, setStackedView] = useState(false);
  const shown = expanded ? data.points : data.points.slice(0, 12);
  return <div className="chart">
    <div className="chart-controls">
      {plan.values.length > 1 && <label className="chart-column">Measure <select aria-label="Column to chart" value={column} onChange={e => setColumn(Number(e.target.value))}>
        {plan.values.map(i => <option key={i} value={i}>{columns[i]}</option>)}
      </select></label>}
      {stacked && <button className="block-tool" aria-pressed={stackedView} onClick={() => setStackedView(v => !v)}>{stackedView ? "Single series" : "Stacked breakdown"}</button>}
      {canLine && <div className="chart-pick" role="group" aria-label="Chart type">
        {['line', 'bar'].map(type => <button key={type} className="block-tool" aria-pressed={kind === type} onClick={() => setKind(type)}>{type === 'line' ? 'Line' : 'Bars'}</button>)}
      </div>}
    </div>
    <p className="chart-summary">{data.summary}</p>
    {stackedView && stacked ? <SeriesChart data={stacked} /> : data.finite.length > 0 && (kind === 'line' ? <LineChart key={column} points={data.points} label={columns[column]} /> : <>
      <p className="chart-scale">{data.signed ? 'Negative values extend left of zero; positive values extend right.' : 'Bars start at zero.'} Scale uses all {data.points.length} rows, including those below.</p>
      <div className="chart-viewport" role="region" aria-label={`${columns[column]} bar chart`} tabIndex={0}>
        <ol className="chart-bars">
          {shown.map((point, i) => <React.Fragment key={point.index}>
            {point.section && point.section !== shown[i - 1]?.section && <li className="chart-section">{point.section}</li>}
            <li className="chart-row">
              <span className="chart-label">{point.label || `Row ${point.index + 1}`}</span>
              <span className="chart-track" data-signed={data.signed || undefined} aria-hidden="true"><span className="chart-bar" data-negative={point.value < 0 || undefined} style={{'--w': `${Number.isFinite(point.value) ? Math.abs(point.value) / data.max * (data.signed ? 50 : 100) : 0}%`}} /></span>
              <span className="chart-value">{point.text || 'No value'}</span>
            </li>
          </React.Fragment>)}
        </ol>
      </div>
      {data.points.length > 12 && <div className="chart-footer"><span className="local-note">Showing {shown.length} of {data.points.length} rows</span><button className="block-tool" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show first 12' : `Show all ${data.points.length} rows`}</button></div>}
    </>)}
  </div>;
}

function LineChart({ points, label }) {
  const id = useId();
  const geometry = useMemo(() => lineGeometry(points), [points]);
  const [selection, setSelection] = useState(0);
  const selected = geometry.points[Math.min(selection, points.length - 1)];
  return <div className="line-chart">
    <svg className="line-plot" viewBox="0 0 640 244" role="img" aria-labelledby={id}>
      <title id={id}>{`${label} over ${points.length} rows. Points follow the current table order; gaps represent missing values.`}</title>
      {geometry.ticks.map((tick, i) => <g key={i}><line x1="72" x2="622" y1={tick.y} y2={tick.y} className="line-grid" /><text x="62" y={tick.y + 4} textAnchor="end" className="line-tick">{compactNumber(tick.value)}</text></g>)}
      {geometry.paths.map((path, i) => <polyline key={i} points={path} className="line-path" />)}
      {geometry.points.map((point, i) => point.y != null && geometry.points[i - 1]?.y == null && geometry.points[i + 1]?.y == null
        ? <circle key={i} cx={point.x} cy={point.y} r="3" className="line-point" /> : null)}
      {selected?.y != null && <circle cx={selected.x} cy={selected.y} r="5" className="line-point" />}
    </svg>
    <div className="line-labels"><span>{points[0]?.label}</span><span>{points.at(-1)?.label}</span></div>
    <label className="line-inspect">Inspect a row <input type="range" min="0" max={points.length - 1} value={Math.min(selection, points.length - 1)} onChange={e => setSelection(Number(e.target.value))} aria-valuetext={`${selected?.label}: ${selected?.text || 'No value'}`} /></label>
    <p className="line-reading" aria-live="polite"><span>{selected?.label}</span><strong>{selected?.text || 'No value'}</strong></p>
    <p className="local-note">All {points.length} rows are shown in table order. Use the slider or arrow keys for exact values.</p>
  </div>;
}
