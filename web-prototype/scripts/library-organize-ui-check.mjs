import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// This isolated profile uses synthetic catalog metadata; provider checks cover MIR extraction.
const base = fileURLToPath(new URL('../', import.meta.url)), site = resolve(base, 'site');
const channel = process.argv[2] ?? 'chrome';
if (!['chrome', 'msedge'].includes(channel)) throw new Error('Use chrome or msedge');
const output = resolve(base, 'results', `library-organize-${channel}-${Date.now()}`);
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    const path = resolve(site, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!path.startsWith(site + sep)) throw new Error('Outside site');
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' })[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const fixture = `
const rows = Array.from({ length: 35 }, (_, i) => ({ id: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'),
  name: 'probe-' + String(i).padStart(3, '0') + '.stdf', relative_path: 'probe-' + String(i).padStart(3, '0') + '.stdf',
  source_bytes: 1000 + i, db_bytes: 32768, source_hash: 'a'.repeat(64), created_at: '2026-10-18T10:00:00Z', status: i === 33 ? 'unavailable' : 'ready',
  test_metadata: { startTime: i === 34 ? null : Date.UTC(2026, 9, i < 30 ? 19 : 18) / 1000,
    partNumber: i === 34 ? '<img src=x onerror=alert(1)>' : 'PX-' + i % 5, lotId: 'LOT-' + i % 7, sublotId: '', program: 'probe-program', revision: 'R2', tester: 'ATE-2', status: i === 34 ? 'not-recorded' : 'recorded' },
  manifest: { counts: { measurements: 100 + i, devices: 10, records: 500, definitions: 10 } } }));
