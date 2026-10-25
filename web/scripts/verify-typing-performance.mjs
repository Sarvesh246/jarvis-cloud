// Real React/browser regression and performance checks with isolated API fixtures.
// Start Vite (or the production preview) and set TYPING_TEST_URL to its address.
import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CONTEXT_POLICY } from '../shared/context-policy.js';
import { composeContent } from '../src/lib/attachments.js';

const origin = process.env.TYPING_TEST_URL || 'http://127.0.0.1:5183';
const baseline = process.env.TYPING_BASELINE === '1';
const engine = process.env.TYPING_ENGINE || 'chromium';
const functionalOnly = process.env.TYPING_FUNCTIONAL_ONLY === '1';
const fallback = process.env.TYPING_FALLBACK === '1';
const pwa = process.env.TYPING_PWA === '1';
const output = process.env.TYPING_OUTPUT || join(tmpdir(), 'vaelo-typing-review');
await mkdir(output, { recursive: true });
const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true });
const results = [];
const userId = 'typing-test';
const seedId = '123e4567-e89b-12d3-a456-426614174000';
const content = 'A complete answer with **formatting**, a [reference](https://example.test/reference), and details.\n\n' +
  'The launch depends on verifying the release and reviewing the proposal. '.repeat(10) +
  '\n\n```js\nconst ready = true;\nconsole.log(ready);\n```\n';
const seed = { id: seedId, title: 'Performance conversation', updated: Date.now(), messages: Array.from({ length: 60 }, (_, index) => ({
  id: `m${index}`, role: index % 2 ? 'assistant' : 'user', content: index % 2 ? content : `Explain step ${index / 2 + 1}.`,
  ...(index % 2 ? { completedAt: Date.now() } : {}),
})) };

