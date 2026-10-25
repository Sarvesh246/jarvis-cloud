// Run against a local production preview. All API calls are intercepted.
import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { editingFixtures } from '../tests/fixtures/chat-outputs/message-editing.js';

const origin = process.env.CHAT_TEST_URL || 'http://127.0.0.1:5194';
const output = process.env.CHAT_TEST_OUTPUT || '../.codex/visual/message-editing';
const before = process.env.CHAT_TEST_BEFORE === '1';
await mkdir(output, { recursive: true });
const engine = process.env.CHAT_TEST_BROWSER || 'chromium';
const browser = await ({ chromium, webkit })[engine].launch({ headless: true });
const results = [];
const browserDiagnostics = new Set();
try {
  for (const width of (process.env.CHAT_TEST_WIDTH ? [Number(process.env.CHAT_TEST_WIDTH)] : [1440, 820, 390])) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 390, isMobile: width === 390, serviceWorkers: 'block' });
    const errors = [], sent = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const json = value => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
      if (url.pathname === '/api/session') return json({ user: { sub: 'edit-review', name: 'User', guest: true }, csrf: 'a'.repeat(64), configured: true });
      if (url.pathname === '/api/status') return json({ ready: true });
      if (url.pathname === '/api/feed') return route.fulfill({ contentType: 'text/event-stream', body: 'event: feed\ndata: {"seq":0}\n\n' });
      if (url.pathname === '/api/chats') return json({ entries: {} });
      if (url.pathname === '/api/chat') {
        if (route.request().method() === 'POST') sent.push(route.request().postDataJSON());
        return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"Fixture reply."}}]}\n\nevent: jarvis.complete\ndata: {"ok":true}\n\n' });
      }
      return json({ ok: true, items: [], records: [], shortcuts: [], reminders: [], days: 0, now: Date.now() });
    });
    for (const fixture of editingFixtures) {
      console.log(`${before ? 'before' : 'after'} ${width}/${theme}/${fixture.id}`);
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (message.type() !== 'error') return;
        // WebKit reports Chromium's existing viewport keyboard hint as a diagnostic.
        if (engine === 'webkit' && message.text() === 'Viewport argument key "interactive-widget" not recognized and ignored.') {
          browserDiagnostics.add(message.text());
        } else errors.push(message.text());
      });
      await page.addInitScript(({ fixture, theme }) => {
        const seed = { id: '123e4567-e89b-12d3-a456-426614174000', title: 'Message editing', updated: Date.now(), messages: [
          ...Array.from({ length: fixture.priorTurns || 0 }, (_, i) => [
            { id: `prior-user-${i}`, role: 'user', content: `Earlier question ${i + 1}.` },
            { id: `prior-answer-${i}`, role: 'assistant', content: `Earlier answer ${i + 1}.`, completedAt: Date.now() },
          ]).flat(),
          { id: 'question', role: 'user', content: fixture.content },
          { id: 'answer', role: 'assistant', content: 'Fixture reply.', completedAt: Date.now() },
        ] };
        sessionStorage.setItem('vaelo-guest-chats', JSON.stringify([seed]));
        localStorage.setItem('vaelo-onboarding', 'done');
        localStorage.setItem('vaelo-preferences', JSON.stringify({ theme, presentation: 'minimal' }));
        sessionStorage.setItem('vaelo-open-chat:edit-review', seed.id);
      }, { fixture, theme });
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      const message = page.locator('#m-question');
      await message.waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(output, `${width}-${theme}-${fixture.id}-finished.png`) });
      const open = async () => {
        if (width === 390) {
          await message.locator('.prose').dispatchEvent('contextmenu');
          await page.getByRole('button', { name: 'Edit and resend', exact: true }).click();
          await page.locator('.sheet-layer').waitFor({ state: 'detached' });
        } else {
          const edit = message.getByRole('button', { name: 'Edit', exact: true });
          await edit.scrollIntoViewIfNeeded();
          await edit.focus();
          await edit.press('Enter');
        }
      };
      await open();
      const field = page.getByRole('textbox', { name: 'Edit your message' });
      await field.waitFor().catch(async error => {
        await page.screenshot({ path: join(output, `failure-${width}-${theme}-${fixture.id}.png`) });
        console.log(await message.innerHTML());
        throw error;
      });
      await field.scrollIntoViewIfNeeded();
      assert.equal(await field.inputValue(), fixture.content);
      const geometry = await field.evaluate(el => ({ height: el.clientHeight, scrollHeight: el.scrollHeight, top: el.getBoundingClientRect().top, bottom: el.closest('form').getBoundingClientRect().bottom, caret: el.selectionStart, overflow: getComputedStyle(el).overflowY, direction: getComputedStyle(el).direction }));
      const name = `${width}-${theme}-${fixture.id}`;
      await page.screenshot({ path: join(output, name + '.png') });
      results.push({ name, ...geometry });
      if (!before) {
        assert.equal(await field.evaluate(el => document.activeElement === el), true, `${name}: editor owns focus`);
        const actionsVisible = () => field.evaluate(el => {
          const actions = el.form.querySelector('.edit-actions').getBoundingClientRect();
          const composer = document.querySelector('.composer').getBoundingClientRect();
          const jump = document.querySelector('.jump');
          const limit = jump ? Math.min(composer.top, jump.getBoundingClientRect().top) : composer.top;
          return actions.top >= 0 && actions.bottom <= Math.min(innerHeight, limit);
        });
        assert.equal(await actionsVisible(), true, `${name}: edit actions stay above composer`);
        assert.ok(geometry.height <= 450, `${name}: editing stays within half the viewport`);
        assert.ok(geometry.bottom - geometry.top < 520, `${name}: text and actions fit together`);
        assert.equal(geometry.caret, fixture.content.length, 'caret begins at end');
        if (fixture.id !== 'short') assert.ok(geometry.scrollHeight > geometry.height, `${name}: long text scrolls internally`);
        if (fixture.id === 'rtl') assert.equal(geometry.direction, 'rtl');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (fixture.id === 'long') {
          await page.setViewportSize({ width, height: 480 });
          const compactHeight = await field.evaluate(el => el.clientHeight);
          assert.ok(compactHeight <= 216, `${name}: editor shrinks with the viewport`);
          await field.scrollIntoViewIfNeeded();
          await field.evaluate(el => el.form.scrollIntoView({ block: 'end', behavior: 'instant' }));
          assert.equal(await actionsVisible(), true, `${name}: compact actions stay above composer`);
          await page.screenshot({ path: join(output, `${name}-compact.png`) });
          await page.setViewportSize({ width, height: 900 });
        }
        await field.press('Shift+Enter');
        assert.equal(await field.count(), 1, 'Shift+Enter keeps editing');
        assert.equal(await field.inputValue(), fixture.content + '\n');
        await field.fill(fixture.content + '\nEdited 👩🏽‍💻');
        await field.press('Escape');
        await field.waitFor({ state: 'detached', timeout: 3000 }).catch(async error => {
          await page.screenshot({ path: join(output, `cancel-failure-${name}.png`) });
          console.log(await message.innerHTML());
          throw error;
        });
        assert.equal(await message.locator('.prose').textContent(), fixture.content, 'cancel preserves original');
        await open();
        assert.equal(await field.inputValue(), fixture.content, 'reopening restores original');
        if (width !== 390) {
          await field.press('Tab');
          assert.equal(await message.getByRole('button', { name: 'Cancel', exact: true }).evaluate(el => el === document.activeElement), true);
          await page.keyboard.press('Tab');
          assert.equal(await message.getByRole('button', { name: 'Send', exact: true }).evaluate(el => el === document.activeElement), true);
          await field.focus();
        }
        // Candidate confirmation must never submit or cancel the editor.
        await field.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 });
        assert.equal(await field.count(), 1);
        await field.fill('');
        assert.equal(await message.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
        const changed = fixture.content + '\nEdited 👩🏽‍💻';
        await field.fill(changed);
        const sentBefore = sent.length;
        await message.getByRole('button', { name: 'Send', exact: true }).click();
        await field.waitFor({ state: 'detached' });
        assert.equal(await page.locator('.message[data-role=user] .prose').last().textContent(), changed);
        await page.waitForFunction(() => !document.querySelector('.composer[data-busy]'));
        assert.ok(sent.length > sentBefore, 'edit uses intercepted transport');
        assert.equal(sent.at(-1).messages.filter(message => message.role === 'user').at(-1).content, changed, 'wire message preserves edited Unicode and all lines');
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ engine, before, cases: results.length, output, browserDiagnostics: [...browserDiagnostics] }));
