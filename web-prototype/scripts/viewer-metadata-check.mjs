// Real retained import, WASM viewer decode, and SQLite cache lifecycle regression.
// node scripts/viewer-metadata-check.mjs chrome|msedge [--expect-limit] [--runtime path]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url)), repo = resolve(root, '..'), site = resolve(root, 'site');
const channel = process.argv[2] ?? 'chrome', expectLimit = process.argv.includes('--expect-limit');
assert.ok(['chrome', 'msedge'].includes(channel));
const runtimeArgument = process.argv.indexOf('--runtime');
if (runtimeArgument >= 0 && !process.argv[runtimeArgument + 1]) throw Error('--runtime needs a directory');
const runtimeDirectory = runtimeArgument >= 0 ? resolve(process.argv[runtimeArgument + 1]) : resolve(site, 'pkg');
const output = resolve(root, 'results', `viewer-metadata-${expectLimit ? 'before' : 'fixed'}-${channel}-${Date.now()}`), fixtures = resolve(output, 'fixtures');
await mkdir(output, { recursive: true });
const generated = spawnSync(resolve(repo, '.venv/Scripts/python.exe'), [resolve(root, 'scripts/make-viewer-metadata-fixtures.py'), fixtures], { encoding: 'utf8' });
assert.equal(generated.status, 0, generated.stderr || generated.error?.message);
const expected = JSON.parse(await readFile(resolve(fixtures, 'expected.json'), 'utf8'));
// Snapshot both runtime assets in memory so a concurrent rebuild cannot mix versions.
const runtimeFiles = Object.fromEntries(await Promise.all(['parser.js', 'parser_bg.wasm'].map(async name => [name, await readFile(resolve(runtimeDirectory, name))])));
const wasmSha256 = createHash('sha256').update(runtimeFiles['parser_bg.wasm']).digest('hex');
const probeWorker = `
import {LibraryStore} from './library-store.js';
import {runOperation} from './library-operations.js';
import {runViewerQuery} from './viewer-queries.js';
const store=new LibraryStore(), context={progress(){},checkCancelled(){}};
self.onmessage=async({data})=>{try{
 let result;
 if(data.action==='open') result=await store.open();
 else if(data.action==='close') result=await store.close();
 else if(data.action==='import') result=await runOperation(store,{type:'importFile',file:data.file},context);
 else if(data.action==='verify') result=await runOperation(store,{type:'verifyDataset',datasetId:data.datasetId},context);
 else if(data.action==='inventory') result={files:store.pool.getFileNames(),dataset:store.present(store.get(data.datasetId))};
 else result=await runViewerQuery(store,{action:data.action,selection:data.selection,options:data.options??{}},context);
 self.postMessage({ok:true,result});
}catch(error){self.postMessage({ok:false,error:{code:error.code,message:String(error.message??error)}});}};`;
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/__metadata-worker.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(probeWorker); return; }
    if (pathname.startsWith('/pkg/') && Object.hasOwn(runtimeFiles, pathname.slice(5))) {
      const name = pathname.slice(5); response.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'); response.end(runtimeFiles[name]); return;
    }
    const file = resolve(site, '.' + pathname);
    if (!file.startsWith(site + sep)) throw Error('Outside site');
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, checks = [], sources = [], errors = [], timings = [];
let browser, page;
const request = (action, payload = {}) => page.evaluate(message => new Promise((resolve, reject) => {
  metadataWorker.onmessage = ({ data }) => data.ok ? resolve(data.result) : reject(Object.assign(Error(data.error.message), { code: data.error.code }));
  metadataWorker.onerror = event => reject(Error(event.message)); metadataWorker.postMessage(message);
}), { action, ...payload });
const query = (action, selection, options = {}) => request(action, { selection, options });
const timed = async (phase, task) => { const start = performance.now(); try { return await task(); } finally { timings.push({ phase, elapsedMs: performance.now() - start }); } };

