import React from 'react';
import { weatherIcon } from '../../lib/weather.js';
import './weather.css';

export function Weather({ forecast }) {
  return <section className="weather-bento" aria-label="Weather forecast">
    <header><span>{forecast.title}</span><small>Forecast · Highs & lows</small></header>
    <div className="weather-grid">{forecast.periods.map((period, i) => <article className="weather-period" key={`${period.label}-${i}`}>
      <div className="weather-period-top"><h3>{period.label}</h3><span className="weather-icon" aria-hidden="true">{weatherIcon(period.condition)}</span></div>
      {period.condition && <p className="weather-condition">{period.condition}</p>}
      <dl>{period.high && <div><dt>High</dt><dd>{period.high}</dd></div>}{period.low && <div><dt>Low</dt><dd>{period.low}</dd></div>}</dl>
    </article>)}</div>
  </section>;
}
