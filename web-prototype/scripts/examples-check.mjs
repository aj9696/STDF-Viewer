// Run from web-prototype: node scripts/examples-check.mjs chrome|msedge
// Isolated browser profile; never opens or changes the user's library.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url)), site = resolve(root, 'site');
const channel = process.argv[2] ?? 'chrome';
assert.ok(['chrome', 'msedge'].includes(channel), 'Choose chrome or msedge');
const output = resolve(root, 'results', `examples-${channel}-${Date.now()}`);
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(resolve(site, 'examples/manifest.json'), 'utf8'));
assert.equal(manifest.version, 1);
assert.equal(manifest.examples.length, 5);
const server = createServer(async (request, response) => {
  try {
    const path = resolve(site, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!path.startsWith(site + sep)) throw Error('Outside site');
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json' })[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, errors = [], checks = [], traces = [];
let browser, page;
const query = (action, selection, options = {}) => page.evaluate(({ action, selection, options }) => library.viewer(action, selection, options), { action, selection, options });
const groupsFor = (files) => ({ groups: files.map((file) => ({ name: file.name, datasetIds: [file.id] })), attempts: 'current' });
const sourceFiles = new Map();
try {
  browser = await chromium.launch({ channel, headless: true });
  page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/storage.html`);
  await page.evaluate(async () => {
    const { DataLibraryClient } = await import('./data-client.js');
    window.library = new DataLibraryClient(); await library.open();
  });
  for (const example of manifest.examples) {
    for (const file of example.files) {
      const bytes = await readFile(resolve(site, file.url));
      assert.equal(bytes.length, file.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
      if (sourceFiles.has(file.name)) continue;
      const result = await page.evaluate(async (file) => {
        const response = await fetch(file.url); if (!response.ok) throw Error('Example fetch failed');
        return library.importFile(new File([await response.blob()], file.name));
      }, file);
      sourceFiles.set(file.name, { ...file, id: result.dataset.id });
      assert.equal((await page.evaluate((id) => library.verifyDataset(id), result.dataset.id)).verified, true);
    }
    const selection = groupsFor(example.files.map((file) => sourceFiles.get(file.name)));
    const prepared = await query('prepare', selection), overview = await query('overview', selection);
    const tests = await query('tests', selection), expected = example.expected;
    assert.equal(tests.total, expected.catalogueRows ?? expected.tests);
    for (const source of prepared.sources) {
      assert.equal(source.manifest.counts.observations, expected.observations ?? expected.observationsPerFile);
      assert.equal(source.manifest.counts.devices, expected.attempts ?? expected.devicesPerFile);
    }
    if (expected.passed !== undefined) {
      assert.equal(overview.groups[0].passed, expected.passed); assert.equal(overview.groups[0].failed, expected.failed);
      assert.equal(overview.groups[0].unknown, expected.unknown ?? 0);
    }
    const current = tests.items.find((test) => test.number === 1002);
    if (example.id === 'baseline') {
      const analysis = await query('analyze', selection, { testKey: current.key });
      assert.equal(analysis.series[0].stats.count, 48); assert.equal(analysis.series[0].stats.mean, 18);
      assert.equal(analysis.series[0].stats.fail, 0);
    } else if (example.id === 'site-shift') {
      assert.deepEqual(overview.groups.map((group) => [group.passed, group.failed]), [[48, 0], [36, 12]]);
      const analysis = await query('analyze', selection, { testKey: current.key, seriesBy: 'site' });
      const shifted = analysis.series.filter((series) => series.group === 1).sort((a, b) => a.site - b.site);
      assert.deepEqual(shifted.map((series) => [series.site, series.stats.count, series.stats.fail]), [[1, 24, 0], [2, 24, 12]]);
      assert.ok(Math.abs(shifted[0].stats.mean - 18) < 1e-12);
      assert.ok(Math.abs(shifted[1].stats.mean - 24) < 1e-12);
      assert.equal((await query('devices', selection)).total, 96);
      const pass = await query('bins', selection, { kind: 'soft' });
      assert.deepEqual(pass.series[1].bins.map((bin) => [bin.number, bin.count]), [[1, 36], [2, 12]]);
      traces.push({ id: example.id, shifted: shifted.map((series) => ({ site: series.site, stats: series.stats })) });
    } else if (example.id === 'retest') {
      const group = overview.groups[0];
      assert.deepEqual([group.total, group.superseded, group.passed, group.failed], [30, 6, 24, 0]);
      assert.equal((await query('devices', selection)).total, 24);
      const all = { ...selection, attempts: 'all' }, allDevices = await query('devices', all);
      assert.equal(allDevices.total, 30);
      assert.deepEqual(allDevices.items.filter((device) => device.retired).map((device) => device.part_id), ['D001', 'D002', 'D003', 'D004', 'D005', 'D006']);
      assert.equal((await query('analyze', selection, { testKey: current.key })).series[0].stats.fail, 0);
      const allStats = (await query('analyze', all, { testKey: current.key })).series[0].stats;
      assert.deepEqual([allStats.count, allStats.pass, allStats.fail], [30, 24, 6]);
    } else if (example.id === 'wafer') {
      const wafers = await query('wafers', selection); assert.equal(wafers.items.length, 1);
      assert.equal(wafers.items[0].name, 'WAFER-01');
      const map = await query('wafer', selection, { waferKey: wafers.items[0].key });
      assert.equal(map.dies.length, 49);
      for (const die of map.dies) {
        assert.equal(die.failed, die.x * die.x + die.y * die.y >= 10 ? 1 : 0);
        assert.equal(die.bin, die.failed ? 2 : 1);
      }
      assert.equal(map.dies.reduce((n, die) => n + die.failed, 0), 20);
    } else if (example.id === 'mixed') {
      assert.deepEqual(tests.items.map((test) => test.family), [10, 15, 15, 15, 20]);
      const leakage = tests.items.find((test) => test.number === 1003);
      const pins = tests.items.filter((test) => test.number === 2001);
      assert.deepEqual(pins.map((pin) => pin.pinLabel), ['GPIO0', 'GPIO1', 'GPIO2']);
      const leakageStats = (await query('analyze', selection, { testKey: leakage.key })).series[0].stats;
      assert.deepEqual([leakageStats.total, leakageStats.count, leakageStats.excluded], [21, 19, 2]);
      const devices = await query('devices', selection, { tests: [leakage.key] });
      assert.deepEqual(devices.items.filter((device) => !device.testResults[leakage.key]?.length).map((device) => device.part_id), expected.leakageMissingParts);
      for (const pin of pins) {
        const stats = (await query('analyze', selection, { testKey: pin.key })).series[0].stats;
        assert.deepEqual([stats.count, stats.fail], [24, 2]); // TEST_FLG applies to the entire MPR record.
      }
      const digital = tests.items.find((test) => test.number === 3001);
      const digitalStats = (await query('analyze', selection, { testKey: digital.key })).series[0].stats;
      assert.deepEqual([digitalStats.total, digitalStats.count, digitalStats.fail, digitalStats.unknown], [24, 23, 2, 1]);
      traces.push({ id: example.id, leakageStats, digitalStats });
    }
    assert.equal((await query('prepare', selection)).sources.every((source) => source.reused), true);
    checks.push(`${example.id}: original hash, import, derived counts, catalogue, expected outcomes and scenario-specific queries`);
  }
  const duplicate = await page.evaluate(async () => {
    const response = await fetch('examples/baseline.stdf');
    return library.importFile(new File([await response.blob()], 'renamed-baseline.stdf'));
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.dataset.id, sourceFiles.get('baseline.stdf').id);
  checks.push('Repeated or renamed baseline reuses the saved dataset');
  assert.deepEqual(errors, []);
  const result = { channel, checks, errors, sourceBytes: [...sourceFiles.values()].reduce((n, file) => n + file.bytes, 0), traces };
  await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, ...result }, null, 2));
} catch (error) {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: error.stack, checks, errors, traces }, null, 2));
  throw error;
} finally {
  await browser?.close(); await new Promise((done) => server.close(done));
}
