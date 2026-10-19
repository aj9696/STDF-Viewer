// Real worker/SQLite statistics batches, independent moment oracles and bounds.
// Run: node scripts/viewer-summaries-check.mjs chrome|msedge
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url)), repo = resolve(root, '..'), site = resolve(root, 'site');
const channel = process.argv[2] ?? 'chrome';
if (!['chrome', 'msedge'].includes(channel)) throw new Error('Use chrome or msedge');
const output = resolve(root, 'results', `viewer-summaries-${channel}-${Date.now()}`), fixtures = resolve(output, 'fixtures');
await mkdir(output, { recursive: true });
for (const script of ['make-viewer-populations.py', 'make-viewer-summary-fixtures.py']) {
  const result = spawnSync(resolve(repo, '.venv/Scripts/python.exe'), [resolve(root, 'scripts', script), fixtures], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
const expected = JSON.parse(await readFile(resolve(fixtures, 'expected.json'), 'utf8'));
const server = createServer(async (request, response) => {
  try {
    const path = resolve(site, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!path.startsWith(site + sep)) throw new Error('Outside site');
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' })[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, checks = [], errors = [];
let browser, page;
const selection = (ids, attempts = 'all') => ({ groups: [{ name: 'Summary', datasetIds: ids }], attempts });
const query = (action, selected, options = {}) => page.evaluate(({ action, selected, options }) => library.viewer(action, selected, options), { action, selected, options });
async function importFile(path) {
  await page.locator('#backup-file').setInputFiles(path);
  return (await page.evaluate(() => library.importFile(document.querySelector('#backup-file').files[0]))).dataset.id;
}
async function rejection(selected, options, action = 'testSummaries') {
  return page.evaluate(async ({ selected, options, action }) => { try { await library.viewer(action, selected, options); return null; } catch (error) { return error.code; } }, { selected, options, action });
}
async function compare(selected, options = {}, tests = null) {
  tests ??= (await query('tests', selected)).items.map((test) => test.key);
  const result = await query('testSummaries', selected, { tests, ...options });
  assert.deepEqual(result.items.map((item) => item.test.key), tests);
  for (const item of result.items) {
    const analysis = await query('analyze', selected, { testKey: item.test.key, ...options });
    assert.deepEqual(item, { test: analysis.test, population: analysis.population, series: analysis.series.map(({ key, group, head, site, label, stats }) => ({ key, group, head, site, label, stats })) });
    for (const series of item.series) assert.ok(!('bins' in series) && !('points' in series) && !('reduced' in series));
  }
  return result;
}
const closeTo = (actual, wanted) => assert.ok(Math.abs(actual - wanted) < 1e-12 * Math.max(1, Math.abs(wanted)), `${actual} != ${wanted}`);
try {
  browser = await chromium.launch({ channel, headless: true });
  page = await browser.newPage(); page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/storage.html`);
  await page.evaluate(async () => {
    const { DataLibraryClient } = await import('./data-client.js');
    window.library = new DataLibraryClient({ onProgress(event) {
      if (window.cancelPhase === event.phase) { window.cancelPhase = null; library.cancel(); }
    } }); await library.open();
  });
  const imported = [];
  for (const endian of ['little', 'big']) {
    const golden = await importFile(resolve(repo, '.venv/viewer-fixtures', `golden-${endian}.stdf`));
    const catalog = await query('tests', selection([golden]), { order: 'original' });
    const compactCatalog = await query('tests', selection([golden]), { order: 'original', includePins: false });
    assert.ok(catalog.items.some((test) => test.pins?.length));
    assert.deepEqual(compactCatalog, { ...catalog, items: catalog.items.map(({ pins, pinLabel, ...test }) => test) });
    assert.equal(await rejection(selection([golden]), { includePins: 'false' }, 'tests'), 'INVALID_REQUEST');
    const compared = await compare(selection([golden]), { seriesBy: 'site', includeAggregate: true });
    assert.deepEqual([...new Set(compared.items.map((item) => item.test.family))], [10, 15, 20]);
    const functional = compared.items.find((item) => item.test.family === 20).series[0].stats;
    assert.equal(functional.cpk, null); assert.match(functional.cpkReason, /Functional/);
    await compare(selection([golden], 'current'));
    const id = await importFile(resolve(fixtures, `population-${endian}.stdf`)); imported.push(id);
    const selected = selection([id]), result = await compare(selected), main = result.items.find((item) => item.test.number === 101);
    const head1 = main.series.find((series) => series.head === 1).stats;
    for (const field of ['mean', 'median', 'stdev']) closeTo(head1[field], expected.head1[field]);
    assert.equal(head1.excluded, 2); assert.equal(head1.changingLimits, true); assert.equal(head1.cpk, null);
    await compare({ ...selected, heads: [1], sites: [1] }, { seriesBy: 'site', includeAggregate: true });
    await compare({ ...selected, heads: [99] }, {}, [main.test.key]).then((empty) => assert.deepEqual(empty.items[0].series, []));
    checks.push(`${endian}: compact catalogue keeps ordered identities without pin enrichment; exact summary/analysis equality for PTR, MPR and FTR; independent moments; invalid values, changing limits, head/site and empty scopes`);
  }
  const retest = await importFile(resolve(fixtures, 'retest.stdf'));
  const grouped = { groups: [{ name: 'Original', datasetIds: [imported[0]] }, { name: 'Retest', datasetIds: [imported[0], retest] }], attempts: 'current' };
  const merged = await compare(grouped, { seriesBy: 'site', includeAggregate: true });
  const aggregate = merged.items.find((item) => item.test.number === 101).series.find((series) => series.group === 1 && series.head === 1 && series.site === null).stats;
  for (const field of ['mean', 'median', 'stdev']) closeTo(aggregate[field], expected.mergedHead1[field]);
  await compare({ ...grouped, attempts: 'all' });
  checks.push('ordered cross-file retest and independent groups retain distinct full-population statistics');

  const unresolvedIds = [];
  for (const suffix of ['a', 'b']) unresolvedIds.push(await importFile(resolve(fixtures, `unresolved-${suffix}.stdf`)));
  const unresolved = await compare(selection(unresolvedIds));
  assert.equal(unresolved.items.length, 2);
  assert.ok(unresolved.items.every((item) => item.test.identity.includes('unresolved-omitted')));
  assert.deepEqual(unresolved.items.map((item) => item.series[0].stats.mean).sort((a, b) => a - b), [17, 23]);
  checks.push('same-number unresolved tests remain separated by source identity');

  const many = selection([await importFile(resolve(fixtures, 'many-tests.stdf'))]);
  const keys = (await query('tests', many)).items.map((test) => test.key), batch = await compare(many, {}, keys.slice(0, 25).reverse());
  assert.equal(keys.length, 36); assert.equal(batch.items.length, 25);
  for (const options of [{}, { tests: [] }, { tests: keys.slice(0, 26) }, { tests: [keys[0], keys[0]] }, { tests: ['bad'] }, { tests: [keys[0]], seriesBy: 'bad' }, { tests: [keys[0]], includeAggregate: 'yes' }]) assert.equal(await rejection(many, options), 'INVALID_REQUEST');
  const manySites = selection([await importFile(resolve(fixtures, 'many-series.stdf'))]), siteKey = (await query('tests', manySites)).items[0].key;
  assert.equal(await rejection(manySites, { tests: [siteKey], seriesBy: 'site' }), 'INVALID_REQUEST');
  assert.equal((await query('testSummaries', { ...manySites, sites: Array.from({ length: 64 }, (_, i) => i + 1) }, { tests: [siteKey], seriesBy: 'site' })).items[0].series.length, 64);
  checks.push('25-test batches preserve request order; malformed, duplicate, oversized requests and more than 64 series fail explicitly');

  await page.evaluate(() => { window.cancelPhase = 'viewer-test-summaries'; });
  assert.equal(await rejection(many, { tests: keys.slice(0, 25) }), 'CANCELLED');
  assert.equal((await query('testSummaries', many, { tests: keys.slice(0, 25) })).items.length, 25);
  const large = selection([await importFile(resolve(fixtures, 'cancel.stdf'))]), largeKey = (await query('tests', large)).items[0].key;
  await page.evaluate(() => { window.cancelPhase = 'viewer-query'; });
  assert.equal(await rejection(large, { tests: [largeKey] }), 'CANCELLED');
  await page.evaluate(() => { window.cancelPhase = 'viewer-distribution'; });
  assert.equal(await rejection(large, { tests: [largeKey] }), 'CANCELLED');
  assert.equal((await query('testSummaries', large, { tests: [largeKey] })).items[0].population.observations, 20000);
  checks.push('cancellation between small tests and inside both full scans releases statements and permits immediate retry');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ channel, checks, errors }, null, 2));
  console.log(JSON.stringify({ output, checks, errors }, null, 2));
} catch (error) {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: error.stack, checks, errors }, null, 2));
  throw error;
} finally { await browser?.close(); await new Promise((done) => server.close(done)); }
