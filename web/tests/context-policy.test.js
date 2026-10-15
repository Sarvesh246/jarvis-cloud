import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT_POLICY as policy } from '../shared/context-policy.js';
import { chatInput, LIMITS } from '../server/chat.js';
import { fitHistory, wireMessage, readAttachment, MESSAGE_LIMIT } from '../src/lib/attachments.js';
import { continueRequest, retryRequest } from '../src/lib/continuation.js';
import { buildWorkContext, withSelectedWork } from '../server/work-context.js';
import { WORK_LIMITS } from '../shared/work-records.js';

const conversationId = '123e4567-e89b-12d3-a456-426614174000';

test('long code replies retain their middle and pass from the browser to the API', () => {
  const code = 'opening\n' + 'line();\n'.repeat(9_000) + 'middleMarker();\n' + 'line();\n'.repeat(5_000) + 'closing';
  const wired = wireMessage({ role: 'assistant', content: code });
  assert.equal(wired.content, code);
  const turns = [{ role: 'user', content: 'Write the program' }, wired, { role: 'user', content: 'Change middleMarker' }];
  const fitted = fitHistory(turns);
  assert.equal(fitted.dropped, 0);
  const accepted = chatInput({ conversationId, messages: fitted.messages });
  assert.equal(accepted.messages[1].content, code);
});

test('history over the old limit retains modes, and continuations still fit at the new limit', () => {
  const turns = Array.from({ length: 81 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user',
    content: 'x'.repeat(3_000), ...(i % 2 ? {} : { mode: { style: 'thorough', research: true, role: 'skeptic' } }) }));
  const fitted = fitHistory(turns);
  assert.equal(fitted.dropped, 0);
  assert.doesNotThrow(() => chatInput({ conversationId, messages: fitted.messages }));
  const next = continueRequest({ conversationId, messages: fitted.messages, work: { id: 'saved', revision: 'one' } }, 'partial '.repeat(30_000), 'new');
  assert.doesNotThrow(() => chatInput(next));
  assert.deepEqual(next.work, { id: 'saved', revision: 'one' });
  assert.equal(next.messages.at(-3).content, turns.at(-1).content);
  assert.equal(next.messages.at(-1).mode.role, 'skeptic');
});

test('a full saved workspace fits whole and a busy conversation shares its budget', async () => {
  const documents = [120_000, 120_000, 60_000].map((chars, i) => ({ id: `doc${i}`, slot: 'files', name: `doc${i}.txt`, sha: String(i).repeat(64), chars }));
  const texts = Object.fromEntries(documents.map(d => [d.sha, 'x'.repeat(d.chars)]));
  const record = { id: 'saved', revision: 'one', workspaceId: 'custom', title: 'Review my files', brief: 'Read them all', documents };
  const fresh = buildWorkContext(record, texts);
  assert.equal(fresh.trimmed, false);
  for (const doc of documents) assert.ok(fresh.text.includes(texts[doc.sha]));
  const history = chatInput({ conversationId, messages: [{role: 'user', content: 'u'.repeat(120_000)},
    {role: 'assistant', content: 'a'.repeat(120_000)}, {role: 'user', content: 'Review the files'}], work: {id:'saved', revision:'one'} });
  const selected = await withSelectedWork(history, {sub:'one'}, async () => ({record, documents:texts}));
  const total = selected.messages.reduce((n, m) => n + m.content.length, 0);
  assert.ok(total <= WORK_LIMITS.requestChars + 2_000);
  assert.match(selected.messages.at(-1).content, /left out to fit/);
  assert.equal(LIMITS.messageChars, MESSAGE_LIMIT);
  assert.ok(policy.historyChars + policy.workspaceFloorChars <= policy.requestChars);
});

test('retrying an interrupted request at the message limit leaves room for its recovery note', () => {
  const request = { conversationId, messages: [{role:'user', content:'start ' + 'x'.repeat(policy.messageChars - 10) + ' end'}] };
  const next = retryRequest(request, ['read sources'], 'next');
  assert.doesNotThrow(() => chatInput(next));
  assert.match(next.messages.at(-1).content, /^start /);
  assert.match(next.messages.at(-1).content, /end\n\n\[Vaelo request/);
});

test('a text file larger than the old message limit is usable; an oversized one is rejected before send', async () => {
  const usable = await readAttachment(new File(['a'.repeat(100_000)], 'code.txt', {type:'text/plain'}));
  assert.equal(usable.state, 'ready');
  assert.doesNotThrow(() => chatInput({conversationId, messages:[wireMessage({role:'user', content:'Read this', attachments:[usable]})]}));
  const large = await readAttachment(new File(['a'.repeat(200_000)], 'large.txt', {type:'text/plain'}));
  assert.equal(large.state, 'too-large');
  assert.match(large.note, /Workroom/);
});

test('four resized images and a full text history fit the transport budget', () => {
  const image = {type:'image_url', image_url:{url:'data:image/jpeg;base64,' + 'A'.repeat(650_000)}};
  const messages = [{role:'user', content:'h'.repeat(140_000)}, {role:'user', content:[{type:'text', text:'t'.repeat(160_000)}, image, image, image, image]}];
  const request = {conversationId, messages};
  assert.ok(Buffer.byteLength(JSON.stringify(request)) < LIMITS.body);
  assert.doesNotThrow(() => chatInput(request));
});
