import React, { useLayoutEffect, useRef, useState } from 'react';
import { weatherIcon } from '../../lib/weather.js';
import './weather.css';

export function Weather({ forecast }) {
  if (forecast.detailed) return <WeatherFit><DetailedWeather forecast={forecast} /></WeatherFit>;
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

// Scale the existing design as one unit. Measure the actual conversation
// viewport, which already excludes the header and composer. Sources and
// reply actions below the card must not force its text smaller still.
const CAP = .85;

function WeatherFit({ children }) {
  const root = useRef(null);
  const content = useRef(null);
  useLayoutEffect(() => {
    const box = root.current;
    const card = content.current;
    if (!card) return;
    const conversation = card.closest('.conversation');
    const message = card.closest('.message');
    let frame;
    let disposed = false;
    let settle;
    const measure = (force = false) => {
      // Narrow columns (phones) flow at natural size and scroll; shrinking the
      // card there would only waste width and make the text unreadable.
      const wide = box.clientWidth >= 640;
      const layout = wide ? 1 / CAP : 1;
      card.style.width = `${layout * 100}%`;
      const height = card.offsetHeight;
      if (!height) return;
      const viewport = conversation?.clientHeight || window.innerHeight;
      const available = Math.max(160, viewport - 64);
      // The card is laid out wider than its column by the cap, so a scaled card
      // still fills the column. Floor keeps text legible on short viewports; the
      // conversation scrolls past the remainder instead of shrinking it further.
      const scale = wide ? Math.max(.7, Math.min(CAP, available / height)) : 1;
      box.style.height = `${Math.ceil(height * scale)}px`;
      card.style.transform = scale === 1 ? '' : `scale(${scale})`;
      card.style.left = `${(1 - scale * layout) * 50}%`;
      // Chat normally follows the very end of a reply, including its source
      // and action rows. Keep a newly fitted last card in view above the dock.
      if (conversation && message?.dataset.last === 'true') {
        const bounds = card.getBoundingClientRect();
        const view = conversation.getBoundingClientRect();
        if (force || (bounds.bottom > view.top && bounds.top < view.bottom)) {
          const tooTall = bounds.height > view.height - 48;
          if (bounds.top < view.top + 24) conversation.scrollTop -= view.top + 24 - bounds.top;
          else if (!tooTall && bounds.bottom > view.bottom - 24) conversation.scrollTop += bounds.bottom - view.bottom + 24;
        }
      }
    };
    const schedule = () => {
      if (disposed) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => measure());
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(card);
    if (conversation) observer.observe(conversation);
    if (message) observer.observe(message);
    window.addEventListener('resize', schedule);
    document.fonts?.ready.then(schedule);
    measure();
    // Chat follows the end of a reply for a moment after it lands. Once that
    // settles, bring a card still scrolled out of sight to the top of the view.
    settle = setTimeout(() => {
      const end = conversation && conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 2;
      if (end) measure(true);
    }, 1700);
    return () => {
      disposed = true;
      clearTimeout(settle);
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
    };
  }, []);
  return <div ref={root} className="weather-fit"><div ref={content} className="weather-fit-content">{children}</div></div>;
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
