import React, { useMemo, useState } from 'react';
import { numberSeries, scaleSeries } from '../../lib/intelligent-ui.js';

export function NumberExplorer({ columns, rows }) {
  const available = useMemo(() => columns.map((_, i) => i).filter(i => numberSeries(rows, i)), [columns, rows]);
  const [choice, setColumn] = useState(available[0] ?? 0);
  const column = available.includes(choice) ? choice : available[0] ?? 0;
  const [factor, setFactor] = useState('1');
  const series = scaleSeries(numberSeries(rows, column), factor);
  if (!available.length) return null;
  const format = value => `${series?.unit.startsWith('%') ? '' : series?.unit || ''}${value.toLocaleString(undefined, { maximumSignificantDigits: 8 })}${series?.unit.endsWith('%') ? '%' : ''}`;
  return <details className="local-explorer">
    <summary>Explore numbers</summary>
    <p className="local-note">A local what-if: multiplies this column by your factor. It does not infer a forecast or change Vaelo’s answer.</p>
    <div className="local-controls">
      <label>Column <select value={column} onChange={e => setColumn(Number(e.target.value))}>
        {available.map(i => <option key={i} value={i}>{columns[i]}</option>)}
      </select></label>
      <label>Multiply by <input type="number" min="-1000000" max="1000000" step="any" value={factor} onChange={e => setFactor(e.target.value)} /></label>
      <button className="block-tool" onClick={() => setFactor('1')}>Reset factor</button>
    </div>
    {!series ? <p role="status">Enter a finite factor between −1,000,000 and 1,000,000.</p> : <>
      <dl className="local-numbers" aria-live="polite">
        <div><dt>Lowest × factor</dt><dd>{format(Math.min(...series.numbers))}</dd></div>
        <div><dt>Highest × factor</dt><dd>{format(Math.max(...series.numbers))}</dd></div>
      </dl>
      <ol className="local-results">{series.numbers.map((value, i) => <li key={i}>
        <span>{columns.length > 1 && column !== 0 ? rows[i][0] : `Row ${i + 1}`}</span><output>{format(value)}</output>
      </li>)}</ol>
    </>}
  </details>;
}
