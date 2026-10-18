import { SeriesChart } from "./SeriesChart.jsx";
import { stackedSeries } from "../../lib/rich-ui.js";
import React, { useId, useMemo, useState } from 'react';
import { usePhone } from '../../lib/use-phone.js';
import { chartData, compactNumber, lineGeometry, temporalColumn } from '../../lib/charts.js';
import { barScale, smoothChartPath } from '../../lib/output-redesign.js';

const COLLAPSED_ROWS = 8;

export function Chart({ columns, rows, plan, stackedDefault = false }) {
  const [choice, setColumn] = useState(plan.values[0]);
  const column = plan.values.includes(choice) ? choice : plan.values[0];
  const data = useMemo(() => chartData(columns, rows, column, plan.label), [columns, rows, column, plan.label]);
  const canLine = temporalColumn(columns[plan.label], data.points);
  const [chosenKind, setKind] = useState(null);
  const kind = canLine ? chosenKind || 'line' : 'bar';
  const [expanded, setExpanded] = useState(false);
  const [reading, setReading] = useState(null);
  const stacked = useMemo(() => stackedSeries(columns, rows, plan.values, plan.label), [columns, rows, plan.values, plan.label]);
  const [stackedView, setStackedView] = useState(stackedDefault && !!stacked);
  const shown = expanded ? data.points : data.points.slice(0, COLLAPSED_ROWS);
  const scale = barScale(data.max);
  const unit = data.finite.every(point => /%\s*$/.test(point.text)) ? '%' : '';
  return <div className="chart">
    <div className="chart-controls">
      {plan.values.length > 1 && <label className="chart-column">Measure <select aria-label="Column to chart" value={column} onChange={e => setColumn(Number(e.target.value))}>
        {plan.values.map(i => <option key={i} value={i}>{columns[i]}</option>)}
      </select></label>}
      {canLine && <div className="chart-pick" role="group" aria-label="Chart type">
        {['line', 'bar'].map(type => <button key={type} className="block-tool" aria-pressed={kind === type} onClick={() => setKind(type)}>{type === 'line' ? 'Line' : 'Bars'}</button>)}
      </div>}
      {stacked && <button className="block-tool" aria-pressed={stackedView} onClick={() => setStackedView(v => !v)}>{stackedView ? "Single series" : "Stacked breakdown"}</button>}
    </div>
    <p className="chart-summary">{data.summary}</p>
    {stackedView && stacked ? <SeriesChart data={stacked} /> : data.finite.length > 0 && (kind === 'line' ? <LineChart key={column} points={data.points} label={columns[column]} /> : <>
      <div className="chart-viewport" role="region" aria-label={`${columns[column]} bar chart. ${data.signed ? 'Negative values extend left of zero.' : 'Bars start at zero.'}`} tabIndex={0}>
        <div className="chart-axis"><span>{data.signed ? `−${compactNumber(scale)}${unit}` : '0'}</span>{data.signed && <span>0</span>}<span>{data.signed ? '+' : ''}{compactNumber(scale)}{unit}</span></div>
        <ol className="chart-bars" onPointerLeave={() => setReading(null)}>
          {shown.map((point, i) => <React.Fragment key={point.index}>
            {point.section && point.section !== shown[i - 1]?.section && <li className="chart-section">{point.section}</li>}
            <li className="chart-row" data-dim={reading && reading.index !== point.index || undefined} tabIndex={0} onFocus={() => setReading(point)} onBlur={() => setReading(null)} onPointerEnter={() => setReading(point)}>
              <span className="chart-label">{point.label || `Row ${point.index + 1}`}</span>
              <span className="chart-track" data-signed={data.signed || undefined}><span className="chart-bar" aria-hidden="true" data-negative={point.value < 0 || undefined} style={{'--w': `${Number.isFinite(point.value) ? Math.abs(point.value) / scale * (data.signed ? 50 : 100) : 0}%`}} /><span className="chart-tip-value" data-negative={point.value < 0 || undefined} data-edge={Number.isFinite(point.value) && Math.abs(point.value) / scale > .8 ? point.value < 0 ? 'left' : 'right' : undefined} style={{left:`${Number.isFinite(point.value) ? (data.signed ? 50 + point.value / scale * 50 : point.value / scale * 100) : data.signed ? 50 : 0}%`}}>{point.text || 'No value'}</span></span>
            </li>
          </React.Fragment>)}
        </ol>
      </div>
      <div className="chart-reading" aria-live="polite">{reading ? `${reading.label}: ${reading.text}. ${Number.isFinite(reading.value) ? `${reading.value < 0 ? 'Below' : 'Above'} zero.` : 'No numeric value was supplied.'}` : 'Hover or focus a row to read its value.'}</div>
      {data.points.length > COLLAPSED_ROWS && <div className="chart-footer"><span className="local-note">Showing {shown.length} of {data.points.length} · scale uses every row</span><button className="block-tool" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? `Show first ${COLLAPSED_ROWS}` : `Show all ${data.points.length}`}</button></div>}
    </>)}
  </div>;
}

