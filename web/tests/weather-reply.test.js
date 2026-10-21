import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { readEvents } from '../src/stream.js';
import { cleanAnswer } from '../shared/answer-cleanup.js';
import { weatherForecast, weatherData, weatherMarkdown } from '../src/lib/weather.js';
import { forecast, weatherContent } from './fixtures/weather-data.js';
import { localizedQuery } from '../server/freshness.js';

const answer = 'Tomorrow’s high will be around 82 °F, with a clear sky and a light breeze from the northeast. The evening will drop to about 55 °F, staying mostly clear, and the week stays warm with highs of 86 °F on Thursday and 83 °F on Friday【untrusted_tool_result source="web_search"]';
const table = 'Weather for Chicago\n\n| Day | Conditions | High | Low |\n|---|---|---|---|\n| Today | Sunny | 82°F | 55°F |\n| Tomorrow | Partly cloudy | 79°F | 52°F |\n| Thursday | Rain | 68°F | — |\n\nWind NE 5 mph. [NWS](https://weather.gov/)';

test('trust delimiters never replace real citations or code examples', () => {
  assert.equal(cleanAnswer(answer), answer.slice(0, answer.indexOf('【')));
  assert.equal(cleanAnswer('[untrusted_tool_result source="web_search"]82°F[/untrusted_tool_result] [NWS](https://weather.gov/)'), '82°F [NWS](https://weather.gov/)');
  assert.equal(cleanAnswer('82°F【untrusted_tool_res'), '82°F');
  assert.equal(cleanAnswer('`[untrusted_tool_result]`'), '`[untrusted_tool_result]`');
  assert.equal(cleanAnswer('[[vaelo-weather:' + 'a'.repeat(24) + ']]\nForecast'), '\nForecast');
  assert.equal(cleanAnswer('[[vaelo-weather:abcdef'), '');
  // Models drop or add brackets when copying the reference; none may reach the reader.
  for (const marker of ['[vaelo-weather:' + 'c'.repeat(24) + ']', 'vaelo-weather:' + 'c'.repeat(24), '[[vaelo-weather:' + 'c'.repeat(24) + ']']) {
    assert.equal(cleanAnswer('Chicago is overcast.\n\n' + marker).trim(), 'Chicago is overcast.');
  }
  assert.equal(cleanAnswer('Warm and dry.\n\n[Vaelo request: reference]'), 'Warm and dry.\n\n');
  assert.equal(cleanAnswer('`[[vaelo-weather:' + 'a'.repeat(24) + ']]`'), '`[[vaelo-weather:' + 'a'.repeat(24) + ']]`');
});

test('weather cards retain exact units and never supply missing lows or conditions', () => {
  const parsed = weatherForecast(table, 'weather today');
  assert.equal(parsed.periods.length, 3);
  assert.deepEqual(parsed.periods[2], { label: 'Thursday', high: '68°F', low: null, condition: 'Rain' });
  const prose = weatherForecast(cleanAnswer(answer), 'weather tomorrow');
  assert.equal(prose.periods[0].high, '82°F');
  assert.equal(prose.periods[0].low, '55°F');
  assert.equal(weatherForecast('The temperature is unknown.', 'weather today'), null);
  assert.equal(weatherForecast(table, 'weather as plain text'), null);
  assert.equal(weatherForecast(table, 'weather as a table'), null);
  assert.equal(weatherForecast(table, 'rewrite this'), null);
  const celsius = weatherForecast('| Day | High (°C) | Low (°C) |\n|---|---|---|\n| Friday | -2 | -8 |', 'weather');
  assert.equal(celsius.periods[0].high, '-2°C');
});

test('local weather respects explicit destinations regardless of capitalization', () => {
  const place = { lat: 41.88, lon: -87.63 };
  assert.equal(localizedQuery('weather tomorrow', place), 'weather tomorrow in 41.88, -87.63');
  assert.equal(localizedQuery('weather in paris', place), 'weather in paris');
  assert.equal(localizedQuery('weather for tomorrow', place), 'weather for tomorrow in 41.88, -87.63');
});