async function fixture(viewport, isMobile) {
  const context = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, serviceWorkers: pwa ? 'allow' : 'block' });
  const page = await context.newPage();
  const errors = [], requests = [];
  page.on('pageerror', error => { errors.push(error.message); if (!baseline) console.error(error.stack); });
  page.setDefaultTimeout(15000);
  await page.addInitScript(({ seed, userId, fallback, pwa }) => {
    if (pwa) {
      Object.defineProperty(navigator, 'standalone', { value: true });
      const match = window.matchMedia.bind(window);
      window.matchMedia = query => {
        const result = match(query);
        if (query === '(display-mode: standalone)') Object.defineProperty(result, 'matches', { value: true });
        return result;
      };
    }
    if (fallback) {
      const supports = CSS.supports.bind(CSS);
      CSS.supports = (property, value) => property === 'field-sizing' ? false : supports(property, value);
    }
    const others = Array.from({ length: 40 }, (_, index) => ({ ...seed, id: `other-${index}`, title: `Earlier conversation ${index}`, messages: seed.messages.slice(0, 2) }));
    localStorage.setItem(`vaelo-sync:${userId}`, JSON.stringify({ chats: [seed, ...others], base: {}, deleted: [] }));
    localStorage.setItem('vaelo-onboarding', 'done');
    sessionStorage.setItem(`vaelo-open-chat:${userId}`, seed.id);
    // The root child is App in both development and minified production builds.
    window.__typing = { appRenders: 0, commits: 0, inputLatency: [], longTasks: [], composerRenders: 0 };
    const composerState = new WeakMap();
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, renderers: new Map(),
      inject(renderer) { this.renderers.set(1, renderer); return 1; }, onCommitFiberUnmount() {},
      onCommitFiberRoot(_id, root) {
        window.__typing.commits++;
        if (root.current.child?.flags & 1) window.__typing.appRenders++;
        {
          const visit = node => {
            if (!node) return;
            if (node.tag === 11 && node.memoizedProps?.draftStore) {
              // A memo bailout may retain old flags; hook-list identity only
              // changes when this component actually executes a new render.
              const prior = composerState.get(node.type);
              if (window.__typing.observeComposer && prior !== node.memoizedState) window.__typing.composerRenders++;
              composerState.set(node.type, node.memoizedState);
            }
            visit(node.child); visit(node.sibling);
          };
          if (window.__typing.observeComposer) visit(root.current);
        }
      },
    };
    document.addEventListener('input', event => {
      if (event.target.getAttribute('aria-label') !== 'Message Vaelo') return;
      const start = performance.now();
      requestAnimationFrame(() => window.__typing.inputLatency.push(performance.now() - start));
    }, true);
    if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) new PerformanceObserver(list => {
      window.__typing.longTasks.push(...list.getEntries().map(entry => entry.duration));
    }).observe({ type: 'longtask' });
    // Browser speech service fixture: late results are still delivered after
    // abort, so conversation ownership must reject them in the real hook.
    window.__takes = [];
    window.SpeechRecognition = class {
      constructor() { window.__takes.push(this); }
      start() {} stop() {} abort() { this.aborted = true; }
      result(text) { this.onresult?.({ results: [[{ transcript: text }]] }); }
    };
  }, { seed, userId, fallback, pwa });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    let body; try { body = route.request().postDataJSON(); } catch {}
    const json = value => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    if (url.pathname === '/api/session') return json({ user: { sub: userId, name: 'Test User', email: 'test@example.test' }, csrf: 'a'.repeat(64), configured: true });
    if (url.pathname === '/api/status') return json({ ready: true });
    if (url.pathname === '/api/feed') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: feed\ndata: {"seq":0}\n\n' });
    if (url.pathname === '/api/chat') {
      if (route.request().method() === 'POST') requests.push(body);
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: 'The full fixture answer.' }, finish_reason: 'stop' }] })}\n\nevent: jarvis.complete\ndata: {"ok":true}\n\ndata: [DONE]\n\n` });
    }
    if (url.searchParams.get('resource') === 'retention') return json({ days: 0, now: Date.now() });
    if (url.searchParams.get('resource') === 'commands') return json({ shortcuts: [], reminders: [] });
    if (url.searchParams.get('resource') === 'memory') return json({ enabled: true, items: [] });
    if (url.pathname === '/api/chats') return json({ entries: {} });
    return json({ ok: true, items: [], records: [] });
  });
  await page.goto(origin);
  if (pwa) {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // Exercise the real installed shell/cache path.
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  }
  const input = page.getByRole('textbox', { name: 'Message Vaelo', exact: true });
  await input.waitFor().catch(async error => { console.error({ errors, body: (await page.locator('body').innerText()).slice(0, 2000) }); throw error; });
  await page.locator('.message').last().waitFor().catch(async error => { console.error({ errors, body: (await page.locator('body').innerText()).slice(0, 2000) }); throw error; });
  await page.evaluate(() => document.fonts.ready);
  const cdp = engine === 'chromium' ? await context.newCDPSession(page) : null;
  await cdp?.send('Performance.enable');
  if (!functionalOnly) await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return { context, page, input, cdp, errors, requests };
}

async function measure(f, label) {
  const { input, page, cdp } = f;
  await input.fill('Start ');
  await page.waitForTimeout(350);
  await page.evaluate(() => { window.__typing.appRenders = 0; window.__typing.commits = 0; window.__typing.inputLatency = []; window.__typing.longTasks = []; });
  const before = (await cdp.send('Performance.getMetrics')).metrics;
  const start = performance.now();
  const text = 'A phone should keep up with typing, even in a long conversation with files attached. ';
  await input.pressSequentially(text, { timeout: 60000 });
  await page.waitForTimeout(80);
  const inputMatches = await input.inputValue() === 'Start ' + text;
  if (!baseline) assert.equal(inputMatches, true, 'Every typed character must survive');
  const after = (await cdp.send('Performance.getMetrics')).metrics;
  const measured = await page.evaluate(() => window.__typing);
  const latency = measured.inputLatency.sort((a, b) => a - b);
  const metrics = Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount'].map(name =>
    [name, +((after.find(m => m.name === name)?.value || 0) - (before.find(m => m.name === name)?.value || 0)).toFixed(4)]));
  const result = { label, characters: text.length, inputMatches, appRenders: measured.appRenders, commits: measured.commits,
    elapsedMs: Math.round(performance.now() - start), inputFrameP95Ms: +(latency[Math.floor(latency.length * .95)] || 0).toFixed(1),
    longTasks: measured.longTasks.length, ...metrics };
  console.log(JSON.stringify(result)); results.push(result);
  await writeFile(join(output, baseline ? 'baseline.json' : 'optimized.json'), JSON.stringify(results, null, 2));
  if (!baseline) assert.equal(measured.appRenders, 0, `${label}: typing an existing draft must not render App`);
}

async function exercise(f, label, mobile) {
  const { page, input, requests } = f;
  const send = page.getByRole('button', { name: 'Send', exact: true });
  const remove = page.getByRole('button', { name: 'Remove large-reference.md' });
  if (await remove.count()) await remove.click();
  // Growth, shrink, wrapping on resize, caret, composition, and both limits.
  await input.fill('One line'); await page.waitForTimeout(80);
  const short = (await input.boundingBox()).height;
  await input.fill('A long line of text to wrap naturally across the field. '.repeat(35)); await page.waitForTimeout(80);
  const tall = (await input.boundingBox()).height;
  assert.ok(tall > short && tall <= (mobile ? 133 : 209), `${label}: bounded autosizing`);
  await input.fill('Short again'); await page.waitForTimeout(80);
  assert.ok((await input.boundingBox()).height < tall, `${label}: shrink after deletion`);
  const responsive = 'This paragraph should wrap when the viewport becomes narrow. '.repeat(2);
  await page.setViewportSize({ width: 1000, height: 800 }); await input.fill(responsive); await page.waitForTimeout(80);
  const wide = (await input.boundingBox()).height;
  await input.evaluate(el => el.setSelectionRange(10, 10));
  await page.setViewportSize({ width: 360, height: 780 }); await page.waitForTimeout(150);
  const narrow = (await input.boundingBox()).height;
  assert.ok(narrow >= wide, `${label}: resize without editing (${wide} → ${narrow})`);
  assert.equal(await input.evaluate(el => el.selectionStart), 10);
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  await input.fill('中文入力 👋 مرحبا');
  const before = requests.length;
  await input.dispatchEvent('compositionstart');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true });
  await input.dispatchEvent('compositionend');
  assert.equal(requests.length, before, 'IME Enter must not send');
  await input.fill('x'.repeat(CONTEXT_POLICY.messageChars + 1));
  assert.equal(await send.isDisabled(), true);
  await input.fill('Exact final characters 日本語 👋');
  // Restore a different draft and its attachment after the shell stopped
  // subscribing to individual characters, including a late dictation result.
  await page.locator('.composer input[type=file]').first().setInputFiles({ name: 'kept.txt', mimeType: 'text/plain', buffer: Buffer.from('Keep the complete attachment.') });
  await page.getByRole('button', { name: 'Remove kept.txt' }).waitFor();
  async function switchTo(title) {
    if (mobile) await page.getByRole('button', { name: 'Open conversations', exact: true }).click();
    await page.locator(mobile ? '.rail-phone' : '.rail-wide').locator('.rail-link').filter({ has: page.getByText(title, { exact: true }) }).click();
  }
  await switchTo('Earlier conversation 0');
  assert.equal(await input.inputValue(), '');
  await input.fill('Other draft');
  await page.getByRole('button', { name: 'Dictate', exact: true }).click();
  await page.evaluate(() => window.__takes.at(-1).result('spoken words'));
  await switchTo('Performance conversation');
  await page.evaluate(() => window.__takes.at(-1).result('LATE WORDS MUST NOT LEAK'));
  assert.equal(await input.inputValue(), 'Exact final characters 日本語 👋');
  await page.getByRole('button', { name: 'Remove kept.txt' }).waitFor();
  // The emitted request must still include every character and file byte.
  const sent = page.waitForResponse(response => new URL(response.url()).pathname === '/api/chat' && response.request().method() === 'POST');
  await send.click(); await sent;
  await page.waitForFunction(() => !document.querySelector('.composer[data-busy]'));
  assert.equal(requests.at(-1).messages.at(-1).content, composeContent('Exact final characters 日本語 👋', [{ state: 'ready', name: 'kept.txt', body: 'Keep the complete attachment.' }]));
  assert.equal(await input.inputValue(), '');
  await input.fill('/he'); await page.getByRole('listbox', { name: 'Slash commands' }).waitFor();
  await input.press('Escape'); assert.equal(await page.getByRole('listbox').count(), 0);
  await input.pressSequentially('l'); await page.getByRole('listbox').waitFor();
  await input.fill('');
  await page.evaluate(() => {
    const original = window.fetch;
    window.__streamFixture = { chunks: [], cancelled: false };
    window.__streamCalls = [];
    window.fetch = (resource, init) => {
      if (new URL(typeof resource === 'string' ? resource : resource.url, location.href).pathname !== '/api/chat') return original(resource, init);
      const fixture = { chunks: [], cancelled: false, method: init.method || 'GET' };
      window.__streamFixture = fixture;
      window.__streamCalls.push(fixture);
      if (init.signal?.aborted) { fixture.cancelled = true; return Promise.reject(new DOMException('Stopped', 'AbortError')); }
      const encoder = new TextEncoder();
      let timer;
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          const emit = text => controller.enqueue(encoder.encode(text));
          timer = setInterval(() => {
            const chunk = `Complete streaming sentence ${fixture.chunks.length + 1}. `;
            fixture.chunks.push(chunk);
            emit(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
          }, 90);
          fixture.finish = () => {
            clearInterval(timer);
            emit('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\nevent: jarvis.complete\ndata: {"ok":true}\n\ndata: [DONE]\n\n');
            controller.close();
          };
          init.signal?.addEventListener('abort', () => {
            clearInterval(timer); fixture.cancelled = true;
            try { controller.error(new DOMException('Stopped', 'AbortError')); } catch {}
          }, { once: true });
        },
        cancel() { clearInterval(timer); fixture.cancelled = true; },
      }), { headers: { 'Content-Type': 'text/event-stream' } }));
    };
  });
  await input.fill('Exercise streaming responsiveness'); await send.click();
  await page.waitForFunction(() => window.__streamFixture.chunks.length >= 4);
  await page.evaluate(() => { window.__typing.observeComposer = true; });
  await page.waitForFunction(() => window.__streamFixture.chunks.length >= 6);
  await page.evaluate(() => { window.__typing.composerRenders = 0; });
  await page.waitForFunction(() => window.__streamFixture.chunks.length >= 11);
  assert.equal(await page.evaluate(() => window.__typing.composerRenders), 0, 'Reply tokens must not rerender the composer');
  await input.pressSequentially('The next question stays intact.');
  assert.equal(await input.inputValue(), 'The next question stays intact.');
  await page.evaluate(() => window.__streamFixture.finish());
  await page.waitForFunction(() => !document.querySelector('.composer[data-busy]'));
  assert.equal(await page.locator('.message[data-role=assistant]').last().locator('.prose').innerText(), await page.evaluate(() => window.__streamFixture.chunks.join('').trim()));
  assert.equal(await input.inputValue(), 'The next question stays intact.');
  await send.click(); await page.locator('.composer[data-busy]').waitFor();
  await page.waitForFunction(() => window.__streamCalls.length >= 2 && window.__streamFixture.chunks.length >= 2);
  await input.fill('Keep this while stopping.');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.composer[data-busy]')).catch(async error => {
    console.error(await page.evaluate(() => ({ calls: window.__streamCalls.map(call => ({ method: call.method, cancelled: call.cancelled, chunks: call.chunks.length })),
      value: document.querySelector('[aria-label="Message Vaelo"]')?.value })));
    throw error;
  });
  await page.waitForTimeout(150);
  assert.equal(await input.inputValue(), 'Keep this while stopping.');
  assert.equal(await page.evaluate(() => window.__streamFixture.cancelled), true);
  await input.fill('/new '); await send.click();
  await page.locator('.welcome').waitFor();
  await page.waitForFunction(() => document.querySelector('.welcome .mark')?.dataset.state === 'idle');
  await page.evaluate(() => { window.__typing.appRenders = 0; });
  await input.pressSequentially('First character, then the rest.');
  await page.waitForFunction(() => document.querySelector('.welcome .mark')?.dataset.state === 'listening');
  await input.fill('  ');
  await page.waitForFunction(() => document.querySelector('.welcome .mark')?.dataset.state === 'idle');
  assert.equal(await page.evaluate(() => window.__typing.appRenders), 0, 'Even first-character/empty transitions must stay out of App');
  await input.fill('');
  assert.deepEqual(f.errors, []);
  console.log(JSON.stringify({ label, functional: 'passed', engine, fallback, pwa }));
}

try {
  for (const [label, viewport, mobile] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1440, height: 1000 }, false]]) {
    if (process.env.TYPING_PROFILE && process.env.TYPING_PROFILE !== label) continue;
    const f = await fixture(viewport, mobile);
    if (!functionalOnly) {
      await measure(f, `${label}:history`);
      const body = ('File contents including ``` fences and unicode 日本語.\n').repeat(2800);
      await f.page.locator('.composer input[type=file]').first().setInputFiles({ name: 'large-reference.md', mimeType: 'text/markdown', buffer: Buffer.from(body) });
      await f.page.getByRole('button', { name: 'Remove large-reference.md' }).waitFor();
      await measure(f, `${label}:history+attachment`);
    }
    if (!baseline) {
      await f.cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await exercise(f, label, mobile);
    }
    if (!baseline) assert.deepEqual(f.errors, []);
    await f.page.waitForTimeout(900); // Existing welcome entrance must settle for visual review.
    await f.page.screenshot({ path: join(output, `${engine}-${fallback ? 'fallback-' : ''}${label}.png`) });
    await f.context.close();
  }
  if (!functionalOnly) await writeFile(join(output, baseline ? 'baseline.json' : 'optimized.json'), JSON.stringify(results, null, 2));
} finally { await browser.close(); }
