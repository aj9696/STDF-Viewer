// Real Rust/WASM + SQLite worker checks for the device-only Yield Manager.
// Run: node scripts/viewer-yield-check.mjs chrome|msedge
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { verifyYieldBounds } from './viewer-yield-bounds-check.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), repo = resolve(root, '..'), site = resolve(root, 'site');
const channel = process.argv[2] ?? 'chrome';
if (!['chrome', 'msedge'].includes(channel)) throw Error('Choose chrome or msedge');
const output = resolve(root, 'results', `viewer-yield-${channel}-${Date.now()}`), fixtures = resolve(output, 'fixtures');
await mkdir(output, { recursive: true });
const generated = spawnSync(resolve(repo, '.venv/Scripts/python.exe'), [resolve(root, 'scripts/make-yield-fixtures.py'), fixtures], { encoding: 'utf8' });
assert.equal(generated.status, 0, generated.stderr);
const worker = `import {LibraryStore} from './library-store.js';
import {importSource} from './import-source.js';
import {openViewerContext} from './viewer-context.js';
import {listDevices} from './viewer-tables.js';
import {runAdvancedQuery} from './viewer-advanced-queries.js';
const store=new LibraryStore();
self.onmessage=async({data})=>{let view,cancelled=false;try{
const context={progress(event){if(data.cancelPhase===event.phase)cancelled=true;},checkCancelled(){if(cancelled)throw Object.assign(Error('Intentional cancellation'),{code:'CANCELLED'});}};
if(data.action==='open'){await store.open();self.postMessage({ok:true});return;}
if(data.action==='close'){await store.close();self.postMessage({ok:true});return;}
if(data.action==='import'){const result=await importSource(store,data.file,data.file.name,context);self.postMessage({ok:true,result});return;}
view=await openViewerContext(store,data.selection,context);
const sql=[],prepare=view.db.prepare.bind(view.db);view.db.prepare=(query,...args)=>{sql.push(query);return prepare(query,...args);};
const result=data.action==='devices'?await listDevices(view,data.options):await runAdvancedQuery(view,{kind:'yieldManager'});
self.postMessage({ok:true,result:data.audit?{result,sql}:result});
}catch(error){self.postMessage({ok:false,error:error.stack??error.message,code:error.code});}finally{view?.close();}};`;
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<input id="file" type="file">'); return; }
    if (pathname === '/yield-worker.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(worker); return; }
    const path = resolve(site, '.' + decodeURIComponent(pathname)); if (!path.startsWith(site + sep)) throw Error('Outside site');
    response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' })[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, checks = [], errors = [];
let browser;
const selection = (ids, attempts = 'current') => ({ groups: [{ name: 'Production', datasetIds: ids }], attempts });
const total = ({ total, passed, failed, unknown, yield: yieldValue }) => ({ total, passed, failed, unknown, yield: yieldValue });
try {
  checks.push(...await verifyYieldBounds());
  browser = await chromium.launch({ channel, headless: true });
  const page = await browser.newPage(); page.on('pageerror', (error) => errors.push(error.message)); await page.goto(origin);
  await page.evaluate(() => {
    window.worker = new Worker('/yield-worker.js', { type: 'module' });
    window.call = (data) => new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => data.ok ? resolve(data.result) : reject(Object.assign(Error(data.error), { code: data.code }));
      worker.onerror = reject; worker.postMessage(data);
    });
  });
  const call = (action, selected, options = {}, extra = {}) => page.evaluate((data) => window.call(data), { action, selection: selected, options, ...extra });
  const rejection = (action, selected, options = {}, extra = {}) => page.evaluate(async (data) => { try { await window.call(data); return null; } catch (error) { return error.code; } }, { action, selection: selected, options, ...extra });
  const importFile = async (name) => {
    await page.locator('#file').setInputFiles(resolve(fixtures, name));
    return (await page.evaluate(() => window.call({ action: 'import', file: document.querySelector('#file').files[0] }))).dataset.id;
  };
  await call('open');
  const ids = {};
  for (const name of ['original-little', 'original-big', 'retest', 'other-product', 'other-sublot', 'undated', 'many-devices']) ids[name] = await importFile(`${name}.stdf`);
  await assert.rejects(() => importFile('multiple-headers.stdf'), /Multiple MIR records are unsupported/);
  for (const endian of ['little', 'big']) {
    const selected = selection([ids[`original-${endian}`]]), { result, sql } = await call('summary', selected, {}, { audit: true });
    assert.equal(result.method, 'yield-manager-v1'); assert.equal(result.files.length, 1);
    const file = result.files[0];
    assert.deepEqual(total(file), { total: 7, passed: 2, failed: 3, unknown: 2, yield: 0.4 });
    assert.deepEqual([file.lotId, file.sublotId, file.product, file.program, file.revision, file.flow, file.stage, file.tester], ['LOT-7', 'S1', 'PRODUCT-A', 'FINAL', 'R1', 'PRODUCTION', 'FT', 'TESTER-1']);
    assert.equal(file.startTime, 1792368000); assert.equal(file.finishTime, 1792368060);
    assert.deepEqual(total(file.sites.find((row) => row.head === 2)), { total: 2, passed: 0, failed: 0, unknown: 2, yield: null });
    assert.deepEqual(file.softBins.find((row) => row.number === 65535), { number: 65535, total: 2, passed: 0, failed: 1, unknown: 1 });
    assert.equal(sql.filter((text) => /FROM v_devices/.test(text)).length, 1);
    assert.ok(!sql.some((text) => /observations|v_tests|wafer/i.test(text)), sql.join('\n'));
    checks.push(`${endian}: exact PRR outcomes and source labels; unknown yield and missing-bin retention; one device scan and no observation reads`);
  }
  const base = ids['original-little'], retest = ids.retest;
  const grouped = { groups: [{ name: 'Original', datasetIds: [base] }, { name: 'Retest', datasetIds: [base, retest] }], attempts: 'current' };
  const result = await call('summary', grouped);
  assert.deepEqual(result.reviewGroups, []);
  assert.equal(result.files.length, 3); assert.equal(result.files[0].total, 7);
  assert.deepEqual(total(result.files[1]), { total: 6, passed: 2, failed: 2, unknown: 2, yield: 0.5 });
  assert.deepEqual(total(result.files[2]), { total: 2, passed: 1, failed: 1, unknown: 0, yield: 0.5 });
  assert.equal(new Set(result.files.map((file) => file.key)).size, 3);
  assert.equal((await call('summary', { ...grouped, attempts: 'all' })).files[1].total, 7);
  for (const file of result.files) {
    const filter = { group: file.group, datasetIds: [file.datasetId] };
    assert.equal((await call('devices', grouped, filter)).total, file.total);
    for (const [outcome, count] of [['pass', 'passed'], ['fail', 'failed'], ['unknown', 'unknown']]) assert.equal((await call('devices', grouped, { ...filter, outcome })).total, file[count]);
    for (const site of file.sites) {
      const devices = await call('devices', grouped, { ...filter, pick: { type: 'bin', seriesKeys: [JSON.stringify([file.group, site.head, site.site])] } });
      assert.equal(devices.total, site.total);
    }
    for (const bin of file.softBins) assert.equal((await call('devices', grouped, { ...filter, outcome: 'fail', bin: { kind: 'soft', number: bin.number } })).total, bin.failed);
  }
  const filtered = await call('devices', grouped, { group: 1, datasetIds: [base] });
  assert.ok(!filtered.items.some((device) => device.part_id === 'A'));
  assert.equal((await call('devices', selection([base]), {})).total, 7);
  const scoped = await call('summary', { ...grouped, heads: [1], sites: [2] });
  assert.deepEqual(scoped.files.map((file) => [file.total, file.failed]), [[2, 2], [2, 2], [1, 1]]);
  checks.push('independent groups, all/current attempts, head/site scope, and every source/outcome/site/fail-bin drilldown match; source filter retains later replacement decisions');
  const metadata = await call('summary', selection([base, ids['other-product'], ids.undated]));
  assert.deepEqual(metadata.files.slice(0, 2).map((file) => [file.lotId, file.product, file.program, file.revision, file.sublotId]), [['LOT-7', 'PRODUCT-A', 'FINAL', 'R1', 'S1'], ['LOT-7', 'PRODUCT-B', 'PROBE', 'R2', 'S2']]);
  assert.equal(metadata.files[2].lotId, null); assert.equal(metadata.files[2].startTime, null); assert.equal(metadata.files[2].finishTime, null); assert.equal(metadata.files[2].yield, null);
  assert.ok(metadata.warnings.some((text) => /different or missing/.test(text)));
  assert.deepEqual(metadata.reviewGroups, [0]);
  const mixedGroups = { groups: [{ name: 'Original', datasetIds: [base] }, { name: 'Mixed', datasetIds: [base, ids['other-product']] }], attempts: 'current' };
  assert.deepEqual((await call('summary', mixedGroups)).reviewGroups, [1]);
  assert.deepEqual((await call('summary', { ...mixedGroups, attempts: 'all' })).reviewGroups, []);
  const sublots = await call('summary', selection([base, ids['other-sublot']]));
  assert.deepEqual(sublots.files.map((file) => file.sublotId), ['S1', 'S2']);
  assert.equal(sublots.files[0].total, 6);
  assert.ok(sublots.warnings.some((text) => /different or missing lot, sublot/.test(text)));
  assert.deepEqual(sublots.reviewGroups, [0]);
  checks.push('same lot names retain product/program/revision/sublot distinctions; missing dates remain null; importer rejects multiple headers; mixed-cohort replacement policy is explicit');
  for (const options of [{ datasetIds: [] }, { datasetIds: [base, base] }, { datasetIds: ['bad'] }, { datasetIds: [ids.undated] }, { group: 0, datasetIds: [retest] }, { outcome: 'invalid' }, { outcome: '__proto__' }]) assert.equal(await rejection('devices', grouped, options), 'INVALID_REQUEST');
  const many = selection([ids['many-devices']]);
  for (const cancelPhase of ['viewer-yield-manager', 'viewer-query']) assert.equal(await rejection('summary', many, {}, { cancelPhase }), 'CANCELLED');
  assert.equal((await call('summary', many)).files[0].total, 5003);
  assert.equal((await call('summary', { ...many, heads: [99] })).files[0].yield, null);
  checks.push('invalid filter inputs rejected; cancellation before and during the scan releases statements; retry and empty scopes succeed');
  await call('close'); assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ channel, checks, errors }, null, 2));
  console.log(JSON.stringify({ output, checks, errors }, null, 2));
} catch (error) {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: error.stack, checks, errors }, null, 2)); throw error;
} finally { await browser?.close(); await new Promise((done) => server.close(done)); }