const WIDE = { view: { width: 640, height: 182 }, box: { left: 46, right: 628, top: 14, bottom: 150 }, labels: 6 };
const PHONE_LAYOUT = { view: { width: 360, height: 210 }, box: { left: 38, right: 346, top: 14, bottom: 176 }, labels: 3 };

// Roughly six evenly spaced x labels so a long series never crowds its axis.
function labelIndexes(count, max) {
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => Math.round(i * step));
}

function LineChart({ points, label }) {
  const id = useId();
  const { view: VIEW, box: BOX, labels } = usePhone() ? PHONE_LAYOUT : WIDE;
  const geometry = useMemo(() => lineGeometry(points, BOX), [points, BOX]);
  const [selection, setSelection] = useState(points.length - 1);
  const index = Math.min(selection, points.length - 1);
  const selected = geometry.points[index];
  const dots = points.length <= 30;

  const nearest = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * VIEW.width;
    let best = 0;
    geometry.points.forEach((point, i) => { if (Math.abs(point.x - x) < Math.abs(geometry.points[best].x - x)) best = i; });
    setSelection(best);
  };
  const onKey = event => {
    const last = points.length - 1;
    const next = { ArrowLeft: index - 1, ArrowDown: index - 1, ArrowRight: index + 1, ArrowUp: index + 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setSelection(Math.max(0, Math.min(last, next)));
  };
  const labelAt = new Set(labelIndexes(points.length, labels));
  const tipLeft = selected ? Math.min(88, Math.max(12, selected.x / VIEW.width * 100)) : 50;

  return <div className="line-chart">
    <div className="line-readout" aria-live="polite"><strong>{selected?.text || 'No value'}</strong><span>{selected?.label} · {label}</span></div>
    <div
      className="line-stage"
      tabIndex={0}
      role="group"
      aria-label={`${label} over ${points.length} rows. Use the arrow keys to read each value.`}
      onPointerMove={nearest}
      onPointerDown={nearest}
      onKeyDown={onKey}
    >
      <svg className="line-plot" viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} role="img" aria-labelledby={id}>
        <title id={id}>{`${label} over ${points.length} rows. Points follow the current table order; gaps represent missing values.`}</title>
        {geometry.ticks.map((tick, i) => <g key={i}><line x1={BOX.left} x2={BOX.right} y1={tick.y} y2={tick.y} className="line-grid" data-base={i === 0 || undefined} /><text x={BOX.left - 8} y={tick.y + 4} textAnchor="end" className="line-tick">{compactNumber(tick.value)}</text></g>)}
        {geometry.paths.map((path, i) => {
          const coords = path.split(' ');
          const first = coords[0].split(',')[0], last = coords.at(-1).split(',')[0];
          return <g key={i}>
            {coords.length > 1 && <path className="line-area" d={`${smoothChartPath(path)} L ${last} ${BOX.bottom} L ${first} ${BOX.bottom} Z`} />}
            <path d={smoothChartPath(path)} className="line-path" fill="none" />
          </g>;
        })}
        {geometry.points.map((point, i) => point.y != null && (dots || i === index)
          ? <circle key={i} cx={point.x} cy={point.y} r={i === index ? 5 : 2.75} className="line-point" data-active={i === index || undefined} /> : null)}
        {selected && <line x1={selected.x} x2={selected.x} y1={BOX.top} y2={BOX.bottom} className="line-guide" />}
        {geometry.points.map((point, i) => labelAt.has(i) && <text key={i} x={point.x} y={BOX.bottom + 20} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className="line-tick" data-active={i === index || undefined}>{String(point.label).slice(0, 14)}</text>)}
      </svg>
      {selected && <div className="line-tip" style={{ left: `${tipLeft}%`, top: `${Math.max(0, (selected.y ?? BOX.bottom) / VIEW.height * 100 - 4)}%` }} aria-hidden="true">
        <span>{selected.label}</span><strong>{selected.text || 'No value'}</strong>
      </div>}
    </div>
    <p className="sr-only" aria-live="polite">{selected?.label}: {selected?.text || 'No value'}. All {points.length} rows are plotted in table order.</p>
    <div className="line-stats"><span>Low<b>{points.filter(p => Number.isFinite(p.value)).reduce((a, b) => !a || b.value < a.value ? b : a, null)?.text || '—'}</b></span><span>High<b>{points.filter(p => Number.isFinite(p.value)).reduce((a, b) => !a || b.value > a.value ? b : a, null)?.text || '—'}</b></span><span>Change<b>{(() => { const valid = points.filter(p => Number.isFinite(p.value)); if (valid.length < 2) return '—'; const first = valid[0].value, last = valid.at(-1).value; return first === 0 ? `${compactNumber(last - first)} absolute` : `${((last - first) / Math.abs(first) * 100).toFixed(1)}%`; })()}</b></span></div>
  </div>;
}