try {
  browser = await chromium.launchPersistentContext(resolve(output, 'profile'), { channel, headless: true });
  page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/storage.html');
  await page.evaluate(() => { window.metadataWorker = new Worker('/__metadata-worker.js', { type: 'module' }); });
  await request('open');
  for (const [filename, golden] of Object.entries(expected)) {
    if (expectLimit && golden.purpose !== 'accounting') continue;
    await page.locator('#backup-file').setInputFiles(resolve(fixtures, filename));
    const imported = await timed(filename + ':retained-import', () => page.evaluate(() => new Promise((resolve, reject) => {
      metadataWorker.onmessage = ({ data }) => data.ok ? resolve(data.result) : reject(Error(data.error.message));
      metadataWorker.postMessage({ action: 'import', file: document.querySelector('#backup-file').files[0] });
    })));
    const datasetId = imported.dataset.id, selection = { groups: [{ name: filename, datasetIds: [datasetId] }], attempts: 'all' };
    assert.equal(imported.dataset.source_hash, golden.sha256);
    assert.deepEqual(imported.dataset.manifest.counts, golden.retainedCounts);
    let prepared, rejected;
    try { prepared = await timed(filename + ':cold-viewer', () => query('prepare', selection)); }
    catch (error) { rejected = { message: error.message }; }
    if (expectLimit) {
      assert.ok(rejected, 'Old runtime should reproduce the reported declaration limit');
      assert.match(rejected.message, /METADATA_LIMIT: viewer declaration state exceeds 16 MiB/);
      const inventory = await request('inventory', { datasetId });
      assert.equal(inventory.dataset.status, 'ready');
      assert.ok(!inventory.files.includes(`/viewer-v1-${datasetId}.sqlite3`), 'Failed disposable cache must be removed');
      const verified = await request('verify', { datasetId }); assert.equal(verified.verified, true); assert.equal(verified.sha256, golden.sha256);
      sources.push({ filename, ...golden, datasetId, rejected, sourcePreserved: true, failedCacheRemoved: true });
      checks.push(filename + ': original failure reproduced after successful retained import; source verified and failed cache removed');
      continue;
    }
    assert.equal(rejected, undefined, JSON.stringify(rejected));
    assert.equal(prepared.sources[0].reused, false);
    assert.equal(prepared.sources[0].manifest.counts.tests, golden.tests);
    assert.equal(prepared.sources[0].manifest.counts.observations, golden.observations);
    assert.equal(prepared.sources[0].manifest.counts.devices, golden.devices);
    if (golden.purpose === 'turnover') assert.equal(prepared.sources[0].manifest.counts.pinStates, golden.observations);
    const catalog = await query('tests', selection, { query: golden.firstTest.name, limit: 10 });
    assert.equal(catalog.total, 1); const first = catalog.items[0];
    assert.equal(first.number, golden.firstTest.number); assert.equal(first.unit, golden.firstTest.unit);
    assert.equal((await query('tests', selection, { limit: 1 })).total, golden.tests);
    // First and last physical records are exposed through exact statistics.
    const analysis = await query('analyze', selection, { testKey: first.key, bins: 5 });
    const expectedObservations = golden.purpose === 'turnover' ? golden.observations : 4;
    assert.equal(analysis.population.observations, expectedObservations); assert.equal(analysis.series[0].stats.count, expectedObservations);
    assert.ok(Math.abs(analysis.series[0].stats.mean - golden.firstTest.mean) < 1e-12); assert.equal(analysis.series[0].stats.median, golden.firstTest.median);
    assert.equal(analysis.series[0].bins.reduce((sum, bin) => sum + bin.count, 0), expectedObservations);
    if (golden.purpose === 'turnover') {
      assert.equal(first.channel, 'pmr:42');
      const detail = await query('device', selection, { datasetId, deviceId: golden.deviceIds[0], after: golden.lateAfter, limit: 10 });
      assert.deepEqual(detail.items.map(({ seq, value, low, high, pmr_index }) => ({ seq, value, low, high, pmr_index })), golden.lateObservations);
      assert.equal(detail.nextAfter, null);
    } else {
      const matched = await query('devices', selection, { tests: [first.key], limit: 10 });
      const values = matched.items.flatMap(item => item.testResults[first.key]).sort((a, b) => a.seq - b.seq);
      assert.deepEqual(values.map(item => ({ seq: item.seq, value: item.value, low: item.low, high: item.high })), golden.firstTest.observations);
    }
    assert.equal((await query('prepare', selection)).sources[0].reused, true);
    await request('close');
    await page.evaluate(() => { metadataWorker.terminate(); window.metadataWorker = new Worker('/__metadata-worker.js', { type: 'module' }); });
    await request('open');
    assert.equal((await query('prepare', selection)).sources[0].reused, true);
    assert.deepEqual(await query('analyze', selection, { testKey: first.key, bins: 5 }), analysis);
    const verified = await request('verify', { datasetId }); assert.equal(verified.sha256, golden.sha256);
    sources.push({ filename, ...golden, datasetId, manifest: prepared.sources[0].manifest });
    checks.push(filename + ': cold cache counts, original/default/local-limit semantics, exact statistics, warm/reopened cache reuse, source integrity');
  }
  assert.deepEqual(errors, []);
  await request('close');
  const result = { channel, expectLimit, wasmSha256, runtimeDirectory, output, checks, timings, sources, errors };
  await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ channel, expectLimit, wasmSha256, output, checks, timings, fixtures: Object.fromEntries(Object.entries(expected).map(([name, value]) => [name, { bytes: value.bytes, records: value.records, tests: value.tests, declarations: value.declarations, observations: value.observations }])) }, null, 2));
} catch (error) {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: error.stack, wasmSha256, checks, timings, sources, errors }, null, 2));
  throw error;
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
