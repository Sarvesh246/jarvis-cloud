// Run against `npm run dev -- --port 5179`. API responses below are explicit
// fixtures: this exercises real React behavior without changing owner data.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const origin = process.env.SLASH_TEST_URL || 'http://127.0.0.1:5179';
const output = process.env.SLASH_SCREENSHOT_DIR || join(tmpdir(), 'vaelo-slash-review');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
const seedId = '123e4567-e89b-12d3-a456-426614174000';
async function fixture(viewport, isMobile = false) {
  const context = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage(); const errors = [], requests = [], mutations = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  const seed = { id: seedId, title: 'Launch notes', updated: Date.now(), messages: [
    { id: 'u1', role: 'user', content: 'Help plan the launch.' },
    { id: 'a1', role: 'assistant', content: 'Review the proposal and test the release.', completedAt: Date.now(), usage: { prompt_tokens: 120, completion_tokens: 30 }, plan: { items: [{ id: 'task1', content: 'Test the release', status: 'pending' }] } },
  ] };
  await page.addInitScript(({ seed }) => {
    if (!localStorage.getItem('slash-fixture')) {
      localStorage.setItem('slash-fixture', 'yes');
      localStorage.setItem('vaelo-sync:ui-test', JSON.stringify({ chats: [seed], base: {}, deleted: [] }));
      sessionStorage.setItem('vaelo-open-chat:ui-test', seed.id);
    }
    localStorage.setItem('vaelo-onboarding', 'done');
  }, { seed });
  let memory = { enabled: true, items: [{ id: 'note1', text: 'I prefer concise answers.', source: 'you', created: Date.now(), updated: Date.now() }] };
  let commandData = { shortcuts: [], reminders: [] }; const entries = {}, parts = new Map();
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()); let body; try { body = req.postDataJSON(); } catch {}
    const json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname === '/api/session' && url.searchParams.get('resource') === 'usage') return json({ total: 123450, input: 100000, output: 23450, cached: 50000, attempts: 12, unreported: 1, since: '2026-10-23T00:00:00Z', checkedAt: new Date().toISOString() });
    if (url.pathname === '/api/session' && url.searchParams.get('resource') === 'devices') return json({ available: true, devices: [{ id: 'this', label: 'This browser', current: true, seen: Date.now() }] });
    if (url.pathname === '/api/session') return json({ user: { sub: 'ui-test', name: 'Test User', email: 'test@example.test' }, csrf: 'a'.repeat(64), configured: true });
    if (url.pathname === '/api/status') return json({ ready: true });
    if (url.pathname === '/api/feed') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: feed\ndata: {"seq":0}\n\n' });
    if (url.pathname === '/api/chats' && url.searchParams.get('resource') === 'memory') {
      if (body) { mutations.push(body); if (body.action === 'add') memory.items.push({ id: 'saved-note', text: body.text, source: 'you', created: Date.now(), updated: Date.now() });
        if (body.action === 'remove') memory.items = memory.items.filter(item => item.id !== body.id); if (body.action === 'enable') memory.enabled = body.enabled; }
      return json(memory);
    }
    if (url.pathname === '/api/chats' && url.searchParams.get('resource') === 'commands') {
      if (body) { mutations.push(body);
        if (body.action === 'shortcut-save') commandData.shortcuts.push({ name: body.name, prompt: body.prompt });
        if (body.action === 'shortcut-remove') commandData.shortcuts = commandData.shortcuts.filter(item => item.name !== body.name);
        if (body.action === 'reminder-add') commandData.reminders.push({ id: 'reminder1', ...body, done: false });
        if (body.action === 'reminder-remove') commandData.reminders = commandData.reminders.filter(item => item.id !== body.id);
      } return json(commandData);
    }
    if (url.pathname === '/api/chats' && url.searchParams.get('resource') === 'retention') return json({ days: 0, now: Date.now() });
    if (url.pathname === '/api/chats') {
      if (body?.action === 'part') { parts.set(`${body.id}:${body.version}:${body.part}`, body.text); return json({ ok: true }); }
      if (body?.action === 'commit') { entries[body.id] = { version: body.version, parts: body.parts, deleted: body.deleted }; return json({ entry: entries[body.id] }); }
      if (url.searchParams.has('id')) return json({ text: parts.get(`${url.searchParams.get('id')}:${url.searchParams.get('version')}:${url.searchParams.get('part')}`) });
      return json({ entries });
    }
    if (url.pathname === '/api/chat') {
      if (body) requests.push(body);
      if (body?.messages.at(-1)?.content?.includes('delayed fixture')) await new Promise(resolve => setTimeout(resolve, 1500));
      const answer = 'A compact summary: review the proposal and test the release.';
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: 'stop' }], usage: { prompt_tokens: 150, completion_tokens: 20 } })}\n\nevent: jarvis.complete\ndata: {"ok":true}\n\ndata: [DONE]\n\n` });
    }
    if (url.pathname === '/api/work') return json({ records: [] });
    return json({ ok: true, items: [], records: [] });
  });
  await page.goto(origin); const input = page.getByRole('textbox', { name: 'Message Vaelo', exact: true }); await input.waitFor();
  async function run(command) { await input.fill(`/${command} `); await page.getByRole('button', { name: 'Send', exact: true }).click(); }
  async function close() { await page.getByRole('button', { name: 'Close command panel' }).click(); await page.locator('.slash-dialog').waitFor({ state: 'detached' }); }
  return { context, page, input, run, close, errors, requests, mutations };
}
try {
  const f = await fixture({ width: 1440, height: 1000 }); const { page, input, run, close } = f;
  await input.fill('/'); await page.getByRole('listbox', { name: 'Slash commands' }).waitFor();
  assert.equal(await page.getByRole('option').count(), 43);
  await page.screenshot({ path: join(output, 'desktop-menu.png') });
  await input.fill('/us'); assert.equal(await page.getByRole('option').first().getAttribute('id'), 'slash-usage');
  await input.press('Tab'); assert.equal(await input.inputValue(), '/usage ');
  await input.press('Enter'); await page.getByRole('heading', { name: 'Your cloud usage' }).waitFor();
  await page.getByText('123,450', { exact: true }).first().waitFor();
  await page.screenshot({ path: join(output, 'desktop-usage.png') }); await close();
  await input.fill('/'); await input.press('ArrowDown'); assert.equal(await input.getAttribute('aria-activedescendant'), 'slash-usage');
  await input.press('Escape'); assert.equal(await page.getByRole('listbox').count(), 0); assert.equal(await input.inputValue(), '/');
  await input.fill('/no-such-command'); await page.getByText('No matching commands. Try /help.').waitFor(); await input.press('Enter');
  assert.equal(f.requests.length, 0); await input.fill('');
  const panels = { help: 'Commands', context: 'Conversation context', status: 'Vaelo status', search: 'Find a conversation', rename: 'Rename conversation',
    theme: 'Appearance', presentation: 'Reply presentation', profile: 'About you', files: 'Pending attachments', branch: 'Branch conversation',
    export: 'Export conversation', copy: 'Copy conversation', plan: 'Current plan', memory: 'Account memory', 'remember a durable preference': 'Remember a note',
    forget: 'Forget a note', remind: 'Create a reminder', schedule: 'Your reminders', connect: 'Account connections', model: 'Model routing', tools: 'Response tools', shortcuts: 'Personal shortcuts' };
  for (const [command, title] of Object.entries(panels)) { await run(command); await page.getByRole('heading', { name: title, exact: true }).waitFor(); await close(); }
  await run('remember I like evidence'); await page.getByRole('button', { name: 'Save note' }).click(); await page.getByText('I like evidence', { exact: true }).waitFor(); await close();
  await run('forget evidence'); await page.getByRole('button', { name: 'Forget', exact: true }).click(); await page.getByText('I like evidence', { exact: true }).waitFor({ state: 'detached' }); await close();
  await run('shortcuts'); await page.getByLabel('Shortcut name').fill('review'); await page.getByLabel('Prompt', { exact: true }).fill('Review my launch plan.');
  await page.getByRole('button', { name: 'Save shortcut' }).click(); await page.getByRole('button', { name: 'review', exact: true }).waitFor(); await close();
  await run('shortcuts review'); await page.waitForFunction(() => document.querySelector('textarea[aria-label="Message Vaelo"]')?.value === 'Review my launch plan.');
  await run('remind in 20m Review the launch'); await page.getByRole('button', { name: 'Create reminder' }).click(); await page.locator('.slash-row').filter({ hasText: 'Review the launch' }).waitFor();
  const calendarDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Calendar', exact: true }).click(); await calendarDownload;
  await page.getByRole('button', { name: 'Delete', exact: true }).click(); await close();
  const exportDownload = page.waitForEvent('download'); await run('export json'); await exportDownload;
  await run('copy last'); assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Review the proposal/);
  await run('theme dark'); assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await input.fill('/'); await page.screenshot({ path: join(output, 'desktop-dark-menu.png') }); await input.press('Escape');
  await run('theme light'); await run('presentation minimal'); assert.equal(await page.locator('html').getAttribute('data-presentation'), 'minimal');
  await run('rename Reviewed launch'); await run('pin'); await run('archive'); await run('search Reviewed launch');
  await page.getByRole('button', { name: 'Reviewed launch · archived', exact: true }).waitFor(); await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reviewed launch', exact: true }).click();
  await run('branch'); await page.locator('.slash-dialog-body button').first().click();
  await run('new');
  const chooser = page.waitForEvent('filechooser'); await input.fill('/attach'); await input.press('Enter'); const fileChooser = await chooser;
  await fileChooser.setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('A sample proposal to summarize.') });
  await run('files'); await page.getByRole('button', { name: 'Remove', exact: true }).click(); await close();
  for (const command of ['summarize', 'research launch readiness', 'explain caching', 'rewrite be concise', 'translate Spanish', 'compare A and B', 'check the claim', 'continue', 'retry', 'compact']) {
    const before = f.requests.length, reply = page.waitForResponse(response => response.url().includes('/api/chat') && response.request().method() === 'POST'); await run(command); await reply;
    await page.waitForFunction(() => !document.querySelector('.composer[data-busy]'));
    assert.equal(f.requests.length, before + 1, command);
  }
  const compactReply = page.waitForResponse(response => response.url().endsWith('/api/chat') && response.request().method() === 'POST');
  await run('explain after compaction'); await compactReply; await page.waitForFunction(() => !document.querySelector('.composer[data-busy]'));
  assert.match(f.requests.at(-1).messages[0].content, /Earlier conversation summary/);
  await run('explain delayed fixture'); await page.locator('.composer[data-busy]').waitFor();
  await input.fill('/stop'); await input.press('Enter'); await page.waitForFunction(() => !document.querySelector('.composer[data-busy]'));
  await run('temporary'); await input.fill('This temporary phrase must not persist');
  const temporaryReply = page.waitForResponse(response => response.url().endsWith('/api/chat') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send', exact: true }).click(); await temporaryReply;
  await page.waitForFunction(() => !document.querySelector('.composer[data-busy]'));
  assert.equal(f.requests.at(-1).temporary, true);
  const saved = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join('\n'));
  assert.ok(!saved.includes('This temporary phrase must not persist'));
  await run('context'); await page.screenshot({ path: join(output, 'desktop-context.png') }); await close();
  await run('workspace'); await page.getByRole('button', { name: /Close Workroom/i }).first().click().catch(async () => { await page.keyboard.press('Escape'); });
  await run('detach'); await run('library'); await page.reload(); await input.waitFor(); await run('settings'); await page.keyboard.press('Escape');
  assert.deepEqual(f.errors, []); await f.context.close();
  const mobile = await fixture({ width: 390, height: 844 }, true);
  await mobile.input.fill('/'); await mobile.page.getByRole('listbox').waitFor();
  const box = await mobile.page.locator('.slash-menu').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 845);
  await mobile.page.screenshot({ path: join(output, 'mobile-menu.png') });
  await mobile.page.getByRole('option', { name: /\/context / }).tap(); await mobile.page.getByRole('heading', { name: 'Conversation context' }).waitFor();
  await mobile.page.screenshot({ path: join(output, 'mobile-context.png') }); await mobile.close();
  await mobile.run('usage all'); await mobile.page.getByRole('heading', { name: 'Your cloud usage' }).waitFor();
  await mobile.page.screenshot({ path: join(output, 'mobile-usage.png') }); await mobile.close();
  await mobile.page.setViewportSize({ width: 390, height: 420 }); await mobile.input.fill('/'); await mobile.page.getByRole('listbox').waitFor();
  const small = await mobile.page.locator('.slash-menu').boundingBox(); assert.ok(small.y >= 0 && small.y + small.height <= 421);
  assert.deepEqual(mobile.errors, []); await mobile.context.close();
  console.log(JSON.stringify({ passed: true, commands: 43, screenshots: output, note: 'API fixtures; real React desktop/mobile flows, no production data changed.' }));
} catch (error) { failures.push(error.stack || String(error));
  for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error; }
finally { await browser.close(); }
