// Local production preview; all API requests use synthetic browser-only data.
import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

const before = process.env.CHAT_TEST_BEFORE === '1';
const output = process.env.CHAT_TEST_OUTPUT || '../.codex/visual/offline-retry';
const origin = 'http://127.0.0.1:5197';
const require = createRequire(import.meta.url);
const axe = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const profiles = [
  ['desktop', { viewport: { width: 1440, height: 900 } }],
  ['tablet', { viewport: { width: 820, height: 900 } }],
  ['iphone', { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }],
  ['pixel', { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 }],
].filter(([name]) => !process.env.CHAT_TEST_PROFILE || process.env.CHAT_TEST_PROFILE === name);
const fixtures = [
  { id: 'finished' },
  { id: 'failed', failed: true, errorKind: 'offline', note: 'Vaelo couldn’t be reached. Check your connection, then try again.' },
  { id: 'interrupted', interrupted: true, note: 'The connection dropped partway through. What arrived is kept.' },
  { id: 'stopped', stopped: true },
  { id: 'truncated', truncated: true },
  { id: 'offline-session', sessionOffline: true },
];
const results = [];
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5197', '--strictPort', ...(process.env.CHAT_TEST_DIST ? ['--outDir', process.env.CHAT_TEST_DIST] : [])], { stdio: 'ignore' });
let browser;
try {
  browser = await chromium.launch();
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    if (attempt > 100) throw new Error('Local preview did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  for (const [profile, options] of profiles) for (const theme of ['light', 'dark']) for (const fixture of fixtures) {
    const name = `${profile}-${theme}-${fixture.id}`;
    console.log(`${before ? 'before' : 'after'}: ${name}`);
    const context = await browser.newContext({ ...options, serviceWorkers: 'block', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [], sent = [];
    let sessionOffline = !!fixture.sessionOffline;
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.text() !== 'Service Worker registration blocked by Playwright' && ['warning', 'error'].includes(message.type())) errors.push(message.text());
    });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const json = value => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
      if (url.pathname === '/api/session') return json({ user: { sub: 'offline-review', name: 'User' }, csrf: 'a'.repeat(64), configured: true, offline: sessionOffline });
      if (url.pathname === '/api/status') return json({ ready: true });
      if (url.pathname === '/api/chat') {
        if (route.request().method() === 'POST') {
          sent.push(route.request().postDataJSON());
          await page.evaluate(() => { window.replyShifts = 0; window.measuringReply = true; });
        }
        return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"Recovered fixture reply."}}]}\n\nevent: jarvis.complete\ndata: {"ok":true}\n\n' });
      }
      if (url.pathname === '/api/feed') return route.fulfill({ status: 204 });
      if (url.pathname === '/api/chats' && !url.search) return json(route.request().method() === 'POST' ? { ok: true } : { entries: {} });
      return json({ ok: true, items: [], records: [], projects: [], reminders: [], shortcuts: [], notes: [], days: 0 });
    });
    const source = 'Original **Markdown**, Unicode مرحبا 👩🏽‍💻, and `code`.';
    await page.addInitScript(({ fixture, theme, source }) => {
      const now = 1792996200000;
      const chat = { id: '123e4567-e89b-12d3-a456-426614174000', title: 'Offline recovery', updated: now, messages: [
        { id: 'question', role: 'user', content: 'Explain this example.' },
        { id: 'answer', role: 'assistant', content: source, completedAt: now,
          ...Object.fromEntries(['failed', 'errorKind', 'note', 'interrupted', 'stopped', 'truncated'].filter(key => key in fixture).map(key => [key, fixture[key]])) },
      ] };
      localStorage.setItem('vaelo-sync:offline-review', JSON.stringify({ chats: [chat], base: {} }));
      localStorage.setItem('vaelo-onboarding', 'done');
      localStorage.setItem('vaelo-preferences', JSON.stringify({ theme, presentation: 'minimal' }));
      sessionStorage.setItem('vaelo-open-chat:offline-review', chat.id);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedText = text; } } });
      window.shifts = 0;
      window.replyShifts = 0;
      new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) {
        window.shifts += entry.value;
        if (window.measuringReply) window.replyShifts += entry.value;
      } }).observe({ type: 'layout-shift', buffered: true });
    }, { fixture, theme, source });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const message = page.locator('#m-answer');
    await message.waitFor();
    await page.waitForFunction(() => document.fonts.status === 'loaded');
    await page.waitForTimeout(200);
    const recoveries = message.getByRole('button', { name: /^(Try again|Continue|Continue from here|Start over)$/ });
    if (!fixture.sessionOffline) {
      assert.ok(await recoveries.count());
      for (const button of await recoveries.all()) assert.equal(await button.isEnabled(), true);
      await page.screenshot({ path: join(output, `${name}-online.png`), animations: 'disabled' });
      await page.evaluate(() => dispatchEvent(new Event('offline')));
    } else {
      for (const button of await recoveries.all()) assert.equal(await button.isDisabled(), !before, 'offline session disables recovery even with navigator online');
      await page.evaluate(() => dispatchEvent(new Event('offline')));
    }
    await page.getByText('You’re offline. Your conversations are here to read; sending comes back with the connection.', { exact: true }).waitFor();
    for (const button of await recoveries.all()) {
      assert.equal(await button.isDisabled(), !before, `${name}: recovery availability follows connection`);
      if (!before) {
        const geometry = await button.boundingBox();
        // A native click must not invoke generation even if called programmatically.
        await button.evaluate(button => button.click());
        assert.ok(geometry.width > 0 && geometry.height > 0, 'disabled control retains its layout');
      }
    }
    assert.equal(sent.length, 0);
    await page.screenshot({ path: join(output, `${name}-offline.png`), animations: 'disabled' });
    const copy = message.getByRole('button', { name: 'Copy', exact: true });
    assert.equal(await copy.isEnabled(), true);
    await copy.click();
    assert.equal(await page.evaluate(() => window.copiedText), source);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('vaelo-sync:offline-review')).chats[0].messages[1].content);
    assert.equal(stored, source);
    if (options.isMobile && ['finished', 'offline-session'].includes(fixture.id)) {
      await message.getByRole('button', { name: 'More', exact: true }).tap();
      const sheet = page.getByRole('dialog', { name: 'Reply', exact: true });
      await sheet.waitFor();
      assert.equal(await sheet.getByRole('button', { name: 'Retry Keeps this version' }).isDisabled(), !before);
      assert.equal(await sheet.getByRole('button', { name: 'Copy', exact: true }).isEnabled(), true);
      await page.screenshot({ path: join(output, `${name}-sheet-offline.png`), animations: 'disabled' });
      sessionOffline = false;
      await page.evaluate(() => dispatchEvent(new Event('online')));
      await sheet.getByRole('button', { name: 'Retry Keeps this version' }).waitFor();
      await page.waitForFunction(() => !document.querySelector('.sheet .sh-row:nth-child(2)')?.disabled);
      await sheet.getByRole('button', { name: 'Retry Keeps this version' }).tap();
    } else {
      sessionOffline = false;
      await page.evaluate(() => dispatchEvent(new Event('online')));
      await page.getByText('You’re offline. Your conversations are here to read; sending comes back with the connection.', { exact: true }).waitFor({ state: 'hidden' });
      for (const button of await recoveries.all()) assert.equal(await button.isEnabled(), true);
      const action = recoveries.first();
      if (profile === 'desktop') { await action.focus(); await page.keyboard.press('Enter'); }
      else if (options.isMobile) await action.tap();
      else await action.click();
    }
    await page.locator('.thread .prose').getByText('Recovered fixture reply.', { exact: true }).waitFor();
    await page.waitForTimeout(300);
    assert.equal(sent.length, 1, `${name}: reconnection allows exactly one request`);
    assert.equal(sent[0].messages.find(message => message.role === 'user').content, 'Explain this example.');
    assert.deepEqual(errors, []);
    await page.addScriptTag({ content: axe });
    const accessibility = await page.evaluate(async () => (await axe.run(document)).violations.map(v => ({ id: v.id, count: v.nodes.length })));
    const geometry = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, shift: window.shifts, replyShift: window.replyShifts }));
    assert.equal(geometry.overflow, false);
    results.push({ name, accessibility, ...geometry });
    await context.close();
  }
  if (process.env.CHAT_TEST_BASELINE) {
    const prior = JSON.parse(await readFile(join(process.env.CHAT_TEST_BASELINE, 'results.json'), 'utf8'));
    for (const result of results) {
      assert.deepEqual(result.accessibility, prior.find(row => row.name === result.name).accessibility);
      if (result.name.endsWith('-offline-session')) continue;
      const name = `${result.name}-online.png`;
      assert.equal((await sharp(join(output, name)).raw().toBuffer()).equals(await sharp(join(process.env.CHAT_TEST_BASELINE, name)).raw().toBuffer()), true, `${name}: online pixels remain identical`);
    }
  }
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ cases: results.length, before, output }));
} finally {
  await browser?.close();
  server.kill();
}
