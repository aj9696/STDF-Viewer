// Isolated retained import + cold viewer cache + warm exact population queries.
// node scripts/viewer-scale-check.mjs chrome|msedge 10000000
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url)), repo = resolve(root, '..'), site = resolve(root, 'site');
const channel = process.argv[2] ?? 'chrome', count = Number(process.argv[3] ?? 10000000);
assert.ok(['chrome', 'msedge'].includes(channel)); assert.ok([1000000, 10000000].includes(count));
const source = resolve(repo, `.venv/bench-data/benchmark-${count / 100}d-100t.stdf`), sourceBytes = (await stat(source)).size;
const output = resolve(root, 'results', `viewer-scale-${channel}-${count}-${Date.now()}`); await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    const path = resolve(site, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!path.startsWith(site + sep)) throw Error('Outside site');
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' })[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, errors = [], measurements = [];
let browser;
const timed = async (name, fn) => { const start = performance.now(), result = await fn(); const elapsedMs = performance.now() - start; measurements.push({ name, elapsedMs }); console.log(JSON.stringify({ completed: name, elapsedMs })); return result; };
try {
  browser = await chromium.launchPersistentContext(resolve(output, 'profile'), { channel, headless: true });
  const page = await browser.newPage(); page.on('pageerror', (error) => errors.push(error.message));
  let lastPhase = '', lastAt = 0;
  await page.exposeFunction('reportProgress', (progress) => {
    const now = Date.now();
    if (progress.phase !== lastPhase || now - lastAt > 15000) { lastAt = now; lastPhase = progress.phase; console.log(JSON.stringify({ progress })); }
  });
  await page.goto(`${origin}/storage.html`);
  await page.evaluate(async () => { const { DataLibraryClient } = await import('./data-client.js'); window.library = new DataLibraryClient({ onProgress: (p) => window.reportProgress(p) }); await library.open(); });
  await page.locator('#backup-file').setInputFiles(source);
  const imported = await timed('retained-import', () => page.evaluate(() => library.importFile(document.querySelector('#backup-file').files[0])));
  assert.equal(imported.dataset.manifest.counts.measurements, count);
  const selection = { groups: [{ name: 'Large qualification', datasetIds: [imported.dataset.id] }], attempts: 'current' };
  const query = (action, options = {}) => page.evaluate(({ action, selection, options }) => library.viewer(action, selection, options), { action, selection, options });
  const cold = await timed('cold-viewer-cache', () => query('prepare'));
  assert.equal(cold.sources[0].manifest.counts.observations, count); assert.equal(cold.sources[0].reused, false);
  const afterCold = await page.evaluate(() => library.request('open'));
  const warm = await timed('warm-viewer-prepare', () => query('prepare')); assert.equal(warm.sources[0].reused, true);
  const tests = await timed('warm-test-catalogue', () => query('tests')); assert.equal(tests.total, 100);
  const test = tests.items[0];
  const analysis = await timed('warm-exact-analysis', () => query('analyze', { testKey: test.key, bins: 50, seriesBy: 'site', includeAggregate: true }));
  assert.equal(analysis.population.observations, count / 100);
  for (const series of analysis.series) assert.equal(series.bins.reduce((sum, bin) => sum + bin.count, 0), series.stats.count);
  const repeat = await timed('repeat-exact-analysis', () => query('analyze', { testKey: test.key, bins: 50, seriesBy: 'site', includeAggregate: true }));
  assert.deepEqual(repeat, analysis);
  const devices = await timed('warm-device-page-offset-5000', () => query('devices', { offset: 5000, limit: 100, tests: [test.key] }));
  assert.equal(devices.items.length, 100); assert.equal(devices.items[0].dut_index, 5001);
  const afterQueries = await page.evaluate(() => library.request('open'));
  assert.deepEqual(errors, []);
  const report = { channel, browserVersion: browser.browser().version(), source, sourceBytes, observations: count,
    measurements, retained: imported.dataset.manifest, cold: cold.sources[0].manifest, afterCold, afterQueries,
    population: analysis.population, series: analysis.series.map((s) => ({ key: s.key, stats: s.stats, plotted: s.points.length, binned: s.bins.reduce((n, b) => n + b.count, 0) })), errors };
  await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, measurements, afterCold, afterQueries, errors }, null, 2));
} catch (error) { await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: error.stack, measurements, errors }, null, 2)); throw error; }
finally { await browser?.close(); await new Promise((done) => server.close(done)); }
