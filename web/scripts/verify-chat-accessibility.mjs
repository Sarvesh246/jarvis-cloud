// Local production preview only; requests never reach providers or user storage.
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { accessibilityFixtures } from '../tests/fixtures/chat-outputs/accessibility.js';

const require = createRequire(import.meta.url);
const axe = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const phase = process.env.CHAT_TEST_PHASE || 'after';
const output = process.env.CHAT_TEST_OUTPUT || `../.codex/visual/2026-10-26-chat-accessibility/${phase}`;
const recordOnly = process.env.CHAT_TEST_RECORD_ONLY === '1';
const port = process.env.CHAT_TEST_PORT || '5196';
const origin = `http://127.0.0.1:${port}`;
const engine = process.env.CHAT_TEST_BROWSER === 'webkit' ? webkit : chromium;
const diagnostics = new Set();
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', port, '--strictPort', ...(process.env.CHAT_TEST_DIST ? ['--outDir', process.env.CHAT_TEST_DIST] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = '';
server.stdout.on('data', data => { serverOutput += data; });
server.stderr.on('data', data => { serverOutput += data; });
let browser;
const results = [];
try {
  browser = await engine.launch();
  for (let attempt = 0; ; attempt++) {
    assert.equal(server.exitCode, null, 'the owned preview must stay running');
    try { if (serverOutput.includes(origin) && (await fetch(origin)).ok) break; } catch {}
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
    for (const fixture of accessibilityFixtures) {
      if (process.env.CHAT_TEST_FIXTURE && process.env.CHAT_TEST_FIXTURE !== fixture.id) continue;
      console.log(`${phase}: checking ${profile}/${theme}/${fixture.id}`);
      const context = await browser.newContext({ ...options, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [], commits = [], requests = [];
      let feedCount = 0;
      let holdReply = false;
      let releaseReply;
      const sent = [];
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => errors.push(error.stack || error.message));
      page.on('console', message => {
        if (message.text() === 'Service Worker registration blocked by Playwright') return;
        if (engine === webkit && message.text() === 'Viewport argument key "interactive-widget" not recognized and ignored.') {
          diagnostics.add(message.text());
          return;
        }
        if (['warning', 'error'].includes(message.type())) errors.push(message.text());
      });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        requests.push(`${route.request().method()} ${url.pathname}${url.search}`);
        const json = value => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
        if (url.pathname === '/api/session') return json({ user: { sub: 'accessibility-review', name: 'User' }, csrf: 'a'.repeat(64), configured: true });
        if (url.pathname === '/api/status') return json({ ready: true });
        if (url.pathname === '/api/chat') {
          sent.push(route.request().postDataJSON());
          const respond = () => route.fulfill({ contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"Mocked reply."}}]}\n\nevent: jarvis.complete\ndata: {"ok":true}\n\n' });
          if (!holdReply) return respond();
          return new Promise(resolve => { releaseReply = () => respond().then(resolve, resolve); });
        }
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
        const chat = { id: '123e4567-e89b-12d3-a456-426614174000', title: 'Accessibility review', updated: now, messages: [
          { id: 'question', role: 'user', content: fixture.user || 'Please explain this example.', ...(fixture.user ? { text: 'A saved multipart question.' } : {}) },
          { id: 'answer', role: 'assistant', content: fixture.content, completedAt: now, ...(fixture.running ? { running: true } : {}), ...(fixture.versionCount ? { version: 1, versions: Array.from({ length: fixture.versionCount }, (_, i) => ({ content: i === 1 ? fixture.content : `Saved version ${i + 1}.` })) } : {}) },
        ] };
        localStorage.setItem('vaelo-sync:accessibility-review', JSON.stringify({ chats: [chat], base: {} }));
        localStorage.setItem('vaelo-onboarding', 'done');
        localStorage.setItem('vaelo-preferences', JSON.stringify({ theme, presentation: 'minimal' }));
        sessionStorage.setItem('vaelo-open-chat:accessibility-review', chat.id);
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
      const source = await page.evaluate(() => JSON.parse(localStorage.getItem('vaelo-sync:accessibility-review')).chats[0].messages[1].content);
      assert.deepEqual(source, fixture.content, 'saved and legacy message content stay exact');
      await page.addScriptTag({ content: axe });
      const accessibility = await page.evaluate(async () => (await axe.run(document, { rules: { 'color-contrast': { enabled: true } } })).violations.map(v => ({ id: v.id, count: v.nodes.length, nodes: v.nodes.map(n => ({ html: n.html, target: n.target })) })));
      const targets = await page.locator('#m-answer .message-actions-phone button').evaluateAll(buttons => buttons.map(button => { const r = button.getBoundingClientRect(); return { label: button.getAttribute('aria-label') || button.textContent.trim(), x: r.x, y: r.y, width: r.width, height: r.height }; }));
      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        shift: window.shifts,
        smallControls: [...document.querySelectorAll('button, input, textarea')].filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
        }).length,
      }));
      assert.equal(geometry.overflow, false, `${profile}/${fixture.id} page overflow`);
      if (!recordOnly) {
        for (const violation of accessibility) {
          assert.ok(violation.nodes.every(node => !node.target.some(target => /header-find|source-strip/.test(target))),
            'Find and the source strip include their visible text in their accessible names');
        }
        for (const target of targets) {
          assert.ok(target.width >= 44 && target.height >= 44, `${target.label}: 44px touch target`);
          assert.ok(target.x >= 0 && target.x + target.width <= options.viewport.width, `${target.label}: no clipped target`);
        }
      }
      assert.deepEqual(errors, []);
      await page.screenshot({ path: join(output, `${profile}-${theme}-${fixture.id}.png`), animations: 'disabled', caret: 'hide' });
      let copyFailure = false;
      if (!fixture.running) {
        if (options.isMobile) {
          await page.locator('#m-answer .message-actions-phone').getByRole('button', { name: 'Copy', exact: true }).tap();
        } else {
          await page.locator('#m-answer').getByRole('button', { name: 'Copy', exact: true }).click();
        }
        try {
          await page.waitForFunction(source => window.copiedText === source, fixture.content, { timeout: recordOnly ? 1000 : 10000 });
        } catch (error) {
          if (!recordOnly) throw error;
          copyFailure = true;
        }
        if (!copyFailure) assert.equal(await page.evaluate(() => window.copiedText), fixture.content, 'copy preserves source Markdown');
      }
      if (!recordOnly && fixture.id === 'sources-versions') {
        const answer = page.locator('#m-answer');
        const activate = async button => {
          if (options.isMobile) await button.tap();
          else {
            await button.focus();
            await page.keyboard.press('Tab');
            await page.keyboard.press('Shift+Tab');
            assert.equal(await button.evaluate(el => el === document.activeElement && el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none'), true, 'keyboard focus is visible');
            await page.keyboard.press('Enter');
          }
        };
        await activate(answer.getByRole('button', { name: 'Previous version', exact: true }));
        await answer.locator('.prose').getByText('Saved version 1.', { exact: true }).waitFor();
        await activate(answer.getByRole('button', { name: 'Next version', exact: true }));
        await answer.getByRole('link', { name: 'Reference 1', exact: true }).waitFor();
        if (options.isMobile) {
          await answer.getByRole('button', { name: 'More', exact: true }).tap();
          await page.getByRole('dialog', { name: 'Reply', exact: true }).waitFor();
          await page.screenshot({ path: join(output, `${profile}-${theme}-reply-menu.png`), animations: 'disabled' });
          await page.keyboard.press('Escape');
          await page.locator('.sheet[aria-label="Reply"]').waitFor({ state: 'hidden' });
        }
        await activate(page.locator(options.isMobile ? '#m-answer .sources-pill' : '#m-answer .source-strip'));
        if (options.isMobile) {
          await page.getByRole('dialog', { name: 'Sources', exact: true }).waitFor();
          await page.keyboard.press('Escape');
          await page.locator('.sheet[aria-label="Sources"]').waitFor({ state: 'hidden' });
        } else {
          await page.getByRole('button', { name: 'Close workspace', exact: true }).waitFor();
          await page.getByRole('button', { name: 'Close workspace', exact: true }).click();
          await page.locator('.workspace').waitFor({ state: 'hidden' });
        }
        if (!options.isMobile) {
          await activate(page.locator('.header-find'));
          await page.getByRole('searchbox', { name: 'Search commands', exact: true }).waitFor();
          await page.keyboard.press('Escape');
        }
        await activate(answer.getByRole('button', { name: 'Try again', exact: true }));
        await page.locator('.thread .prose').getByText('Mocked reply.', { exact: true }).waitFor();
        assert.equal(sent.length, 1, 'regenerate sends exactly once');
        assert.equal(sent[0].messages.find(message => message.role === 'user').content, 'Please explain this example.');
        const versions = await page.evaluate(() => JSON.parse(localStorage.getItem('vaelo-sync:accessibility-review')).chats[0].messages[1].versions);
        assert.ok(versions.some(version => version.content === fixture.content), 'regenerate retains the original saved version');
        const question = page.locator('#m-question');
        if (options.isMobile) {
          await question.locator('.prose').dispatchEvent('contextmenu');
          await page.getByRole('dialog', { name: 'Your message', exact: true }).getByRole('button', { name: 'Edit and resend', exact: true }).tap();
        } else await activate(question.getByRole('button', { name: 'Edit', exact: true }));
        await question.getByRole('textbox', { name: 'Edit your message', exact: true }).waitFor();
        assert.equal(await question.getByRole('textbox', { name: 'Edit your message', exact: true }).inputValue(), 'Please explain this example.');
        await activate(question.getByRole('button', { name: 'Cancel', exact: true }));
        const input = page.getByRole('textbox', { name: 'Message Vaelo', exact: true });
        await input.fill('Keyboard test');
        await input.press('Shift+Enter');
        assert.equal(await input.inputValue(), 'Keyboard test\n');
        assert.equal(sent.length, 1, 'Shift+Enter does not send');
        if (options.isMobile) {
          await page.setViewportSize({ width: 390, height: 464 });
          await input.focus();
          const composer = await page.locator('.composer').boundingBox();
          assert.ok(composer.y >= 0 && composer.y + composer.height <= 464, 'composer stays visible with a shortened keyboard viewport');
          assert.ok(await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16));
          await page.screenshot({ path: join(output, `${profile}-${theme}-keyboard.png`), animations: 'disabled' });
        }
        holdReply = true;
        await input.press('Enter');
        if (options.isMobile) {
          assert.equal(await input.inputValue(), 'Keyboard test\n\n', 'phone Enter keeps writing a new line');
          assert.equal(sent.length, 1);
          await page.getByRole('button', { name: 'Send', exact: true }).tap();
        }
        await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
        const stop = page.getByRole('button', { name: 'Stop', exact: true });
        await activate(stop);
        await page.getByRole('button', { name: 'Send', exact: true }).waitFor();
        releaseReply?.();
        await page.waitForTimeout(100);
        assert.equal(sent.length, 2, 'sending runs once and Stop does not submit again');
        assert.equal(await page.locator('.thread .prose').getByText('Mocked reply.', { exact: true }).count(), 1, 'a stopped request cannot append a late reply');
        await page.screenshot({ path: join(output, `${profile}-${theme}-stopped.png`), animations: 'disabled' });
        if (options.isMobile) await page.setViewportSize({ width: 390, height: 844 });
        if (options.isMobile) await page.getByRole('button', { name: 'Open conversations', exact: true }).tap();
        await activate(page.getByRole('button', { name: 'New conversation', exact: true }));
        await page.locator('.welcome').waitFor();
        if (options.isMobile) await page.getByRole('button', { name: 'Open conversations', exact: true }).tap();
        await activate(page.locator('.rail-link').filter({ hasText: 'Accessibility review' }));
        await page.locator('#m-question').waitFor();
        assert.deepEqual(errors, []);
      }
      results.push({ profile, theme, fixture: fixture.id, targets, copyFailure, ...geometry, accessibility });
      await context.close();
    }
    console.log(`${phase}: ${profile}/${theme} complete`);
  }
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  if (process.env.CHAT_TEST_BASELINE) {
    const baseline = JSON.parse(await readFile(join(process.env.CHAT_TEST_BASELINE, 'results.json'), 'utf8'));
    for (const result of results) {
      const prior = baseline.find(row => row.profile === result.profile && row.theme === result.theme && row.fixture === result.fixture);
      assert.ok(prior, 'a matching baseline case exists');
      for (const violation of result.accessibility) {
        assert.ok(violation.count <= (prior.accessibility.find(item => item.id === violation.id)?.count || 0), `${violation.id}: no additional axe violations`);
      }
    }
  }
  console.log(JSON.stringify({ phase, cases: results.length, output, diagnostics: [...diagnostics] }));
} finally {
  await browser?.close();
  server.kill();
}
