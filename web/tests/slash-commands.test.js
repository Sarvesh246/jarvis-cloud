import test from 'node:test';
import assert from 'node:assert/strict';
import { SLASH_COMMANDS, parseSlash, slashMatches, promptForCommand, contextSnapshot } from '../src/lib/slash-commands.js';
import { compactedHistory, persistentChats } from '../src/lib/slash-history.js';
import { parseReminder, reminderCalendar } from '../src/lib/reminders.js';
import { chatInput } from '../server/chat.js';
import { withMemory } from '../server/memory.js';
import { permitsMemory } from '../server/memory-permission.js';

test('slash completion is scoped to a leading command, supports filtering and preserves arguments', () => {
  assert.equal(new Set(SLASH_COMMANDS.map(item => item.name)).size, SLASH_COMMANDS.length);
  assert.equal(slashMatches('/').length, 43);
  assert.equal(slashMatches('/us')[0].name, 'usage');
  assert.equal(slashMatches('/does-not-exist').length, 0);
  for (const literal of ['https://site.test/path', 'explain /usage', '/usr/local/bin', '/usage all', '/usage\ntext']) assert.equal(slashMatches(literal), null);
  assert.equal(parseSlash(' /usage'), null);
  assert.equal(parseSlash('/usr/bin'), null);
  assert.equal(parseSlash('/UNKNOWN').command, undefined);
  assert.equal(parseSlash('/rewrite keep line breaks\nsecond line').args, 'keep line breaks\nsecond line');
  assert.match(promptForCommand('research', 'weather'), /weather/);
});

test('compaction keeps the transcript and starts using a summary only after its boundary', () => {
  const messages = [{ id: 'a', role: 'user', content: 'old' }, { id: 'b', role: 'assistant', content: 'summary' }, { id: 'c', role: 'user', content: 'new' }];
  const result = compactedHistory(messages, { through: 'b', summary: 'Important facts.' });
  assert.equal(result.length, 2); assert.match(result[0].content, /Important facts/); assert.equal(result[1].id, 'c');
  assert.equal(messages.length, 3);
  assert.equal(compactedHistory(messages.slice(0, 1), { through: 'b', summary: 'not yet' }).length, 1);
  assert.equal(compactedHistory(messages.slice(0, 2), { through: 'b', summary: 'boundary' }).length, 2);
  assert.deepEqual(persistentChats([{ id: 'saved' }, { id: 'private', temporary: true }]), [{ id: 'saved' }]);
});

test('temporary requests cannot read or write account memory', async () => {
  const input = chatInput({ conversationId: '123e4567-e89b-12d3-a456-426614174000', temporary: true, messages: [{ role: 'user', content: 'Remember a fact about me' }] });
  assert.equal(input.temporary, true);
  let reads = 0;
  assert.equal(await withMemory(input, { sub: 'user' }, { enabled: () => true, forPrompt: () => { reads++; } }), input);
  assert.equal(reads, 0); assert.equal(permitsMemory(input), false);
});

test('context percentage estimates current content rather than lifetime token consumption', () => {
  const snap = contextSnapshot({ messages: [{ id: 'a', content: 'x'.repeat(3000), usage: { total_tokens: 1000000 } }] }, [], { windowTokens: 128000 });
  assert.equal(snap.tokens, 3048); assert.equal(snap.estimated, true); assert.ok(snap.percent < 3);
  const measured = contextSnapshot({ messages: [
    { role: 'assistant', content: 'old', usage: { prompt_tokens: 100000, completion_tokens: 10000 } },
    { role: 'assistant', content: 'latest', usage: { prompt_tokens: 12961, completion_tokens: 10, cached_tokens: 5000 } },
    { role: 'user', content: 'x'.repeat(30) },
  ] }, [], { windowTokens: 128000 });
  assert.equal(measured.tokens, 12981); assert.equal(measured.source, 'provider');
  assert.ok(measured.percent > 10 && measured.percent < 11);
});

test('reminder time parsing is bounded and calendar export escapes content and emits real alarms', () => {
  assert.deepEqual(parseReminder('in 20m Review proposal', 0), { at: 1200000, text: 'Review proposal', repeat: 'once' });
  assert.equal(parseReminder('in 9999999d nope'), null); assert.equal(parseReminder('tomorrow'), null);
  const calendar = reminderCalendar({ id: 'test', text: 'Call; review, café\nNext line', at: Date.UTC(2026, 9, 24), repeat: 'weekly' });
  assert.match(calendar, /SUMMARY:Call\\; review\\, café\\nNext line/);
  assert.match(calendar, /BEGIN:VALARM/); assert.match(calendar, /RRULE:FREQ=WEEKLY/);
  for (const line of reminderCalendar({ id: 'test', text: '🔥'.repeat(200), at: Date.now(), repeat: 'once' }).split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
});
