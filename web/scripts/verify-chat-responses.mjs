// Actual application/browser checks with isolated conversations and transport.
// Start a production preview, then set CHAT_TEST_URL to its local address.
import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const origin = process.env.CHAT_TEST_URL || 'http://127.0.0.1:5188';
const output = process.env.CHAT_TEST_OUTPUT || join(tmpdir(), 'vaelo-chat-responses');
await mkdir(output, { recursive: true });
const fixtures = [
  { id: 'json', request: 'Return ONLY valid JSON.', literal: true,
    content: JSON.stringify({ message: 'Ready!Next?Yes', math: '$a_b$', markup: '**literal**', example: '[untrusted_tool_result] [[remember: example]]', identifier: 'A'.repeat(180) }) },
  { id: 'csv', request: 'Return raw CSV only.', literal: true,
    content: 'name,value\nReady!Next,$a_b$\n**literal**,2' },
  { id: 'code', request: 'Explain this literal code example without widgets.',
    content: 'The example is literal:\n\n> ~~~tex\n> \\(unfinished and $a_b$\n> ~~~\n\n~~~text\n[untrusted_tool_result]literal[/untrusted_tool_result]\n~~~\n\nThe actual result is \\(y^2\\).' },
  { id: 'math', request: 'Explain this equation without widgets.',
    content: '## Result\n\nThe roots of \\(x^2-5x+6=0\\) are **2 and 3**.\n\n$$\n(x-2)(x-3)=0\n$$\n\nA ticket costs $5 and a second costs $10.\n\n| Item | Count |\n|---|---:|\n| First | 2 |\n| Second | 3 |' },
];
const results = [];
for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
  const browser = await browserType.launch({ headless: true });
  try {
    for (const width of [390, 1440]) for (const fixture of fixtures) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width < 768, hasTouch: width < 768, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        if (response.url().startsWith(origin) && response.status() >= 400)
          errors.push(`HTTP ${response.status()}: ${new URL(response.url()).pathname}`);
      });
      await page.addInitScript(fixture => {
        const seed = { id: '123e4567-e89b-12d3-a456-426614174000', title: 'Chat response review', updated: Date.now(), messages: [
          { id: 'question', role: 'user', content: fixture.request },
          { id: 'answer', role: 'assistant', content: fixture.content, completedAt: Date.now() },
        ] };
        sessionStorage.setItem('vaelo-guest-chats', JSON.stringify([seed]));
        localStorage.setItem('vaelo-onboarding', 'done');
        localStorage.setItem('vaelo-preferences', JSON.stringify({ theme: 'light', presentation: 'adaptive' }));
        sessionStorage.setItem('vaelo-open-chat:chat-review', seed.id);
      }, fixture);
      await page.route('**/api/**', route => {
        const url = new URL(route.request().url());
        const json = value => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
        if (url.pathname === '/api/session') return json({ user: { sub: 'chat-review', name: 'Chat Review', guest: true }, csrf: 'a'.repeat(64), configured: true });
        if (url.pathname === '/api/status') return json({ ready: true });
        if (url.pathname === '/api/feed') return route.fulfill({ contentType: 'text/event-stream', body: 'event: feed\ndata: {"seq":0}\n\n' });
        if (url.pathname === '/api/chats') return json({ entries: {} });
        if (url.searchParams.get('resource') === 'retention') return json({ days: 0, now: Date.now() });
        return json({ ok: true, items: [], records: [], shortcuts: [], reminders: [] });
      });
      await page.goto(origin);
      const answers = page.locator('.message[data-role=assistant] .prose');
      await answers.first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.ok(await page.evaluate(() => [...document.fonts].some(font => font.family.includes('Newsreader') && font.status === 'loaded')), 'shipped reading font is loaded');
      if (fixture.literal) {
        assert.equal(await answers.first().locator('pre.block-plain').textContent(), fixture.content);
        // Run through followReply's real streaming path, including frame flushes.
        await page.evaluate(content => {
          const original = window.fetch;
          window.fetch = (resource, init) => {
            if (new URL(typeof resource === 'string' ? resource : resource.url, location.href).pathname !== '/api/chat') return original(resource, init);
            const encoder = new TextEncoder();
            return Promise.resolve(new Response(new ReadableStream({
              start(controller) {
                let at = 0, sequence = 0;
                const emit = (name, data) => controller.enqueue(encoder.encode(`id: ${sequence++}\n${name ? `event: ${name}\n` : ''}data: ${JSON.stringify(data)}\n\n`));
                const timer = setInterval(() => {
                  if (at < content.length) {
                    emit('', { choices: [{ delta: { content: content.slice(at, at + 13) } }] });
                    at += 13;
                  } else {
                    clearInterval(timer);
                    emit('jarvis.complete', { ok: true });
                    controller.close();
                    window.__chatFixtureComplete = true;
                  }
                }, 25);
                init.signal?.addEventListener('abort', () => { clearInterval(timer); try { controller.close(); } catch {} }, { once: true });
              },
            }), { headers: { 'Content-Type': 'text/event-stream' } }));
          };
        }, fixture.content);
        await page.getByRole('textbox', { name: 'Message Vaelo' }).fill(fixture.request);
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await page.waitForFunction(() => window.__chatFixtureComplete && !document.querySelector('.composer[data-busy]'));
        assert.equal(await answers.last().locator('pre.block-plain').textContent(), fixture.content, 'streamed answer keeps exact values');
        await page.reload();
        await answers.last().locator('pre.block-plain').waitFor();
        assert.equal(await answers.last().locator('pre.block-plain').textContent(), fixture.content, 'reload keeps exact values');
      } else {
        assert.ok(await answers.first().locator('.katex').count() >= 1);
        if (fixture.id === 'code') {
          assert.match(await answers.first().innerText(), /\[untrusted_tool_result\]literal\[\/untrusted_tool_result\]/);
          assert.match(await answers.first().innerText(), /\\\(unfinished and \$a_b\$/);
          assert.equal(await answers.first().locator('.katex').count(), 1);
        } else assert.ok(await answers.first().locator('.katex-display').count() >= 1);
      }
      assert.equal(await answers.last().locator('.block-fallback,.math-pending').count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${engine}/${width}/${fixture.id}: page fits viewport`);
      assert.deepEqual(errors, []);
      await answers.last().scrollIntoViewIfNeeded();
      const name = `${engine}-${width}-${fixture.id}`;
      await page.screenshot({ path: join(output, name + '.png') });
      results.push({ name, passed: true });
      await context.close();
    }
  } finally { await browser.close(); }
}
await writeFile(join(output, 'results.json'), JSON.stringify({ origin, results }, null, 2));
console.log(JSON.stringify({ passed: results.length, output }));
