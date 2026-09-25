import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url)), repo = resolve(root, '..'), site = resolve(root, 'site');
const channel = process.argv[2] ?? 'chrome';
if (!['chrome', 'msedge'].includes(channel)) throw new Error('Use chrome or msedge');
const output = resolve(root, 'results', `viewer-${channel}-${Date.now()}`); await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    const path = resolve(site, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!path.startsWith(site + sep)) throw new Error('Outside site');
    const bytes = await readFile(path);
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' })[extname(path)] ?? 'application/octet-stream'); response.end(bytes);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, errors = [], checks = [], traces = [];
let browser, page;
const query = (action, selection, options = {}) => page.evaluate(({ action, selection, options }) => library.viewer(action, selection, options), { action, selection, options });
try {
  browser = await chromium.launch({ channel, headless: true });
  page = await browser.newPage(); page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/storage.html`);
  await page.evaluate(async () => { const { DataLibraryClient } = await import('./data-client.js'); window.library = new DataLibraryClient(); await library.open(); });
  const imported = [];
  for (const endian of ['little', 'big']) {
    const path = resolve(repo, '.venv/viewer-fixtures', `golden-${endian}.stdf`);
    const expected = JSON.parse(await readFile(path.replace('.stdf', '.expected.json'), 'utf8'));
    await page.locator('#backup-file').setInputFiles(path);
    const result = await page.evaluate(async () => library.importFile(document.querySelector('#backup-file').files[0]));
    const id = result.dataset.id, selection = { groups: [{ name: endian, datasetIds: [id] }], attempts: 'all' };
    imported.push({ id, selection });
    const prepared = await query('prepare', selection);
    assert.equal(prepared.sources[0].manifest.counts.observations, expected.observations);
    assert.equal(prepared.sources[0].manifest.counts.tests, 3); assert.equal(prepared.sources[0].manifest.counts.devices, 2);
    assert.equal(prepared.sources[0].reused, false); assert.equal((await query('prepare', selection)).sources[0].reused, true);
    const tests = await query('tests', selection); assert.equal(tests.total, 5); // PTR + 3 PMR channels + FTR
    assert.deepEqual([...new Set(tests.items.map((t) => t.family))], [10, 15, 20]);
    const ptr = tests.items.find((t) => t.family === 10), ftr = tests.items.find((t) => t.family === 20);
    const devices = await query('devices', selection, { tests: [ptr.key] });
    assert.deepEqual(devices.items.map((d) => d.id), expected.deviceIds);
    assert.deepEqual(devices.items.map((d) => d.retired), [1, 0]); assert.equal(devices.items[0].testResults[ptr.key].length, 3);
    const detail = await query('device', selection, { datasetId: id, deviceId: 16, limit: 3 });
    assert.equal(detail.items.length, 3); assert.deepEqual(detail.nextAfter, [19, 0]);
    const next = await query('device', selection, { datasetId: id, deviceId: 16, after: detail.nextAfter, limit: 3 });
    assert.deepEqual(next.items.map((m) => m.seq), [20, 20, 20]); assert.deepEqual(next.items.map((m) => m.pmr_index), [20, 21, 22]);
    const analysis = await query('analyze', selection, { testKey: ptr.key, bins: 3 });
    traces.push({ endian, ptrAnalysis: analysis });
    assert.equal(analysis.population.observations, 4); assert.equal(analysis.series[0].stats.count, 4);
    assert.equal(analysis.series[0].bins.reduce((n, b) => n + b.count, 0), 4);
    assert.equal((await query('analyze', selection, { testKey: ftr.key })).series[0].points[0].value, 128);
    const current = { ...selection, attempts: 'current' };
    assert.equal((await query('devices', current)).total, 1);
    assert.equal((await query('analyze', current, { testKey: ptr.key })).population.observations, 1);
    const bins = await query('bins', current, { kind: 'soft' }); assert.equal(bins.series[0].total, 1);
    const wafers = await query('wafers', current); assert.equal(wafers.items[0].id, 14);
    const map = await query('wafer', current, { waferKey: wafers.items[0].key }); assert.equal(map.dies.length, 1);
    const records = await query('records', selection); assert.equal(records.total, 2);
    const record = await query('record', selection, { datasetId: id, seq: 20 }); assert.equal(record.decoded.name, 'MPR');
    const verified = await page.evaluate((id) => library.verifyDataset(id), id); assert.equal(verified.verified, true);
    checks.push(`${endian}: retained import, disposable cache reuse, PTR/MPR/FTR, repeated executions, retest, bins, wafer, datalog and original verification`);
  }
  const grouped = { groups: [{ name: 'Ordered merge', datasetIds: imported.map((r) => r.id) }], attempts: 'current' };
  const compared = { groups: imported.map((r, i) => ({ name: `File ${i + 1}`, datasetIds: [r.id] })), attempts: 'current' };
  assert.equal((await query('devices', grouped)).total, 1);
  assert.equal((await query('devices', compared)).total, 2);
  const ptr = (await query('tests', compared)).items.find((t) => t.family === 10);
  const compare = await query('analyze', compared, { testKey: ptr.key }); assert.equal(compare.series.length, 2);
  assert.deepEqual(compare.series[0].bins.map((b) => [b.low, b.high]), compare.series[1].bins.map((b) => [b.low, b.high]));
  checks.push('ordered group cross-file supersede versus independent comparison and shared histogram edges');
  await page.evaluate(async () => { await library.close(); await library.open(); });
  assert.equal((await query('prepare', compared)).sources.every((s) => s.reused), true);
  checks.push('close/reopen retains completed derived caches');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ channel, checks, errors, traces }, null, 2));
  console.log(JSON.stringify({ output, checks, errors }, null, 2));
} catch (error) {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: error.stack, checks, errors, traces }, null, 2));
  throw error;
} finally { await browser?.close(); await new Promise((done) => server.close(done)); }
