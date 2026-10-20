import React, { useState } from 'react';
import { weatherIcon } from '../../lib/weather.js';
import './weather.css';

export function Weather({ forecast }) {
  if (forecast.detailed) return <DetailedWeather forecast={forecast} />;
  return <section className="weather-bento" aria-label="Weather forecast">
    <header><span>{forecast.title}</span><small>Forecast · Highs & lows</small></header>
    <div className="weather-grid">{forecast.periods.map((period, i) => <article className="weather-period" key={`${period.label}-${i}`}>
      <div className="weather-period-top"><h3>{period.label}</h3><span className="weather-icon" aria-hidden="true">{weatherIcon(period.condition)}</span></div>
      {period.condition && <p className="weather-condition">{period.condition}</p>}
      <dl>{period.high && <div><dt>High</dt><dd>{period.high}</dd></div>}{period.low && <div><dt>Low</dt><dd>{period.low}</dd></div>}</dl>
    </article>)}</div>
  </section>;
}

const dateLabel = value => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const clock = value => {
  if (!value) return '—';
  const [hour, minute] = value.slice(11,16).split(':').map(Number);
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, '0')}` : ''} ${hour < 12 ? 'AM' : 'PM'}`;
};
const rounded = value => value == null ? '—' : Math.round(value);
function Icon({ condition, isDay = true }) {
  return <span className="weather-icon" aria-hidden="true">{!isDay && /clear|partly/i.test(condition) ? '🌙' : weatherIcon(condition)}</span>;
}

function DetailedWeather({ forecast: f }) {
  const weekly = f.view === 'week' || f.view === 'range';
  const [selected, setSelected] = useState(weekly ? null : 0);
  const overview = weekly && selected === null;
  const p = f.periods[Math.min(selected ?? 0, f.periods.length - 1)];
  const current = p.label === f.current?.time.slice(0,10) ? f.current : null;
  const temp = value => value == null ? '—' : `${rounded(value)}${f.unit}`;
  const hours = p.hours.filter(h => p.label !== f.localTime.slice(0,10) || h.time >= f.localTime.slice(0,13) + ':00');
  const points = hours.filter(h => h.temperature != null);
  const low = Math.min(...points.map(h => h.temperature)), high = Math.max(...points.map(h => h.temperature));
  // The curve scrolls with the hour columns (6rem apart, 5.5rem wide), so each point sits over its own hour.
  const columns = hours.length, step = 96;
  const path = hours.flatMap((h,i) => h.temperature == null ? [] : [`${i * step + 44},${36 - (h.temperature-low) * 28 / Math.max(1,high-low)}`]).join(' ');
  const metrics = [
    ['Rain chance', p.rain == null ? null : `${rounded(p.rain)}%`],
    [current ? 'Wind' : 'Max wind', (current?.wind ?? p.wind) == null ? null : `${rounded(current?.wind ?? p.wind)} ${f.windUnit}`],
    ['Humidity', current?.humidity == null ? null : `${rounded(current.humidity)}%`],
    ['UV index', p.uv == null ? null : p.uv],
    ['Sunrise', p.sunrise ? clock(p.sunrise) : null],
    ['Sunset', p.sunset ? clock(p.sunset) : null],
  ].filter(([,v]) => v !== null);
  return <section className="weather-bento weather-detailed" aria-label={`Weather for ${f.title}`}>
    <header><div><h2>{f.title}</h2><p>{overview ? `${dateLabel(f.periods[0].label)} – ${dateLabel(f.periods.at(-1).label)}` : dateLabel(p.label)}</p></div><small>{overview ? `${f.periods.length}-day forecast` : current ? 'Current conditions' : 'Daily forecast'}</small></header>
    {overview && <div className="weather-grid weather-week-grid" aria-label="Weekly forecast">{f.periods.map(day => <article className="weather-period" key={day.label}>
      <div className="weather-period-top"><h3>{dateLabel(day.label)}</h3><Icon condition={day.condition} /></div>
      <p className="weather-condition">{day.condition || 'Conditions unavailable'}</p>
      <dl><div><dt>High</dt><dd>{temp(day.high)}</dd></div><div><dt>Low</dt><dd>{temp(day.low)}</dd></div></dl>
      {day.rain != null && <small>{rounded(day.rain)}% rain</small>}
    </article>)}</div>}
    {!overview && <><div className="weather-now">
      <Icon condition={current?.condition || p.condition} isDay={current?.isDay ?? true} />
      <div><div className="weather-temperature">{temp(current?.temperature ?? p.high)}</div><p>{current?.condition || p.condition || 'Conditions unavailable'}</p>{current?.feels != null && <small>Feels like {temp(current.feels)}</small>}</div>
      <dl className="weather-range"><div><dt>High</dt><dd>{temp(p.high)}</dd></div><div><dt>Low</dt><dd>{temp(p.low)}</dd></div></dl>
    </div>
    <dl className="weather-metrics">{metrics.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {hours.length > 0 && <section className="weather-hourly" aria-label="Hourly forecast"><h3>Hourly forecast</h3>
      <div className="weather-hours-scroll" tabIndex={0} aria-label="Scroll hourly forecast">
      {points.length > 1 && <svg className="weather-curve" style={{ width: `${columns * 6 - .5}rem` }} viewBox={`0 0 ${columns * step - 8} 42`} preserveAspectRatio="none" role="img" aria-label={`Hourly temperatures from ${temp(points[0].temperature)} to ${temp(points.at(-1).temperature)}`}><polyline points={path} fill="none" vectorEffect="non-scaling-stroke" /></svg>}
      <div className="weather-hours">{hours.map(h =><div className="weather-hour" key={h.time}><time dateTime={h.time}>{clock(h.time)}</time><Icon condition={h.condition} isDay={h.isDay} /><strong>{temp(h.temperature)}</strong><small>{h.condition || '—'}</small>{h.rain != null && <small>{rounded(h.rain)}% rain</small>}</div>)}</div>
      </div>
    </section>}
    </>}
    {f.periods.length > 1 && <div className="weather-days" role="group" aria-label="Choose forecast day">{weekly && <button aria-pressed={overview} onClick={() => setSelected(null)}>{f.view === 'week' ? 'Week overview' : 'Forecast overview'}</button>}{f.periods.map((day,i) => <button key={day.label} aria-pressed={i === selected} onClick={() => setSelected(i)}><span>{dateLabel(day.label)}</span><Icon condition={day.condition} /><span>{temp(day.high)} / {temp(day.low)}</span></button>)}</div>}
    <footer><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a><span>Model forecast · {f.timezone}</span><span>{!overview && current ? `Conditions at ${clock(current.time)} · ` : ''}Retrieved {dateLabel(f.retrieved.slice(0,10))}, {clock(f.retrieved)} UTC</span></footer>
  </section>;
}