test('detailed weather accepts bounded provider data and preserves readable fallback', () => {
  const parsed = weatherForecast(weatherContent, 'what about Friday?');
  assert.equal(parsed.current.temperature, 68);
  assert.equal(parsed.periods[2].low, null);
  assert.equal(parsed.periods[0].hours.length, 24);
  assert.ok(!weatherMarkdown(weatherContent).includes('```weather'));
  for (const request of ['weather as plain text', 'weather as a table', 'weather as JSON']) assert.equal(weatherForecast(weatherContent, request), null);
  for (const change of [{ unit:'degrees' }, { periods: [{...forecast.periods[0],high:'hot'}] }, { current: {...forecast.current,temperature:{text:68}} }]) {
    assert.equal(weatherData('```weather\n'+JSON.stringify({...forecast,...change})+'\n```'),null);
  }
  assert.equal(weatherData('```weather\n{}'),null);
  const brokenTable = '| Day | Conditions | High | Low | Tue 10/20/26 | Clear sky / Sunny | 80 °F (26.9°C) | 55°F (13°C) |';
  assert.equal(weatherForecast(brokenTable,'whats the weather today').periods[0].high,'80°F');
});

test('a terminal event finishes without waiting for the transport to close', async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(c) {
    c.enqueue(new TextEncoder().encode('event: jarvis.complete\ndata: {"ok":true}\n\n'));
  }, cancel() { cancelled = true; return new Promise(() => {}); } });
  await readEvents(body, name => name === 'jarvis.complete' ? false : undefined);
  assert.equal(cancelled, true);
});

test('stop interrupts an idle read even if transport cancellation never settles', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } });
  const reading = readEvents(body, () => assert.fail(), undefined, controller.signal);
  controller.abort();
  await assert.rejects(reading, { name: 'AbortError' });
  assert.equal(cancelled, true);
});

test('actual weather renderer shows bento cards, sources and streaming fallback', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { Rendered } = await server.ssrLoadModule('/src/components/blocks/Blocks.jsx');
    const render = (content, live = false) => renderToStaticMarkup(React.createElement(Rendered, { content, live, requestText: 'weather tomorrow', sources: [], onOpen() {} }));
    const html = render(table);
    assert.ok(html.includes('weather-bento'));
    assert.ok(html.includes('🌤️'));
    assert.ok(html.includes('82°F'));
    assert.ok(html.includes('Forecast details and sources'));
    assert.ok(html.includes('https://weather.gov/'));
    assert.ok(!render(table, true).includes('weather-bento'));
    assert.ok(!render(answer).includes('untrusted_tool_result'));
    const detailed = render(weatherContent);
    for (const label of ['weather-detailed', 'College Station', '68°F', 'Feels like', 'Hourly forecast', 'Rain chance', 'UV index', 'Sunrise', 'Choose forecast day', 'Retrieved']) assert.ok(detailed.includes(label),label);
    assert.ok(!detailed.includes('language-weather'));
    const weeklyForecast = { ...forecast, view: 'week', periods: Array.from({length: 7}, (_, i) => ({ ...forecast.periods[i % 3], label: `2026-10-${20 + i}` })) };
    const weeklyContent = '```weather\n' + JSON.stringify(weeklyForecast) + '\n```';
    const weekly = render(weeklyContent);
    for (const label of ['7-day forecast', 'Weekly forecast', 'Week overview', 'Oct 26']) assert.ok(weekly.includes(label), label);
    assert.equal((weekly.match(/class="weather-period"/g) || []).length, 7);
    assert.ok(!weekly.includes('Current conditions'));
    assert.ok(!weekly.includes('weather-now'));
    assert.equal(weatherData('```weather\n' + JSON.stringify({...weeklyForecast,periods: weeklyForecast.periods.slice(0,1)}) + '\n```'), null);
  } finally { await server.close(); }
});

test('weather icons switch to the moon after dark, like weather apps', async () => {
  const { weatherIcon, isNightLabel } = await import('../src/lib/weather.js');
  assert.equal(weatherIcon('Mostly Clear', false), '🌙');
  assert.equal(weatherIcon('Partly Cloudy', false), '🌙');
  assert.equal(weatherIcon('Clear sky', false), '🌙');
  assert.equal(weatherIcon('Mostly Clear'), '☀️');
  assert.equal(weatherIcon('Rain', false), '🌧️');
  assert.equal(weatherIcon('Cloudy', false), '☁️');
  assert.deepEqual(['Tonight', 'Friday Night', 'Overnight', 'Wednesday'].map(isNightLabel), [true, true, true, false]);
});
