// Exercises the actual app with disposable data and no live provider calls.
// Run against Vite or a production preview with TABLE_TEST_URL.
import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const origin = process.env.TABLE_TEST_URL || 'http://127.0.0.1:5187';
const baseline = process.env.TABLE_BASELINE === '1';
const presentation = process.env.TABLE_PRESENTATION || 'adaptive';
const output = process.env.TABLE_OUTPUT || join(tmpdir(), 'vaelo-mobile-tables');
await mkdir(output, { recursive: true });
const content = `### Key take-aways & trade-offs

| Aspect | What you get | What to watch |
|---|---|---|
| Weight | ~2 kg – portable for a 15-inch gaming machine but heavier than ultrabooks. | Acceptable for desktop-replacement use; less ideal for a daily commute. |
| Price | ~US$1,899 – a solid price for an OLED display and RTX 5070. | Prices fluctuate; check for seasonal sales before ordering. |
| Display | A bright OLED panel with rich colors and a smooth refresh rate. | Glossy reflections can be distracting near a window. |
| Battery | Enough capacity for light work between classes. | Gaming needs the power adapter for full performance. |
| Ports | HDMI, USB-C and USB-A for everyday accessories. | Check the monitor requirements before choosing a dock. |
| Keyboard | Comfortable keys and a dedicated number pad. | The compact arrow keys may take some adjustment. |
| Cooling | Sustained performance under demanding workloads. | Fans become noticeable during long gaming sessions. |
| Upgradeability | Replaceable memory and storage. | Verify supported modules before buying upgrades. |

### Student directory

| Name | Major | Year | GPA | City |
|---|---|---|---:|---|
| Alex | Engineering | Freshman | 3.8 | Austin |
| Maya | Computer Science | Sophomore | 3.6 | Dallas |
| Jordan | Business | Junior | 3.4 | Houston |
| Priya | Biology | Senior | 3.9 | San Antonio |

### Project status

| Item | Status |
|---|---|
| Design | Ready |
| Release | Scheduled |

### Long references

| Reference | Description |
|---|---|
| https://example.test/${'reference'.repeat(20)} | A long URL stays inside the table. |
| Other | Ordinary words stay readable. |

### Laptop dimensions and references

| Specification | Value | Source |
|---|---|---|
| Dimensions | 344.9×255.35×22.5-23.99 mm | Lenovo-Russia spec sheet |
| Dimensions in bold | **344.9×255.35×22.5-23.99 mm** | Manufacturer specification |
| Long word | Pneumonoultramicroscopicsilicovolcanoconiosis | Published terminology |
| Serial number | ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ | Product label |
| Nonbreaking spaces | 344.9\u00a0×\u00a0255.35\u00a0×\u00a022.5–23.99\u00a0mm | Manufacturer specification |
| Code | \`ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ\` | Product label |
| A very long label Pneumonoultramicroscopicsilicovolcanoconiosis | Ordinary prose remains readable. | Manufacturer specification |

### Long headers

| ExtraordinarilyLongSpecificationIdentifier | Value |
|---|---|
| Dimensions | 344.9x255.35x22.5-23.99 mm |
| Reference | Manufacturer specification |
`;
const results = [];
for (const engine of ['chromium', 'webkit']) {
  const browser = await ({ chromium, webkit }[engine]).launch({ headless: true });
  try {
    for (const profile of [
      { width: 320, height: 740, phone: true },
      { width: 390, height: 844, phone: true },
      { width: 430, height: 932, phone: true },
      { width: 844, height: 390, phone: true },
      { width: 1440, height: 1000, phone: false },
    ]) {
      for (const theme of ['dark', 'light']) {
        if (process.env.TABLE_CASE && process.env.TABLE_CASE !== `${engine}-${profile.width}-${theme}`) continue;
        const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, isMobile: profile.phone, hasTouch: profile.phone, serviceWorkers: 'block' });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(({ content, theme, presentation }) => {
          const seed = { id: '123e4567-e89b-12d3-a456-426614174000', title: 'Laptop specifications', updated: Date.now(), messages: [
            { id: 'question', role: 'user', content: 'Show the laptop trade-offs and directories as tables. Keep the columns and full descriptions.' },
            { id: 'answer', role: 'assistant', content, completedAt: Date.now() },
          ] };
          localStorage.setItem('vaelo-sync:table-review', JSON.stringify({ chats: [seed], base: {}, deleted: [] }));
          sessionStorage.setItem('vaelo-guest-chats', JSON.stringify([seed]));
          localStorage.setItem('vaelo-onboarding', 'done');
          localStorage.setItem('vaelo-preferences', JSON.stringify({ theme, presentation }));
          sessionStorage.setItem('vaelo-open-chat:table-review', seed.id);
        }, { content, theme, presentation });
        await page.route('**/api/**', route => {
          const url = new URL(route.request().url());
          const json = value => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
          if (url.pathname === '/api/session') return json({ user: { sub: 'table-review', name: 'Table Review', guest: true }, csrf: 'a'.repeat(64), configured: true });
          if (url.pathname === '/api/status') return json({ ready: true });
          if (url.pathname === '/api/feed') return route.fulfill({ contentType: 'text/event-stream', body: 'event: feed\ndata: {"seq":0}\n\n' });
          if (url.pathname === '/api/chats') return json({ entries: {} });
          if (url.searchParams.get('resource') === 'retention') return json({ days: 0, now: Date.now() });
          return json({ ok: true, items: [], records: [], shortcuts: [], reminders: [] });
        });
        await page.goto(origin);
        const tables = page.locator('.message .table-block');
        await tables.nth(5).waitFor().catch(async error => {
          console.error({ errors, body: (await page.locator('body').innerText()).slice(0, 5000) });
          throw error;
        });
        await page.evaluate(() => document.fonts.ready);
        const first = tables.first();
        await first.evaluate(element => element.scrollIntoView({ block: 'start' })).catch(async error => {
          console.error({ errors, body: (await page.locator('body').innerText()).slice(0, 5000) });
          throw error;
        });
        const geometry = await first.evaluate(element => {
          const scroll = element.querySelector('.table-scroll');
          const header = element.querySelector('.block-bar');
          return {
            card: Math.round(element.getBoundingClientRect().width),
            header: Math.round(header.getBoundingClientRect().height),
            viewport: scroll.clientWidth, table: scroll.scrollWidth,
            height: scroll.clientHeight, contentHeight: scroll.scrollHeight,
            pageWidth: document.documentElement.scrollWidth,
            cells: [...element.querySelectorAll('tbody tr:first-child td')].map(cell => Math.round(cell.getBoundingClientRect().width)),
            weights: [...element.querySelectorAll('tbody tr:first-child td')].map(cell => getComputedStyle(cell).fontWeight),
          };
        });
        const id = `${engine}-${profile.width}-${theme}`;
        await page.screenshot({ path: join(output, `${id}.png`) });
        if (!baseline) {
          assert.ok(geometry.pageWidth <= profile.width, `${id}: no page overflow`);
          if (profile.phone) {
            assert.ok(geometry.header < 120, `${id}: compact caption`);
            if (profile.width < 768) assert.ok(geometry.table > geometry.viewport, `${id}: long prose scrolls horizontally`);
            if (profile.width < 768) {
              assert.ok(geometry.cells.slice(1).every(width => width >= 144 && width <= 200), `${id}: prose columns have balanced reading widths`);
              const splitWords = await tables.evaluateAll(elements => {
                const split = [];
                for (const table of elements.slice(0, 4)) {
                  const walker = document.createTreeWalker(table.querySelector('table'), NodeFilter.SHOW_TEXT);
                  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                    if (node.parentElement.closest('a,code,.sr-only')) continue;
                    for (const match of node.textContent.matchAll(/[\p{L}\p{N}]+/gu)) {
                      const range = document.createRange();
                      range.setStart(node, match.index);
                      range.setEnd(node, match.index + match[0].length);
                      if (range.getClientRects().length > 1) split.push(match[0]);
                    }
                  }
                }
                return split;
              });
              assert.deepEqual(splitWords, [], `${id}: whole words stay on a single line`);
              const referenceWidth = await tables.nth(3).locator('table').evaluate(element => element.offsetWidth);
              assert.ok(referenceWidth < profile.width * 2, `${id}: long URLs do not widen the table excessively`);
            }
            assert.ok(geometry.contentHeight <= geometry.height + 1, `${id}: no nested vertical scrolling`);
            assert.equal(await first.getByRole('checkbox').count(), 0);
            assert.equal(await first.getByRole('searchbox').count(), 0);
            await first.locator('tbody tr').first().click();
            assert.equal(await first.locator('tr[data-selected]').count(), 0, 'Reading does not select rows');
            if (presentation !== 'minimal') {
              const tools = first.getByRole('button', { name: 'Table tools', exact: true });
              await tools.click();
              assert.equal(await tools.getAttribute('aria-expanded'), 'true');
              const filter = first.getByRole('searchbox', { name: 'Filter rows' });
              await filter.fill('Weight');
              assert.equal(await first.locator('tbody tr').count(), 1);
              await filter.fill('');
              await first.getByRole('checkbox').nth(0).check();
              await first.getByRole('checkbox').nth(1).check();
              await first.getByRole('button', { name: 'Compare (2)', exact: true }).click();
              assert.equal(await first.locator('tbody tr').count(), 2);
              await first.getByRole('button', { name: 'Show all rows', exact: true }).click();
              await first.getByRole('button', { name: 'Clear', exact: true }).click();
              await filter.fill('Weight');
              await tools.click();
              assert.equal(await tools.getAttribute('aria-expanded'), 'false');
              assert.equal(await first.locator('tbody tr').count(), 1, 'Closing tools preserves the filter');
              await first.getByRole('button', { name: 'Reset view', exact: true }).click();
              assert.equal(await first.locator('tbody tr').count(), 8, 'Hidden filters can be reset');
              }
            await first.getByRole('button', { name: 'Sort by Aspect', exact: true }).click();
            assert.equal(await first.locator('th[aria-sort]').getAttribute('aria-sort'), 'ascending');
            assert.match(await first.locator('tbody tr').first().innerText(), /Battery/);
          } else if (presentation !== 'minimal') {
            assert.equal(await first.getByRole('button', { name: 'Table tools', exact: true }).count(), 0);
            assert.equal(await first.getByRole('searchbox').count(), 1);
            assert.equal(await first.getByRole('checkbox').count(), 8);
            assert.equal(await first.getByRole('separator', { name: 'Resize table height' }).count(), 1);
          }
          if (profile.width === 390) {
            await first.locator('.table-scroll').evaluate(element => { element.scrollLeft = element.scrollWidth; });
            await first.evaluate(element => element.scrollIntoView({ block: 'start' }));
            await page.screenshot({ path: join(output, `${id}-tradeoffs-scrolled.png`) });
          }
          const edgeCases = tables.nth(4);
          await edgeCases.evaluate(element => element.scrollIntoView({ block: 'start' }));
          const overflow = await tables.locator('td, th').evaluateAll(cells => {
            const failures = [];
            for (const cell of cells) {
              const bounds = cell.getBoundingClientRect();
              const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
              for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                if (node.parentElement.closest('.sr-only')) continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                for (const rect of range.getClientRects()) {
                  if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) failures.push(node.textContent);
                }
              }
            }
            return failures;
          });
          assert.deepEqual(overflow, [], `${id}: long values stay inside their own cells`);
          assert.equal(await edgeCases.locator('tbody tr').first().locator('td').nth(presentation !== 'minimal' && !profile.phone ? 2 : 1).textContent(), '344.9×255.35×22.5-23.99 mm', 'Dimension text is preserved');
          if (profile.phone) assert.equal(await edgeCases.locator('tbody tr').first().locator('wbr').count(), 2, 'Dimensions have natural wrap points');
          await edgeCases.evaluate(element => {
            const scroll = element.querySelector('.table-scroll');
            scroll.scrollLeft = 0;
            scroll.scrollTop = 0;
          });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await page.screenshot({ path: join(output, `${id}-long-values.png`) });
          await edgeCases.locator('.table-scroll').evaluate(element => { element.scrollLeft = element.scrollWidth; });
          await page.screenshot({ path: join(output, `${id}-long-values-scrolled.png`) });
          // Every column remains reachable, including the last cell in a wide table.
          const directory = tables.nth(1);
          await directory.evaluate(element => element.scrollIntoView({ block: 'start' }));
          if (profile.phone) {
            const contained = await directory.locator('.block-bar').evaluate(element => {
              const bounds = element.getBoundingClientRect();
              const count = element.querySelector('.block-count').getBoundingClientRect();
              return [...element.querySelectorAll('button')].every(button => {
                const rect = button.getBoundingClientRect();
                return rect.left >= count.right && rect.right <= bounds.right && rect.bottom <= bounds.bottom;
              });
            });
            assert.ok(contained, `${id}: caption tools fit without overlapping the row count`);
          }
          const reached = await directory.locator('.table-scroll').evaluate(element => {
            element.scrollLeft = element.scrollWidth;
            const last = element.querySelector('tbody tr:last-child td:last-child').getBoundingClientRect();
            const viewport = element.getBoundingClientRect();
            return last.right <= viewport.right + 1 && last.left >= viewport.left;
          });
          assert.ok(reached, `${id}: final column can be read`);
          await page.screenshot({ path: join(output, `${id}-scrolled.png`) });
          const short = await tables.nth(2).locator('.table-scroll').evaluate(element => ({ viewport: element.clientWidth, content: element.scrollWidth }));
          assert.ok(short.content <= short.viewport + 1, `${id}: short tables fit`);
          if (profile.width === 390 && theme === 'dark') {
            const downloadReady = page.waitForEvent('download');
            await first.getByRole('button', { name: 'Download as CSV', exact: true }).click();
            const download = await downloadReady;
            const csv = await readFile(await download.path(), 'utf8');
            assert.equal(csv.trim().split(/\r?\n/).length, 9, 'Export retains all original rows');
            assert.match(csv, /What to watch/);
          }
          assert.deepEqual(errors, [], `${id}: no runtime errors`);
        }
        results.push({ id, ...geometry });
        await context.close();
      }
    }
  } finally { await browser.close(); }
}
await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ output, checks: results.length, results }, null, 2));