export class DataLibraryClient {
  constructor() { this.worker = null; }
  async open() { this.worker = {}; return { datasets: rows.length, interrupted: 0 }; }
  async listDatasets({ offset = 0, limit = 100 } = {}) { return { items: rows.slice(offset, offset + limit), nextOffset: offset + limit < rows.length ? offset + limit : null }; }
  async getDataset(id) { const { test_metadata, ...row } = rows.find(row => row.id === id); return row; }
  terminate() { this.worker = null; }
}
`;
const errors = [], checks = [];
let context;
try {
  context = await chromium.launchPersistentContext(resolve(output, 'profile'), { channel, headless: true, viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(15000);
  await context.route('**/data-client.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { errors.push(dialog.message()); await dialog.dismiss(); });
  await page.goto(`${origin}/app.html`);
  await page.waitForFunction(() => !document.querySelector('#add-file').disabled);
  assert.equal(await page.locator('#group-files').inputValue(), 'date');
  assert.equal(await page.locator('#sort-files').inputValue(), 'test-newest');
  assert.match(await page.locator('.library-group-heading').first().innerText(), /2026-10-19.*30 files/s);
  assert.equal(await page.locator('[data-select-group]').first().isDisabled(), true);
  assert.equal(await page.locator('#dataset-rows tr[data-id]').count(), 25);
  checks.push('Newest test date default, UTC grouping, 25-row paging, group limit');

  const first = page.locator('[data-select-id]').first();
  await first.focus(); await page.keyboard.press('Space');
  assert.equal(await first.isChecked(), true);
  assert.equal(await first.evaluate(node => document.activeElement === node), true);
  await page.locator('#next-page').click();
  await page.locator('[data-select-id]').first().check();
  assert.match(await page.locator('#selection-count').innerText(), /^2 of 8/);
  assert.equal(await page.locator('#selected-files button').count(), 2);
  assert.equal(await page.locator('#dataset-rows .library-test-date').last().innerText(), '—');
  assert.equal(await page.locator('tr[data-id$="000000000033"] input').isDisabled(), true);
  assert.equal(await page.locator('#dataset-rows img').count(), 0);
  await page.locator('#search-files').fill('does-not-exist');
  assert.equal(await page.locator('#no-results').isVisible(), true);
  assert.equal(await page.locator('#library-selection').isVisible(), true);
  assert.equal(await page.locator('#selected-files button').count(), 2);
  await page.locator('#selection-details summary').click();
  await page.locator('#selected-files button').first().click();
  assert.match(await page.locator('#selection-count').innerText(), /^1 of 8/);
  checks.push('Keyboard checkbox, retained hidden selection across pages/search, removal, unknown date, unavailable row, escaped metadata');

  await page.locator('#clear-selection').click();
  await page.locator('#search-files').fill('PX-4 probe-program R2 ATE-2');
  await page.locator('#group-files').selectOption('part');
  assert.equal(await page.locator('#dataset-rows tr[data-id]').count(), 6);
  await page.locator('[data-select-group]').click();
  assert.match(await page.locator('#selection-count').innerText(), /^6 of 8/);
  await page.locator('#search-files').fill('PX-0');
  await page.locator('[data-select-id]').nth(0).check();
  await page.locator('[data-select-id]').nth(1).check();
  assert.match(await page.locator('#selection-count').innerText(), /^8 of 8/);
  assert.equal(await page.locator('[data-select-id]').nth(2).isDisabled(), true);
  assert.equal(await page.locator('[data-select-id]').nth(0).isDisabled(), false);
  await page.locator('#selected-files button').last().click();
  assert.equal(await page.locator('[data-select-id]').nth(2).isDisabled(), false);
  checks.push('Full-metadata multiword search, group select, atomic eight-file cap, selected rows stay removable');

  await page.locator('#clear-selection').click();
  await page.locator('#search-files').fill('');
  await page.locator('#group-files').selectOption('lot');
  await page.locator('[data-select-group]').first().click();
  assert.match(await page.locator('#selection-count').innerText(), /^5 of 8/);
  await page.locator('#group-files').selectOption('none');
  await page.locator('#sort-files').selectOption('test-oldest');
  assert.equal(await page.locator('#dataset-rows .library-test-date').first().innerText(), '2026-10-18');
  assert.match(await page.locator('#selection-count').innerText(), /^5 of 8/);
  await page.locator('#group-files').selectOption('part');
  await page.locator('#search-files').fill('PX-0');
  await page.locator('.row-open').first().click();
  await page.waitForFunction(() => document.querySelector('#dataset-info').textContent.includes('Test information'));
  assert.match(await page.locator('#dataset-info').innerText(), /Test start.*UTC.*Part number.*PX-0.*Program.*probe-program/s);
  await page.keyboard.press('Escape');
  checks.push('Lot grouping, oldest date sort, selection survives regroup, metadata details');

  for (const width of [1440, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width === 390) await page.locator('#selection-details summary').click();
    await page.evaluate(() => scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow at ${width}`);
    await page.screenshot({ path: resolve(output, `library-${width}.png`), animations: 'disabled', fullPage: false });
  }
  checks.push('No page overflow at 1440, 768, 390 and 360 pixels');
  const expectedIds = await page.locator('#selected-files button').evaluateAll(nodes => nodes.map(node => node.dataset.removeSelection));
  await context.route('**/viewer.html?*', route => route.fulfill({ contentType: 'text/html', body: '<title>Viewer route check</title>' }));
  await page.locator('#open-selected').click();
  await page.waitForURL('**/viewer.html?*');
  assert.deepEqual(new URL(page.url()).searchParams.get('datasets').split(','), expectedIds);
  checks.push('Open in Viewer preserves every selected ID and its selection order');
  await context.close();
  context = await chromium.launchPersistentContext(resolve(output, 'real-profile'), { channel, headless: true, viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(30000);
  const real = await context.newPage();
  real.on('pageerror', error => errors.push(error.message));
  await real.goto(`${origin}/storage.html`);
  const importedIds = await real.evaluate(async () => {
    const { DataLibraryClient } = await import('./data-client.js');
    const library = new DataLibraryClient(); await library.open();
    try {
      const ids = [];
      for (const name of ['baseline.stdf', 'site-shift.stdf']) {
        const bytes = await (await fetch(`./examples/${name}`)).arrayBuffer();
        ids.push((await library.importFile(new File([bytes], name))).dataset.id);
      }
      return ids;
    } finally { await library.close(); library.terminate(); }
  });
  await real.goto(`${origin}/app.html`);
  await real.waitForFunction(() => !document.querySelector('#add-file').disabled);
  assert.equal(await real.locator('#dataset-rows tr[data-id]').count(), 2);
  assert.notEqual(await real.locator('.library-test-date').first().innerText(), '—');
  await real.locator('.row-open').first().click();
  await real.waitForFunction(() => document.querySelector('#dataset-info').textContent.includes('Test information'));
  assert.match(await real.locator('#dataset-info').innerText(), /Test start\n.*UTC/);
  await real.keyboard.press('Escape');
  for (const id of importedIds) await real.locator(`[data-select-id="${id}"]`).check();
  await real.locator('#open-selected').click();
  await real.waitForURL('**/viewer.html?*');
  await real.waitForFunction(() => window.semidataViewer && document.querySelector('#main')?.getAttribute('aria-busy') === 'false');
  assert.equal(await real.locator('#viewer-error').isVisible(), false, await real.locator('#viewer-error-text').textContent());
  const state = await real.evaluate(() => semidataViewer.getState());
  assert.deepEqual(state.selection.groups.map(group => group.datasetIds), importedIds.map(id => [id]));
  checks.push('Actual WASM/SQLite imports show MIR metadata in Library and Details; two selected files open as independent Viewer groups');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ passed: true, channel, checks }, null, 2));
  console.log(JSON.stringify({ passed: true, channel, checks, output }, null, 2));
} finally { await context?.close(); await new Promise(done => server.close(done)); }
