// Actual picker/import/viewer workflow in a disposable browser library.
// Run from repository root: node web-prototype/scripts/examples-ui-check.mjs chrome|msedge
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url)), site = resolve(root, 'site');
const channel = process.argv[2] ?? 'chrome';
assert.ok(['chrome', 'msedge'].includes(channel), 'Choose chrome or msedge');
const output = resolve(root, 'results', `examples-ui-${channel}-${Date.now()}`);
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(resolve(site, 'examples/manifest.json'), 'utf8'));
const server = createServer(async (request, response) => {
  try {
    const path = resolve(site, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!path.startsWith(site + sep)) throw Error('Outside site');
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json' })[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, checks = [], errors = [], screenshots = [], snapshots = [];
let browser, page;
async function libraryReady() { await page.waitForFunction(() => document.querySelector('#try-examples')?.disabled === false); }
async function openPicker() {
  await page.locator('#try-examples').click();
  await page.waitForFunction(() => document.querySelectorAll('#example-dialog .example-row').length === 5);
}
async function closePicker() {
  await page.getByRole('button', { name: 'Close example data', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#example-dialog'));
}
async function viewerReady() {
  await page.waitForURL('**/viewer.html?**');
  await page.waitForFunction(() => window.semidataViewer && document.querySelector('#main')?.getAttribute('aria-busy') === 'false');
  assert.equal(await page.locator('#viewer-error').isVisible(), false, await page.locator('#viewer-error-text').textContent());
  assert.equal(await page.locator('#viewer-groups').isEnabled(), true);
}
async function screenshot(name) {
  await page.screenshot({ path: resolve(output, name), fullPage: true }); screenshots.push(name);
}
async function fits() {
  const bounds = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth, dialogs: [...document.querySelectorAll('dialog[open]')].map((dialog) => ({ left: dialog.getBoundingClientRect().left, right: dialog.getBoundingClientRect().right, content: dialog.scrollWidth, client: dialog.clientWidth })) }));
  assert.ok(bounds.document <= bounds.width + 1 && bounds.body <= bounds.width + 1, JSON.stringify(bounds));
  for (const dialog of bounds.dialogs) assert.ok(dialog.left >= 0 && dialog.right <= bounds.width + 1 && dialog.content <= dialog.client + 1, JSON.stringify(bounds));
}
try {
  browser = await chromium.launch({ channel, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin + '/app.html'); await libraryReady();

  // Closing the dialog during its manifest request must not resurrect it.
  let releaseManifest, manifestStarted, manifestFinished;
  const arrived = new Promise((resolve) => { manifestStarted = resolve; });
  const release = new Promise((resolve) => { releaseManifest = resolve; });
  const finished = new Promise((resolve) => { manifestFinished = resolve; });
  const manifestDelay = async (route) => { manifestStarted(); await release; await route.continue(); manifestFinished(); };
  await page.route('**/examples/manifest.json', manifestDelay);
  await page.locator('#try-examples').click(); await arrived; await closePicker();
  releaseManifest(); await finished; await page.unroute('**/examples/manifest.json', manifestDelay);
  assert.equal(await page.locator('#total-datasets').textContent(), '0');
  checks.push('Close while the example list loads leaves the library untouched');

  const manifestFailure = (route) => route.fulfill({ status: 503, body: 'Unavailable' });
  await page.route('**/examples/manifest.json', manifestFailure);
  await page.locator('#try-examples').click();
  await page.waitForFunction(() => /unavailable/i.test(document.querySelector('#example-dialog .example-status')?.textContent));
  await closePicker(); await page.unroute('**/examples/manifest.json', manifestFailure);
  await openPicker(); assert.equal(await page.locator('#example-dialog .example-row').count(), 5);
  checks.push('Unavailable list has a readable error; closing and reopening retries successfully');
  await screenshot('desktop-examples.png');

  const downloadPending = page.waitForEvent('download');
  await page.locator('#example-dialog a[download="baseline.stdf"]').first().click();
  const download = await downloadPending;
  assert.equal(download.suggestedFilename(), 'baseline.stdf');
  await download.saveAs(resolve(output, 'download-baseline.stdf'));
  assert.deepEqual(await readFile(resolve(output, 'download-baseline.stdf')), await readFile(resolve(site, 'examples/baseline.stdf')));
  checks.push('The direct STDF download exactly matches the original example');

  const badFile = (route) => route.fulfill({ status: 503, body: 'Unavailable' });
  await page.route('**/examples/baseline.stdf', badFile);
  await page.locator('[data-example="baseline"]').click();
  await page.waitForFunction(() => /Could not load baseline/.test(document.querySelector('#example-dialog .example-status')?.textContent));
  await page.waitForFunction(() => !document.querySelector('[data-example="baseline"]').disabled);
  assert.equal(await page.locator('#total-datasets').textContent(), '0');
  await page.unroute('**/examples/baseline.stdf', badFile);
  const badHash = (route) => route.fulfill({ status: 200, body: Buffer.from('not the promised STDF') });
  await page.route('**/examples/baseline.stdf', badHash);
  await page.locator('[data-example="baseline"]').click();
  await page.waitForFunction(() => /incomplete/.test(document.querySelector('#example-dialog .example-status')?.textContent));
  await page.waitForFunction(() => !document.querySelector('[data-example="baseline"]').disabled);
  assert.equal(await page.locator('#total-datasets').textContent(), '0');
  await page.unroute('**/examples/baseline.stdf', badHash);
  checks.push('File download and integrity failures keep the library empty and allow retry');

  await page.setViewportSize({ width: 360, height: 800 }); await fits(); await screenshot('mobile-examples.png');
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [index, example] of manifest.examples.entries()) {
    if (index) { await page.goto(origin + '/app.html'); await libraryReady(); await openPicker(); }
    await page.locator(`[data-example="${example.id}"]`).click(); await viewerReady();
    const state = await page.evaluate(() => window.semidataViewer.getState());
    assert.equal(state.tab, example.suggested.tab);
    assert.equal(state.tests.length, 1); assert.equal(JSON.parse(state.tests[0])[1], example.suggested.testNumber);
    assert.equal(state.selection.groups.length, example.files.length);
    assert.ok(state.selection.groups.every((group) => group.datasetIds.length === 1));
    assert.equal(new Set(state.selection.groups.flatMap((group) => group.datasetIds)).size, example.files.length);
    assert.equal(await page.locator(`#tab-${state.tab}`).getAttribute('aria-selected'), 'true');
    if (example.id === 'site-shift') {
      assert.equal(state.seriesBy, 'site'); assert.equal(await page.locator('#viewer-series').inputValue(), 'site');
      assert.equal((await page.evaluate(() => semidataViewer.query('devices', {}))).total, 96);
      await screenshot('desktop-site-shift.png');
    }
    if (example.id === 'wafer') assert.equal((await page.evaluate(() => semidataViewer.query('wafers', {}))).items.length, 1);
    if (example.id === 'mixed') {
      await page.setViewportSize({ width: 360, height: 800 }); await fits(); await screenshot('mobile-mixed.png');
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    snapshots.push({ id: example.id, state });
  }
  checks.push('All five examples open their intended test and view; site comparison keeps independent groups and separate sites');
  await page.goto(origin + '/app.html'); await libraryReady();
  assert.equal(await page.locator('#total-datasets').textContent(), '5');
  await openPicker(); await page.locator('[data-example="baseline"]').click(); await viewerReady();
  assert.equal(await page.evaluate(() => semidataViewer.getDatasets().length), 5);
  assert.equal(await page.evaluate(() => JSON.parse(semidataViewer.getState().tests[0])[1]), 1002);
  await page.goto(origin + '/app.html'); await libraryReady();
  assert.equal(await page.locator('#total-datasets').textContent(), '5');
  await screenshot('desktop-library.png');
  checks.push('Reopening an example reuses the existing source; the pack leaves exactly five saved files');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ channel, checks, errors, screenshots, snapshots }, null, 2));
  console.log(JSON.stringify({ output, channel, checks, errors, screenshots }, null, 2));
} catch (error) {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: error.stack, checks, errors, screenshots, snapshots }, null, 2));
  if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true });
  throw error;
} finally { await browser?.close(); await new Promise((done) => server.close(done)); }
