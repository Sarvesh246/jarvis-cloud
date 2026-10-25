// Local production preview only; requests never reach providers or user storage.
import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { backupFixtures } from '../tests/fixtures/chat-outputs/backup-status.js';

const require = createRequire(import.meta.url);
const axe = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const phase = process.env.CHAT_TEST_PHASE || 'after';
const output = process.env.CHAT_TEST_OUTPUT || `../.codex/visual/2026-10-25-backup/${phase}`;
const origin = 'http://127.0.0.1:5196';
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5196', '--strictPort'], { stdio: 'ignore' });
const browser = await chromium.launch();
const results = [];
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    if (attempt > 100) throw new Error('Local preview did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const profiles = [
    ['desktop', { viewport: { width: 1440, height: 900 } }],
    ['tablet', { viewport: { width: 820, height: 900 } }],
    ['iphone', { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }],
    ['pixel', { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 }],
  ];
  for (const [profile, options] of profiles) for (const theme of ['light', 'dark']) {
    if (process.env.CHAT_TEST_PROFILE && process.env.CHAT_TEST_PROFILE !== profile) continue;
    for (const fixture of [...backupFixtures, { id: 'backup-full', content: 'Keep this conversation safe.', full: true }]) {
      console.log(`${phase}: checking ${profile}/${theme}/${fixture.id}`);
      const context = await browser.newContext({ ...options, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [], commits = [], requests = [];
      let feedCount = 0;
      page.on('pageerror', error => errors.push(error.stack || error.message));
      page.on('console', message => {
        if (message.text() === 'Service Worker registration blocked by Playwright') return;
        if (['warning', 'error'].includes(message.type())) errors.push(message.text());
      });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        requests.push(`${route.request().method()} ${url.pathname}${url.search}`);
        const json = value => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
        if (url.pathname === '/api/session') return json({ user: { sub: 'backup-review', name: 'User' }, csrf: 'a'.repeat(64), configured: true });
        if (url.pathname === '/api/status') return json({ ready: true });
        if (url.searchParams.has('resource')) return json({ items: [], records: [], projects: [], shortcuts: [], reminders: [], notes: [], days: 0, now: 1792958400000 });
        if (url.pathname === '/api/feed') return feedCount++
          ? route.fulfill({ status: 204 })
          : route.fulfill({ contentType: 'text/event-stream', body: 'event: feed\ndata: {"seq":0}\n\n' });
        if (url.pathname === '/api/chats') {
          if (route.request().method() === 'POST') {
            const body = route.request().postDataJSON();
            if (body.action === 'commit') commits.push(body);
            return json({ ok: true });
          }
          return json({ entries: {} });
        }
        return json({ ok: true, items: [], records: [], shortcuts: [], reminders: [], days: 0, now: 1792958400000 });
      });
      await page.addInitScript(({ fixture, theme }) => {
        const now = 1792958400000;
        Date.now = () => now;
        const chat = { id: '123e4567-e89b-12d3-a456-426614174000', title: 'Backup review', updated: now, messages: [
          { id: 'question', role: 'user', content: fixture.user || 'Please explain this example.', ...(fixture.user ? { text: 'A saved multipart question.' } : {}) },
          { id: 'answer', role: 'assistant', content: fixture.content, completedAt: now, ...(fixture.running ? { running: true } : {}) },
        ] };
        localStorage.setItem('vaelo-sync:backup-review', JSON.stringify({ chats: [chat], base: {} }));
        localStorage.setItem('vaelo-onboarding', 'done');
        localStorage.setItem('vaelo-preferences', JSON.stringify({ theme, presentation: 'minimal' }));
        sessionStorage.setItem('vaelo-open-chat:backup-review', chat.id);
        if (fixture.full) {
          const write = Storage.prototype.setItem;
          Storage.prototype.setItem = function(key, value) {
            if (key === 'vaelo-sync:backup-review') throw new DOMException('Quota exceeded', 'QuotaExceededError');
            return write.call(this, key, value);
          };
        }
        window.shifts = 0;
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedText = text; } } });
        new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.shifts += entry.value; }).observe({ type: 'layout-shift', buffered: true });
      }, { fixture, theme });
      const committed = page.waitForResponse(response => response.url() === `${origin}/api/chats` &&
        response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'commit').then(() => null, error => error);
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.locator('#m-answer').waitFor({ timeout: 10000 }).catch(async error => {
        throw new Error(`${profile}/${theme}/${fixture.id}: ${error.message}; body=${await page.locator('body').innerText()}; requests=${JSON.stringify(requests)}; errors=${JSON.stringify(errors)}`);
      });
      const commitError = await committed;
      if (commitError) throw new Error(`${profile}/${theme}/${fixture.id}: ${commitError.message}; requests=${JSON.stringify(requests)}; errors=${JSON.stringify(errors)}`);
      await page.waitForFunction(() => document.fonts.status === 'loaded');
      await page.waitForTimeout(150);
      assert.ok(commits.length, 'the intercepted sync pass completed');
      const warning = await page.getByRole('alert').filter({ hasText: 'Local backup is full' }).count();
      if (fixture.full) assert.equal(warning, phase === 'before' ? 0 : 1);
      const source = await page.evaluate(() => JSON.parse(localStorage.getItem('vaelo-sync:backup-review')).chats[0].messages[1].content);
      assert.deepEqual(source, fixture.content, 'backup and legacy message content stay exact');
      await page.addScriptTag({ content: axe });
      const accessibility = await page.evaluate(async () => (await axe.run(document, { rules: { 'color-contrast': { enabled: true } } })).violations.map(v => ({ id: v.id, count: v.nodes.length })));
      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        shift: window.shifts,
        smallControls: [...document.querySelectorAll('button, input, textarea')].filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
        }).length,
      }));
      assert.equal(geometry.overflow, false, `${profile}/${fixture.id} page overflow`);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: join(output, `${profile}-${theme}-${fixture.id}.png`), animations: 'disabled', caret: 'hide' });
      if (!fixture.running) {
        if (options.isMobile) {
          await page.locator('#m-answer .prose').dispatchEvent('contextmenu');
          await page.getByRole('dialog', { name: 'Reply', exact: true }).getByRole('button', { name: 'Copy', exact: true }).click();
        } else {
          await page.locator('#m-answer').getByRole('button', { name: 'Copy', exact: true }).click();
        }
        assert.equal(await page.evaluate(() => window.copiedText), fixture.content, 'copy preserves source Markdown');
      }
      results.push({ profile, theme, fixture: fixture.id, warning, ...geometry, accessibility });
      await context.close();
    }
    console.log(`${phase}: ${profile}/${theme} complete`);
  }
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  if (process.env.CHAT_TEST_BASELINE) {
    const baseline = JSON.parse(await readFile(join(process.env.CHAT_TEST_BASELINE, 'results.json'), 'utf8'));
    for (const result of results) {
      const prior = baseline.find(item => item.profile === result.profile && item.theme === result.theme && item.fixture === result.fixture);
      assert.ok(prior, 'the matching baseline case exists');
      assert.deepEqual(result.accessibility, prior.accessibility, 'accessibility findings remain unchanged');
      assert.equal(result.smallControls, prior.smallControls, 'control geometry remains unchanged');
      if (result.fixture === 'backup-full') continue;
      const name = `${result.profile}-${result.theme}-${result.fixture}.png`;
      const oldPixels = await sharp(join(process.env.CHAT_TEST_BASELINE, name)).raw().toBuffer();
      const newPixels = await sharp(join(output, name)).raw().toBuffer();
      assert.equal(newPixels.equals(oldPixels), true, `${name}: pixels outside the backup failure case remain identical`);
    }
    for (const profile of new Set(results.map(item => item.profile))) {
      const worst = rows => Math.max(...rows.filter(item => item.profile === profile).map(item => item.shift));
      assert.ok(worst(results) <= worst(baseline), `${profile}: layout shift did not increase`);
    }
  }
  console.log(JSON.stringify({ phase, cases: results.length, output }));
} finally {
  await browser.close();
  server.kill();
}
