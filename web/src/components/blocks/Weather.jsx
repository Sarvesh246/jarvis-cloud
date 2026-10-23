import React, { useState } from 'react';
import { weatherIcon, isNightLabel, weatherKind } from '../../lib/weather.js';
import { WeatherGlyph, WeatherScene } from './WeatherArt.tsx';
import './weather.css';

export function Weather({ forecast }) {
  if (forecast.detailed) return <DetailedWeather key={`${forecast.view}-${forecast.periods[0].label}`} forecast={forecast} />;
  return <section className="weather-bento weather-legacy" aria-label="Weather forecast">
    <header><span>{forecast.title}</span><small>Forecast · Highs & lows</small></header>
    <div className="weather-legacy-list">{forecast.periods.map((period, i) => <div className="weather-legacy-row" key={`${period.label}-${i}`}>
      <span className="weather-icon" aria-hidden="true">{weatherIcon(period.condition, !isNightLabel(period.label))}</span>
      <div><strong>{period.label}</strong>{period.condition && <small>{period.condition}</small>}</div>
      <span>{period.high ? `High ${period.high}` : ''}{period.low ? ` · Low ${period.low}` : ''}</span>
    </div>)}</div>
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
  if (weatherKind(condition) === 'unknown') return <span className="weather-glyph" aria-hidden="true" />;
  return <WeatherGlyph kind={weatherKind(condition)} hour={isDay ? 12 : 0} />;
}

function DetailedWeather({ forecast: f }) {
  const weekly = f.view === 'week' || f.view === 'range';
  const [selected, setSelected] = useState(weekly ? null : 0);
  const overview = weekly && selected === null;
  const p = f.periods[Math.min(selected ?? 0, f.periods.length - 1)];
  const current = p.label === f.current?.time.slice(0,10) ? f.current : null;
  const temp = value => value == null ? '—' : `${rounded(value)}${f.unit}`;
  const hours = p.hours; // Keep the entire requested day, including earlier hours.
  const values = f.periods.flatMap(day => [day.low, day.high]).filter(v => v != null);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const span = Math.max(1, max - min);
  const metrics = [
    ['Rain chance', p.rain == null ? null : `${rounded(p.rain)}%`],
    [current ? 'Wind' : 'Max wind', (current?.wind ?? p.wind) == null ? null : `${rounded(current?.wind ?? p.wind)} ${f.windUnit}`],
    ['Humidity', current?.humidity == null ? null : `${rounded(current.humidity)}%`],
    ['UV index', p.uv],
    ['Sunrise', p.sunrise ? clock(p.sunrise) : null],
    ['Sunset', p.sunset ? clock(p.sunset) : null],
  ].filter(([,v]) => v != null);
  const nws = /https:\/\/(?:www\.)?weather\.gov\//i.test(f.fallback || '');
  return <section className="weather-bento weather-detailed" data-view={overview ? 'week' : 'day'} aria-label={`Weather for ${f.title}`}>
    <header><div><h2>{f.title}</h2><p>{overview ? `${dateLabel(f.periods[0].label)} – ${dateLabel(f.periods.at(-1).label)}` : dateLabel(p.label)}</p></div><small>{overview ? `${f.periods.length}-day forecast` : current ? 'Current conditions' : 'Daily forecast'}</small></header>
    {overview ? <>
      <div className="weather-week-summary"><span>{f.periods.length} days at a glance</span><span>{values.length ? `${temp(min)} – ${temp(max)}` : 'Temperatures unavailable'}</span></div>
      <div className="weather-week-list" aria-label="Weekly forecast">
        <div className="weather-week-heading" aria-hidden="true"><span>Day / conditions</span><span>Low</span><span>Temperature range</span><span>High</span><span>Rain</span></div>
        {f.periods.map((day,i) => <button className="weather-week-row" key={day.label} onClick={() => setSelected(i)} aria-label={`${dateLabel(day.label)}, ${day.condition || 'Conditions unavailable'}, low ${temp(day.low)}, high ${temp(day.high)}${day.rain != null ? `, rain ${rounded(day.rain)}%` : ''}. Show hourly forecast`}>
          <span className="weather-week-name"><Icon condition={day.condition} /><span><strong>{dateLabel(day.label)}</strong><small>{day.condition || 'Conditions unavailable'}</small></span></span>
          <span className="weather-low">{temp(day.low)}</span>
          <span className="weather-range-bar" aria-hidden="true">{day.low != null && day.high != null && <span style={{left:`${(day.low-min)/span*100}%`,width:`${Math.max(2,(day.high-day.low)/span*100)}%`}} />}</span>
          <strong>{temp(day.high)}</strong><span className="weather-rain">{day.rain == null ? '—' : `${rounded(day.rain)}%`}</span>
        </button>)}
      </div>
    </> : <>
      <div className="weather-daily-body">
        <div className="weather-scene-panel">{weatherKind(current?.condition || p.condition) !== 'unknown' && <WeatherScene kind={weatherKind(current?.condition || p.condition)} hour={current?.isDay === false ? 0 : 12} />}
          <div className="weather-now"><div className="weather-temperature">{current?.temperature != null ? temp(current.temperature) : temp(p.high)}</div><p>{current?.condition || p.condition || 'Conditions unavailable'}</p>{current?.temperature == null && p.high != null && <small>Daily high</small>}{current?.feels != null && <small>Feels like {temp(current.feels)}</small>}<span className="weather-high-low">High {temp(p.high)} · Low {temp(p.low)}</span></div>
        </div>
        <div className="weather-daily-detail"><dl className="weather-metrics">{metrics.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {hours.length > 0 ? <section className="weather-hourly" aria-label="Hourly forecast"><h3>Hourly forecast</h3>
          <div className="weather-hours-scroll" tabIndex={0} aria-label="Scroll hourly forecast"><ol className="weather-hours">{hours.map((h,i) => <li className="weather-hour" key={`${h.time}-${i}`} aria-label={`${clock(h.time)}, ${h.condition || 'Conditions unavailable'}, ${temp(h.temperature)}${h.rain != null ? `, rain ${rounded(h.rain)}%` : ''}`} title={`${clock(h.time)} · ${h.condition}`}><time dateTime={h.time}>{clock(h.time)}</time><Icon condition={h.condition} isDay={h.isDay} /><strong>{temp(h.temperature)}</strong>{h.rain != null && <small>{rounded(h.rain)}%</small>}</li>)}</ol></div>
        </section> : <p className="weather-unavailable">Hourly forecast unavailable for this date.</p>}
        </div>
      </div>
    </>}
    {!overview && f.periods.length > 1 && <nav className="weather-day-nav" aria-label="Choose forecast day">{weekly && <button onClick={() => setSelected(null)}>← {f.view === 'week' ? 'Week overview' : 'Forecast overview'}</button>}<select aria-label="Forecast day" value={selected ?? 0} onChange={e => setSelected(Number(e.target.value))}>{f.periods.map((day,i) => <option key={day.label} value={i}>{dateLabel(day.label)}</option>)}</select></nav>}
    <footer><a href={nws ? 'https://www.weather.gov/' : 'https://open-meteo.com/'} target="_blank" rel="noreferrer">{nws ? 'National Weather Service' : 'Open-Meteo'}</a><span>{f.timezone}</span><span>{!overview && current ? `Conditions at ${clock(current.time)} · ` : ''}Retrieved {dateLabel(f.retrieved.slice(0,10))}, {clock(f.retrieved)} UTC</span></footer>
  </section>;
}
