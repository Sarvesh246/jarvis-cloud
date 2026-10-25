import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { groupChats, previewOf, searchChats } from '../src/lib/format.js';

const chat = (content, extra = {}) => ({ id: 'a', title: 'Trip', messages: [{ role: 'user', content }], ...extra });

test('conversation search reads multipart text without indexing image payloads', () => {
  const record = chat([
    { type: 'text', text: 'Train to Lyon' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,secretpayload' } },
    { type: 'text', text: 'Return via Paris' },
  ]);
  for (const query of ['lyon', 'return via', 'Lyon Return']) {
    const results = searchChats([record], query);
    assert.equal(results.length, 1, query);
    // The existing rail excerpt keeps only twelve characters before a hit.
    assert.match(results[0].excerpt, /Lyon Return via Paris/);
  }
  for (const query of ['object Object', 'secretpayload', 'image_url'])
    assert.deepEqual(searchChats([record], query), []);
});

test('multipart previews show words and image-only messages fall back to earlier words', () => {
  const record = chat([{ type: 'text', text: '**Train** to Lyon' }, { type: 'image_url', image_url: { url: 'secret' } }]);
  assert.equal(previewOf(record), 'Train to Lyon');
  record.messages.push({ role: 'user', content: [{ type: 'image_url', image_url: { url: 'secret' } }] });
  assert.equal(previewOf(record), 'Train to Lyon');
  assert.equal(previewOf(chat([{ type: 'image_url', image_url: { url: 'secret' } }])), '');
});

test('search and preview use authored user text instead of composed attachment text', () => {
  const record = chat('Question\n\nAttached file: private.txt\nsecret attachment words');
  record.messages[0].text = 'My **question** about my_variable and C#';
  assert.match(previewOf(record), /My question/);
  assert.equal(searchChats([record], 'my_variable').length, 1);
  assert.equal(searchChats([record], 'C#').length, 1);
  assert.equal(searchChats([record], 'my question').length, 1);
  assert.deepEqual(searchChats([record], 'secret attachment'), []);
  record.messages[0].text = '';
  assert.equal(previewOf(record), '');
  assert.deepEqual(searchChats([record], 'Question'), []);
});

test('Unicode case expansion never moves the excerpt past the matching words', () => {
  for (const prefix of ['İ'.repeat(100), 'İ😀'.repeat(100)]) {
    const record = chat(`${prefix} target ${'tail '.repeat(100)}`);
    assert.match(searchChats([record], 'TARGET')[0].excerpt, /target/);
    const markdown = chat(`${prefix} **bold target** ${'tail '.repeat(100)}`);
    assert.match(searchChats([markdown], 'bold target')[0].excerpt, /bold target/);
  }
});

test('Unicode case expansion inside the query preserves the full matching excerpt', () => {
  const phrase = 'İ'.repeat(40);
  const tail = ' after '.repeat(30);
  // Forty extra folded code units must not lengthen the established context.
  const expected = `${phrase}${tail.replace(/\s+/g, ' ').slice(0, 48)}`.trim() + '…';
  assert.equal(searchChats([chat(`${phrase}${tail}`)], phrase.toLowerCase())[0].excerpt, expected);
});

test('search retains title precedence, source order, first match and draft exclusion', () => {
  const first = chat('Lyon in message', { id: 'first', title: 'Lyon itinerary' });
  const second = chat('Lyon in older message', { id: 'second' });
  second.messages.push({ role: 'assistant', content: 'Lyon in newer message' });
  const empty = chat('', { id: 'empty', title: 'Lyon draft' });
  const results = searchChats([first, second, empty], '  LYON  ');
  assert.deepEqual(results.map(({ chat: item }) => item.id), ['first', 'second']);
  assert.equal(results[0].excerpt, '');
  assert.match(results[1].excerpt, /older/);
  assert.equal(searchChats([first], '\t \n'), null);
  assert.equal(previewOf(second), 'Lyon in newer message');
});

// TZ belongs to the child process: these checks do not alter the test runner's
// timezone or depend on the host's locale. Calendar dates remain local.
for (const zone of ['America/Chicago', 'Europe/Berlin', 'Australia/Lord_Howe', 'America/Sao_Paulo']) {
  test(`conversation dates use calendar boundaries across DST in ${zone}`, () => {
    const script = `
      import assert from 'node:assert/strict';
      import { groupChats, timeLabel } from ${JSON.stringify(new URL('../src/lib/format.js', import.meta.url).href)};
      const zone = ${JSON.stringify(zone)};
      const dates = zone === 'America/Chicago' ? [[2026,2,9],[2026,10,2]] :
        zone === 'Europe/Berlin' ? [[2026,2,30],[2026,9,26]] :
        zone === 'Australia/Lord_Howe' ? [[2026,3,6],[2026,9,5]] : [[2018,10,4],[2018,10,5],[2019,1,17]];
      for (const [year, month, day] of dates) {
        const now = new Date(year,month,day,12).getTime();
        const today = new Date(year,month,day).getTime();
        const yesterday = new Date(year,month,day-1).getTime();
        const items = [
          ['today',today], ['yesterday-start',yesterday],
          ['yesterday-end',today-1], ['earlier',yesterday-1],
        ].map(([id,updated])=>({id,updated,title:id,messages:[{content:'Words'}]}));
        const groups = Object.fromEntries(groupChats(items,now).map(g=>[g.label,g.items.map(c=>c.id)]));
        assert.deepEqual(groups, {Today:['today'], Yesterday:['yesterday-end','yesterday-start'], Earlier:['earlier']});
        assert.equal(timeLabel(yesterday,now),'Yest.');
        assert.notEqual(timeLabel(yesterday-1,now),'Yest.');
        const sixDays = new Date(year,month,day-6).getTime();
        const date = new Date(sixDays);
        assert.equal(timeLabel(sixDays,now),date.toLocaleDateString(undefined,{weekday:'short'}));
        const older = new Date(sixDays-1);
        assert.equal(timeLabel(sixDays-1,now),older.toLocaleDateString(undefined,{day:'numeric',month:'short'}));
      }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: zone }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}

test('grouping preserves pins, descending timestamps and the input array', () => {
  const now = new Date(2026, 6, 10, 12).getTime();
  const items = [chat('old', { id: 'old', updated: now - 10 * 86400000, pinned: true }),
    chat('recent', { id: 'recent', updated: now }), chat('earlier', { id: 'earlier', updated: now - 1000 }),
    chat('', { id: 'draft', updated: now, pinned: true })];
  const before = structuredClone(items);
  assert.deepEqual(groupChats(items, now).map(g => [g.label, g.items.map(c => c.id)]),
    [['Pinned', ['old']], ['Today', ['recent', 'earlier']]]);
  assert.deepEqual(items, before);
});
