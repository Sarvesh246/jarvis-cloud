import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { weatherData, weatherForecast, weatherMarkdown } from '../src/lib/weather.js';
import { forecast } from './fixtures/weather-data.js';

const wrap = data => '```weather\n' + JSON.stringify(data) + '\n```';
const copy = () => structuredClone(forecast);

test('weather current conditions accept only absent, null or a complete object', () => {
  for (const current of [false, 0, '', [], true, 1, 'sunny']) {
    assert.equal(weatherData(wrap({ ...forecast, current })), null, JSON.stringify(current));
  }
  for (const current of [undefined, null, forecast.current]) {
    assert.ok(weatherData(wrap({ ...forecast, current })));
  }
});

test('weather dates reject impossible calendar days and retain leap days', () => {
  for (const label of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-00-20', '2026-13-20', '2026-10-00', '0000-10-20']) {
    const data = copy(); data.periods[0].label = label;
    assert.equal(weatherData(wrap(data)), null, label);
  }
  const data = copy(); data.periods[0].label = '2028-02-29';
  assert.ok(weatherData(wrap(data)));
});

test('every weather timestamp validates its entire calendar and clock', () => {
  const setters = [
    (f, value) => { f.localTime = value; },
    (f, value) => { f.retrieved = value; },
    (f, value) => { f.current.time = value; },
    (f, value) => { f.periods[0].sunrise = value; },
    (f, value) => { f.periods[0].sunset = value; },
    (f, value) => { f.periods[0].hours[0].time = value; },
  ];
  for (const set of setters) for (const value of ['2026-02-30T12:00', '2026-10-20T24:00', '2026-10-20T12:60', '2026-10-20T12:00:60', '2026-10-20T12:00junk', '2026-10-20T12:00+99:00']) {
    const data = copy(); set(data, value);
    assert.equal(weatherData(wrap(data)), null, value);
  }
  for (const value of ['2026-10-20T00:00', '2026-10-20T23:59:59', '2026-10-20T12:00:00.123Z', '2026-10-20T12:00:00+00:00', '2026-10-20T12:00-05:00']) {
    const data = copy(); data.retrieved = value;
    assert.ok(weatherData(wrap(data)), value);
  }
});

test('weather-shaped examples inside longer code fences stay literal', () => {
  for (const marker of ['````', '~~~~']) {
    const content = `${marker}markdown\n${wrap(forecast)}\n${marker}\n\nLiteral example.`;
    assert.equal(weatherData(content), null);
    assert.equal(weatherForecast(content, 'explain this forecast schema'), null);
    assert.equal(weatherMarkdown(content), content);
  }
});

test('a weather closer with trailing text cannot promote or remove an unfinished block', () => {
  const content = wrap(forecast).replace(/```$/, '```still code');
  assert.equal(weatherData(content), null);
  assert.equal(weatherMarkdown(content), content);
});

test('a real weather block after a literal example removes only its own source range', () => {
  const example = `\`\`\`\`markdown\n${wrap(forecast)}\n\`\`\`\`\n\n`;
  const content = example + wrap({ ...forecast, title: 'Actual forecast' }) + '\n\nSources stay here.';
  const parsed = weatherData(content);
  assert.equal(parsed.title, 'Actual forecast');
  assert.equal(parsed.fallback, (example + '\n\nSources stay here.').trim());
});

test('valid provider weather preserves null metrics, negative and zero temperatures, units and fallback', () => {
  const data = copy();
  data.unit = '°C'; data.windUnit = 'km/h';
  data.periods[0].high = 0; data.periods[0].low = -12.5;
  data.periods[0].rain = null; data.periods[0].sunrise = null;
  data.current.temperature = 0;
  const content = wrap(data) + '\n\n**Verified forecast** · [Source](https://open-meteo.com/)';
  const parsed = weatherData(content);
  assert.deepEqual(parsed.periods, data.periods);
  assert.deepEqual(parsed.current, data.current);
  assert.equal(parsed.unit, '°C');
  assert.equal(parsed.fallback, '**Verified forecast** · [Source](https://open-meteo.com/)');
});

test('weather keeps its size, collection and finite-number boundaries', () => {
  const content = wrap(forecast);
  assert.ok(weatherData(content.padEnd(60000, ' ')));
  assert.equal(weatherData(content.padEnd(60001, ' ')), null);
  for (const data of [null, [], false, 0, '', { ...forecast, periods: {} }, { ...forecast, periods: [] }, { ...forecast, periods: Array(17).fill(forecast.periods[0]) }]) {
    assert.equal(weatherData(wrap(data)), null);
  }
  for (const field of ['high', 'low', 'rain', 'wind', 'uv']) {
    const data = copy(); data.periods[0][field] = '0';
    assert.equal(weatherData(wrap(data)), null);
  }
  assert.equal(weatherData(content.replace('"high":83', '"high":1e999')), null);
  const data = copy(); data.periods[0].hours.push({ ...data.periods[0].hours[1] });
  assert.ok(weatherData(wrap(data))); // A 25-hour DST day remains supported.
  data.periods[0].hours.push({ ...data.periods[0].hours[1] });
  assert.equal(weatherData(wrap(data)), null);
});

test('closed weather fences preserve following prose and CRLF source boundaries', () => {
  for (const marker of ['```', '````', '~~~']) {
    const content = `Before.\r\n\r\n${marker}weather\r\n${JSON.stringify(forecast)}\r\n${marker}\r\n\r\nAfter.`;
    assert.equal(weatherData(content)?.title, forecast.title);
    assert.equal(weatherMarkdown(content), 'Before.\r\n\r\n\r\n\r\nAfter.');
  }
});

test('actual reply renderer contains malformed weather and preserves literal examples', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { Rendered } = await server.ssrLoadModule('/src/components/blocks/Blocks.jsx');
    const render = (content, live = false, requestText = 'explain this example') => renderToStaticMarkup(React.createElement(Rendered, { content, live, requestText, sources: [], onOpen() {} }));
    for (const current of [false, 0, '']) {
      const html = render(wrap({ ...forecast, current }) + '\n\nReadable fallback.');
      assert.ok(html.includes('Readable fallback.'));
      assert.ok(!html.includes('weather-detailed'));
    }
    const invalid = copy(); invalid.periods[0].label = '2026-13-20';
    assert.ok(!render(wrap(invalid)).includes('Invalid Date'));
    const example = `\`\`\`\`markdown\n${wrap(forecast)}\n\`\`\`\``;
    for (const live of [false, true]) {
      const html = render(example, live);
      assert.ok(!html.includes('weather-detailed'));
      assert.ok(html.includes('College Station'));
      assert.ok(html.includes('language-markdown'));
    }
    assert.ok(render(wrap(forecast), false, 'weather today').includes('weather-detailed'));
  } finally { await server.close(); }
});
