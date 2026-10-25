import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderCalendar } from '../src/lib/reminders.js';
import { commandDataApi, checkCommandData } from '../server/command-data.js';
import { AccountRecord } from '../server/account-record.js';
import { memoryStorage, reply } from './helpers-storage.js';
import { cookieNames } from '../server/security.js';

const at = Date.UTC(2026, 10, 1, 6, 30, 45, 123);
const item = { id: '123e4567-e89b-12d3-a456-426614174000', text: 'Review proposal', at, repeat: 'once', done: false };
const logicalLines = calendar => calendar.replace(/\r\n[ \t]/g, '').split('\r\n');
const values = (calendar, name) => logicalLines(calendar).filter(line => line.startsWith(`${name}:`)).map(line => line.slice(name.length + 1));
// Decode one RFC 5545 TEXT layer, preserving literal backslash-n sequences.
const textValue = value => value.replace(/\\([nN\\,;])/g, (_, ch) => /[nN]/.test(ch) ? '\n' : ch);

function assertStructure(calendar) {
  assert.ok(calendar.endsWith('\r\n'));
  assert.doesNotMatch(calendar.replaceAll('\r\n', ''), /[\r\n]/, 'Only CRLF may delimit physical lines');
  const lines = logicalLines(calendar);
  assert.deepEqual(lines.filter(line => /^(BEGIN|END):/.test(line)), [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'BEGIN:VALARM', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR',
  ]);
  for (const line of calendar.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, 'UTF-8 octet limit');
}

test('calendar text normalizes CR, CRLF and LF without exposing content lines', () => {
  for (const newline of ['\r', '\r\n', '\n']) {
    const text = `Review${newline}BEGIN:VEVENT${newline}SUMMARY:Still reminder text`;
    const calendar = reminderCalendar({ ...item, text });
    assertStructure(calendar);
    for (const name of ['SUMMARY', 'DESCRIPTION']) {
      assert.equal(values(calendar, name).length, 1);
      assert.equal(textValue(values(calendar, name)[0]), 'Review\nBEGIN:VEVENT\nSUMMARY:Still reminder text');
    }
  }
});

test('calendar text retains adjacent mixed newlines and literal escape sequences', () => {
  const text = 'café\\n;one,two:three\\N\r\r\n\n漢字 🔥\rEnd';
  const calendar = reminderCalendar({ ...item, text });
  assertStructure(calendar);
  for (const name of ['SUMMARY', 'DESCRIPTION'])
    assert.equal(textValue(values(calendar, name)[0]), 'café\\n;one,two:three\\N\n\n\n漢字 🔥\nEnd');
});

test('accepted stored reminder IDs cannot inject calendar properties or components', () => {
  const id = 'legacy\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Unexpected';
  const reminder = { ...item, id };
  assert.doesNotThrow(() => checkCommandData({ shortcuts: [], reminders: [reminder] }));
  const calendar = reminderCalendar(reminder);
  assertStructure(calendar);
  assert.equal(values(calendar, 'UID').length, 1);
  assert.equal(textValue(values(calendar, 'UID')[0]), `${id.replaceAll('\r\n', '\n')}@vaelo`);
  assert.deepEqual(values(calendar, 'SUMMARY'), [item.text]);
});

test('calendar UID uses TEXT escaping while retaining identifier characters', () => {
  const id = 'legacy\\n;part,other:café🔥';
  const calendar = reminderCalendar({ ...item, id });
  assertStructure(calendar);
  assert.deepEqual(values(calendar, 'UID'), ['legacy\\\\n\\;part\\,other:café🔥@vaelo']);
  assert.equal(textValue(values(calendar, 'UID')[0]), `${id}@vaelo`);
});

test('calendar folding preserves exact Unicode, whitespace and escapes at byte boundaries', () => {
  for (const char of ['a', 'é', '漢', '🔥', '\\', ',', ';', '\t', ' ']) {
    for (const width of [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 74, 75, 76]) {
      const text = `${'a'.repeat(width)}${char.repeat(30)}\r漢🔥\\n,; tail`;
      const calendar = reminderCalendar({ ...item, text });
      assertStructure(calendar);
      for (const name of ['SUMMARY', 'DESCRIPTION'])
        assert.equal(textValue(values(calendar, name)[0]), text.replaceAll('\r', '\n'));
    }
  }
});

test('calendar recurrence, UTC instants, identity and display alarms retain their contracts', () => {
  for (const repeat of ['once', 'daily', 'weekly']) {
    const reminder = { ...item, repeat };
    const before = structuredClone(reminder);
    const calendar = reminderCalendar(reminder);
    assertStructure(calendar);
    assert.deepEqual(reminder, before, 'Export must not update delivery state');
    assert.deepEqual(values(calendar, 'UID'), [`${item.id}@vaelo`]);
    assert.deepEqual(values(calendar, 'DTSTART'), ['20261101T063045Z']);
    assert.deepEqual(values(calendar, 'DTEND'), ['20261101T063145Z']);
    assert.match(values(calendar, 'DTSTAMP')[0], /^\d{8}T\d{6}Z$/);
    assert.deepEqual(values(calendar, 'RRULE'), repeat === 'once' ? [] : [`FREQ=${repeat.toUpperCase()}`]);
    assert.deepEqual(values(calendar, 'TRIGGER'), ['PT0S']);
    assert.deepEqual(values(calendar, 'ACTION'), ['DISPLAY']);
    assert.deepEqual(values(calendar, 'SUMMARY'), [item.text]);
    assert.deepEqual(values(calendar, 'DESCRIPTION'), [item.text]);
  }
});

test('API-saved reminder content remains data when exported and storage is unchanged', async () => {
  const cfg = { origin: 'https://vaelo.test' }, csrf = 'a'.repeat(64);
  const record = new AccountRecord('calendar-export', { empty: () => ({ shortcuts: [], reminders: [] }), check: checkCommandData }, memoryStorage());
  const text = 'Call café\rBEGIN:VEVENT\rSUMMARY:Do not create another event\r\n\\n,;漢🔥';
  const req = { method: 'POST', body: { action: 'reminder-add', text, at, repeat: 'weekly' }, headers: {
    origin: cfg.origin, cookie: `${cookieNames(cfg).csrf}=${csrf}`, 'x-csrf-token': csrf, 'content-type': 'application/json',
  } };
  const res = reply();
  await commandDataApi(req, res, cfg, { sub: 'alice' }, record, () => at - 60000);
  const saved = res.body.reminders[0];
  assert.equal(saved.text, text);
  const calendar = reminderCalendar(saved);
  assertStructure(calendar);
  assert.equal(textValue(values(calendar, 'SUMMARY')[0]), text.replace(/\r\n|\r/g, '\n'));
  assert.equal((await record.read('alice')).data.reminders[0].text, text);
  assert.deepEqual((await record.read('bob')).data.reminders, []);
});
