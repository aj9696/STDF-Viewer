// Run: node scripts/viewer-population-check.mjs chrome|msedge [--plans]
// Fixtures use repository .venv Python. VIEWER_LEGACY_PACKAGE can select a
// genuine archived retained-v1 package. --plans additionally uses the existing
// .venv/bench-data/benchmark-10000d-100t.stdf qualification workload.
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
const output = resolve(root, 'results', `viewer-population-${channel}-${Date.now()}`);
await mkdir(output, { recursive: true });
const fixtures = resolve(output, 'fixtures');
const python = spawnSync(resolve(repo, '.venv/Scripts/python.exe'), [resolve(root, 'scripts/make-viewer-populations.py'), fixtures], { encoding: 'utf8' });
assert.equal(python.status, 0, python.stderr);
const expected = JSON.parse(await readFile(resolve(fixtures, 'expected.json'), 'utf8'));
const iteratorWorker = `import {LibraryStore} from './library-store.js';
import {openViewerContext} from './viewer-context.js';
import {iterateReportDevices,listDevices,listViewerTests} from './viewer-tables.js';
self.onmessage=async({data})=>{const store=new LibraryStore();let view,result;try{
await store.open();view=await openViewerContext(store,data.selection,{checkCancelled(){},progress(){}});
const tests=listViewerTests(view,{}).items.filter(t=>[101,202].includes(t.number)).map(t=>t.key);
const expected=await listDevices(view,{tests,offset:data.large?4090:0,limit:data.large?30:1000});
const metrics={deviceRows:0,matrixRows:0,deviceQueries:0,matrixQueries:0,vmSteps:0,fullScanSteps:0,maxDevicePage:0,queries:[],plans:{}};
const prepare=view.db.prepare.bind(view.db);
view.db.prepare=(sql,...args)=>{const statement=prepare(sql,...args),kind=sql.startsWith('SELECT d.* FROM(')?'device':sql.startsWith('SELECT o.device_id')?'matrix':null;
if(kind){metrics[kind+'Queries']++;metrics.queries.push(sql);let visited=0;
const bind=statement.bind.bind(statement),step=statement.step.bind(statement),finalize=statement.finalize.bind(statement);
statement.bind=(values)=>{if(!metrics.plans[kind])metrics.plans[kind]=view.db.selectObjects('EXPLAIN QUERY PLAN '+sql,values);return bind(values);};
statement.step=()=>{const more=step();if(more){metrics[kind+'Rows']++;visited++;}return more;};
statement.finalize=()=>{metrics.vmSteps+=store.sqlite3.capi.sqlite3_stmt_status(statement.pointer,4,0);metrics.fullScanSteps+=store.sqlite3.capi.sqlite3_stmt_status(statement.pointer,1,0);if(kind==='device')metrics.maxDevicePage=Math.max(metrics.maxDevicePage,visited);return finalize();};
}return statement;};
let count=0,retained=[],mainRows=0,extraRows=0;
try{for await(const row of iterateReportDevices(view,{tests})){
if(!data.large||count>=4090&&count<4120)retained.push(row);
if(data.large){if(row.part_id!=='ROW-'+String(count).padStart(5,'0')||row.dut_index!==count+1)throw Error('Iterator skipped/reordered row '+count);
for(const key of tests){const number=JSON.parse(key)[1],values=(row.testResults[key]??[]).map(r=>r.value),wanted=number===101?[count%11,...(count%17===0?[100+count%11]:[])]:count%3===0?[count%7]:[];
if(JSON.stringify(values)!==JSON.stringify(wanted))throw Error('Matrix mismatch '+count+'/'+number);if(number===101)mainRows+=values.length;else extraRows+=values.length;}}
count++;}}finally{view.db.prepare=prepare;}
if(JSON.stringify(retained)!==JSON.stringify(expected.items))throw Error('Iterator differs from interactive page');
result={count,mainRows,extraRows,metrics};
}catch(e){result={error:e.stack??e.message};}finally{view?.close();await store.close();}self.postMessage(result);};`;
const planWorker = `import {LibraryStore} from './library-store.js';
import {openViewerContext,retiredExpression} from './viewer-context.js';
import {waferMap} from './viewer-maps.js';
self.onmessage=async({data})=>{const store=new LibraryStore();let view,result;try{await store.open();view=await openViewerContext(store,data,{checkCancelled(){},progress(){}});
const alias=view.sources[0].alias, test=view.db.selectObject('SELECT * FROM '+alias+'.channels LIMIT 1');
const deviceProjection=(index='')=>'SELECT d.*,0 source,0 group_id,0 source_index,ss.dataset_id,ss.name source_name,d.dut_index+ss.attempt_offset x_index,CASE WHEN '+retiredExpression(view,view.sources[0])+' THEN 1 ELSE 0 END retired FROM '+alias+'.devices d '+index+' JOIN source_scope ss ON ss.source=0';
const devicePlan=(field,index='')=>view.db.selectObjects('EXPLAIN QUERY PLAN SELECT d.* FROM('+deviceProjection(index)+') d WHERE d.retired=0 ORDER BY d.'+field+' asc,d.id asc');
const plans={device:devicePlan('id'),part:devicePlan('part_id','INDEXED BY devices_sort_part'),time:devicePlan('test_time','INDEXED BY devices_sort_time'),head:devicePlan('head','INDEXED BY devices_sort_head'),site:devicePlan('site','INDEXED BY devices_sort_site'),
value:view.db.selectObjects('EXPLAIN QUERY PLAN SELECT o.value FROM '+alias+'.observations o INDEXED BY observations_value JOIN '+alias+'.devices d ON d.id=o.device_id WHERE o.test_id=? AND o.unit=? AND o.channel=? AND o.value IS NOT NULL AND (o.test_flags&63)=0 AND (o.parm_flags&7)=0 ORDER BY o.value',[test.test_id,test.unit,test.channel]),
tempStore:view.db.selectValue('PRAGMA temp_store'),sqliteMemoryBytes:store.sqlite3.wasm.heap8u().byteLength,databaseBytes:view.db.selectValue('PRAGMA main.page_count')*view.db.selectValue('PRAGMA main.page_size'),compileOptions:view.db.selectObjects('PRAGMA compile_options')};
const prepare=view.db.prepare.bind(view.db);let waferSql;
view.db.prepare=(sql,...args)=>{if(sql.startsWith('SELECT d.x,d.y,d.soft_bin'))waferSql=sql;return prepare(sql,...args);};
try{await waferMap(view,{waferKey:'stacked'});}finally{view.db.prepare=prepare;}
if(!waferSql)throw Error('Actual wafer query was not captured');
plans.wafer=view.db.selectObjects('EXPLAIN QUERY PLAN '+waferSql);plans.waferSql=waferSql;
result={plans};}catch(e){result={error:e.stack??e.message};}finally{view?.close();await store.close();}self.postMessage(result);};`;
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/qualification-plans.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(planWorker); return; }
    if (pathname === '/qualification-iterator.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(iteratorWorker); return; }
    const path = resolve(site, '.' + decodeURIComponent(pathname));
    if (!path.startsWith(site + sep)) throw new Error('Outside site');
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' })[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, checks = [], traces = [], errors = [];
let browser, page, restored;
const selection = (ids, attempts = 'all') => ({ groups: [{ name: 'Population', datasetIds: ids }], attempts });
const query = (action, selected, options = {}) => page.evaluate(({ action, selected, options }) => library.viewer(action, selected, options), { action, selected, options });
const closeTo = (actual, wanted, name) => assert.ok(Math.abs(actual - wanted) <= 1e-12 * Math.max(1, Math.abs(wanted)), `${name}: ${actual} != ${wanted}`);
function stats(actual, oracle) { assert.equal(actual.count, oracle.values.length); for (const key of ['mean', 'median', 'stdev']) closeTo(actual[key], oracle[key], key); }
async function attach(target) {
  target.on('pageerror', (error) => errors.push(error.message));
  await target.goto(`${origin}/storage.html`);
  await target.evaluate(async () => {
    const { DataLibraryClient } = await import('./data-client.js');
    window.library = new DataLibraryClient({ onProgress(event) { window.progress = event;
      if (window.cancelViewer && event.phase === 'viewer-index') { window.cancelViewer = false; library.cancel(); }
    } }); await library.open();
  });
}
async function importFile(path, target = page, method = 'importFile') {
  await target.locator('#backup-file').setInputFiles(path);
  return target.evaluate((method) => library[method](document.querySelector('#backup-file').files[0]), method);
}
async function mainTestKey(selected) { return (await query('tests', selected)).items.find((t) => t.number === 101).key; }
async function inspectPlans(selected) {
  await page.evaluate(() => library.close());
  try {
    return await page.evaluate((selected) => new Promise((resolve, reject) => { const worker = new Worker('/qualification-plans.js', { type: 'module' }); worker.onmessage = ({ data }) => { worker.terminate(); data.error ? reject(Error(data.error)) : resolve(data); }; worker.onerror = reject; worker.postMessage(selected); }), selected);
  } finally { await page.evaluate(() => library.open()); }
}
async function inspectIterator(selected, large = false) {
  await page.evaluate(() => library.close());
  try {
    return await page.evaluate((data) => new Promise((resolve, reject) => { const worker = new Worker('/qualification-iterator.js', { type: 'module' }); worker.onmessage = ({ data }) => { worker.terminate(); data.error ? reject(Error(data.error)) : resolve(data); }; worker.onerror = reject; worker.postMessage(data); }), { selection: selected, large });
  } finally { await page.evaluate(() => library.open()); }
}
try {
  browser = await chromium.launchPersistentContext(resolve(output, 'profile'), { channel, headless: true });
  page = await browser.newPage(); await attach(page);
  const imported = []; let waferForPlans;
  for (const endian of ['little', 'big']) {
    const filename = `population-${endian}.stdf`, oracle = expected.files[filename];
    const { dataset } = await importFile(resolve(fixtures, filename)); imported.push(dataset.id);
    const selected = selection([dataset.id]), key = await mainTestKey(selected);
    const analysis = await query('analyze', selected, { testKey: key, bins: 2 });
    assert.equal(analysis.population.observations, 8);
    const head1 = analysis.series.find((s) => s.head === 1), head2 = analysis.series.find((s) => s.head === 2);
    stats(head1.stats, expected.head1); assert.equal(head1.stats.excluded, 2); assert.equal(head1.stats.changingLimits, true); assert.equal(head1.stats.cpk, null);
    assert.equal(head2.stats.mean, 6); assert.equal(head2.stats.median, 6); assert.equal(head2.stats.unknown, 1);
    assert.deepEqual(head1.bins.map((b) => [b.low, b.high, b.count]), [[0, 5, 3], [5, 10, 2]]);
    const scoped = { ...selected, heads: [1], sites: [1] };
    stats((await query('analyze', scoped, { testKey: key, bins: 2 })).series[0].stats, expected.head1site1);
    const bySite = await query('analyze', selected, { testKey: key, seriesBy: 'site', includeAggregate: true });
    assert.deepEqual(bySite.series.map((s) => [s.head, s.site]).sort(), [[1, null], [1, 1], [1, 2], [2, null], [2, 1]].sort());
    const extra = (await query('tests', selected)).items.find((t) => t.number === 202);
    const devices = await query('devices', selected, { tests: [key, extra.key] });
    assert.deepEqual(devices.items.map((d) => d.id), oracle.attempts.map((d) => d.id));
    assert.deepEqual(devices.items.map((d) => d.dut_index), [1, 2, 3, 4, 5]);
    assert.deepEqual(devices.items.map((d) => d.testResults[extra.key]?.map((r) => r.value) ?? []), [[9], [], [7], [null], []]);
    const low = await query('devices', selected, { testKey: key, pick: { type: 'histogram', low: 0, high: 5, inclusiveHigh: false, seriesKeys: [head1.key] } });
    const high = await query('devices', selected, { testKey: key, pick: { type: 'histogram', low: 5, high: 10, inclusiveHigh: true, seriesKeys: [head1.key] } });
    assert.deepEqual(low.items.map((d) => d.part_id), ['A', 'B']); assert.deepEqual(high.items.map((d) => d.part_id), ['D', 'E']);
    traces.push({ endian, analysis, scoped: scoped.heads, devices: devices.items.map((d) => ({ id: d.id, tests: d.testResults })) });
    checks.push(`${endian}: independent means/medians/population deviation, invalid flags/NaN, changing limits, head/site scopes, mismatched execution matrix, histogram endpoint drilldown`);

    // These exactly representable R4 values expose fraction/floor edge rounding.
    // The fixture and expected membership do not use the application's bin code.
    const edgeDataset = (await importFile(resolve(fixtures, `histogram-edge-${endian}.stdf`))).dataset.id;
    const edgeSelection = selection([edgeDataset]), edgeTest = (await query('tests', edgeSelection)).items.find((t) => t.number === 404);
    const edgeAnalysis = await query('analyze', edgeSelection, { testKey: edgeTest.key, bins: 50 }), edgeSeries = edgeAnalysis.series[0];
    assert.equal(edgeSeries.bins[29].low, 23.5);
    assert.deepEqual(edgeSeries.bins.map((bin, index) => [index, bin.count]).filter(([, count]) => count), [[0, 1], [29, 1], [49, 1]]);
    for (const [index, parts] of [[0, ['MIN']], [28, []], [29, ['EDGE']], [49, ['MAX']]]) {
      const bin = edgeSeries.bins[index];
      const clicked = await query('devices', edgeSelection, { testKey: edgeTest.key, pick: { type: 'histogram', low: bin.low, high: bin.high, inclusiveHigh: bin.last, seriesKeys: [edgeSeries.key] } });
      assert.equal(clicked.total, bin.count); assert.deepEqual(clicked.items.map((d) => d.part_id), parts);
    }
    checks.push(`${endian}: exact 23.5 interior-edge histogram count matches drilldown for range [-20,55], 50 bins, including both endpoints`);
    const waferName = `wafer-order-${endian}.stdf`, waferOracle = expected.files[waferName];
    const waferDataset = (await importFile(resolve(fixtures, waferName))).dataset.id;
    const waferSelection = selection([waferDataset], 'current'); waferForPlans = waferSelection;
    const wafer = (await query('wafers', waferSelection)).items[0];
    const waferResult = await query('wafer', waferSelection, { waferKey: wafer.key });
    assert.equal(waferResult.attempts, 2); assert.equal(waferResult.dies.length, 1);
    const die = waferResult.dies[0];
    assert.equal(die.deviceId, waferOracle.lastDeviceId); assert.equal(die.bin, waferOracle.lastBin);
    assert.equal(die.ambiguous, true); assert.deepEqual(die.bins.slice().sort(), [3, 7]);
    assert.deepEqual([die.x, die.y, die.attempts], [12, 4, 2]);
    checks.push(`${endian}: wafer last bin/device follows PRR completion despite opposite PIR order; all ambiguous attempts retained`);
  }
  const waferPlans = await inspectPlans(waferForPlans);
  assert.ok(!waferPlans.plans.wafer.some((p) => /TEMP B-TREE/.test(p.detail)), JSON.stringify(waferPlans.plans.wafer));
  traces.push({ waferPlans: waferPlans.plans.wafer, waferSql: waferPlans.plans.waferSql });
  checks.push('actual wafer provider SQL has no temporary sort in pinned browser SQLite');
  const retest = (await importFile(resolve(fixtures, 'retest.stdf'))).dataset.id;
  const grouped = { groups: [{ name: 'Standalone', datasetIds: [imported[0]] }, { name: 'Retested group', datasetIds: [imported[0], retest] }], attempts: 'current' };
  const originalA = expected.files['population-little.stdf'].attempts[0].id;
  const a0 = await query('device', grouped, { datasetId: imported[0], deviceId: originalA, group: 0 });
  const a1 = await query('device', grouped, { datasetId: imported[0], deviceId: originalA, group: 1 });
  assert.equal(a0.attempt.retired, 0); assert.equal(a1.attempt.retired, 1);
  const key = await mainTestKey(grouped), groupedAnalysis = await query('analyze', grouped, { testKey: key });
  stats(groupedAnalysis.series.find((s) => s.group === 1 && s.head === 1).stats, expected.mergedHead1);
  assert.equal((await query('devices', grouped)).total, 10);
  assert.equal((await query('devices', { ...grouped, attempts: 'all' })).total, 11);
  const wafers = await query('wafers', grouped);
  const maps = [];
  for (const wafer of wafers.items.filter((w) => w.datasetId === imported[0])) maps.push(await query('wafer', grouped, { waferKey: wafer.key }));
  assert.deepEqual(maps.map((m) => m.attempts), [4, 3]); // Head2 has no WIR on that head.
  checks.push('same dataset in two groups preserves independent current/all attempts, group-aware device and wafer drilldown');
  for (const selected of [grouped, { ...grouped, attempts: 'all' }, { ...grouped, heads: [1], sites: [1] }]) {
    const iterator = await inspectIterator(selected);
    assert.equal(iterator.metrics.deviceRows, iterator.count); assert.ok(iterator.metrics.maxDevicePage <= 100);
  }
  checks.push('report iterator equals full interactive device rows/matrices for current/all, duplicate sources across groups and head/site scope');
  const reportDataset = (await importFile(resolve(fixtures, 'report-pages.stdf'))).dataset.id;
  const reportIterator = await inspectIterator(selection([reportDataset]), true), reportOracle = expected.files['report-pages.stdf'];
  assert.equal(reportIterator.count, reportOracle.devices);
  assert.equal(reportIterator.mainRows, reportOracle.mainObservations); assert.equal(reportIterator.extraRows, reportOracle.extraObservations);
  assert.equal(reportIterator.metrics.deviceRows, reportOracle.devices); assert.equal(reportIterator.metrics.deviceQueries, Math.ceil(reportOracle.devices / 100));
  assert.equal(reportIterator.metrics.matrixRows, reportOracle.mainObservations + reportOracle.extraObservations);
  assert.ok(reportIterator.metrics.maxDevicePage <= 100);
  assert.ok(reportIterator.metrics.queries.every((sql) => !/\bCOUNT\s*\(|\bOFFSET\b/i.test(sql)));
  assert.ok(reportIterator.metrics.vmSteps < reportOracle.devices * 200, JSON.stringify(reportIterator.metrics));
  for (const kind of ['device', 'matrix']) assert.ok(!reportIterator.metrics.plans[kind].some((p) => /TEMP B-TREE/.test(p.detail)), JSON.stringify(reportIterator.metrics.plans[kind]));
  assert.ok(reportIterator.metrics.plans.matrix.some((p) => /observations_device/.test(p.detail)));
  traces.push({ reportIterator });
  checks.push('report iterator crosses 4096 rows with 5003 devices and repeated/sparse tests; 100-row keyset batches, linear SQLite steps and no count/offset/sort');

  const cancelled = (await importFile(resolve(fixtures, 'cancel.stdf'))).dataset.id;
  await page.evaluate(() => { window.cancelViewer = true; });
  const cancel = await page.evaluate(async (selected) => { try { await library.viewer('prepare', selected); return { accepted: true }; } catch (e) { return { code: e.code, message: e.message }; } }, selection([cancelled]));
  assert.equal(cancel.code, 'CANCELLED', JSON.stringify(cancel));
  const retry = await query('prepare', selection([cancelled])); assert.equal(retry.sources[0].reused, false); assert.equal(retry.sources[0].manifest.counts.observations, 20000);
  assert.equal((await query('prepare', selection([cancelled]))).sources[0].reused, true);
  checks.push('cancelled partial cache remains unpublished and retry rebuilds complete 20,000-observation cache');

  // A genuine package produced by the finalized v1 writer, not relabeled v2 data.
  // Supply another archived v1 package with VIEWER_LEGACY_PACKAGE on fresh clones.
  const legacyPath = process.env.VIEWER_LEGACY_PACKAGE ?? resolve(root, 'results/library-1790294494268/evaluation.sdlibrary');
  const legacy = (await importFile(legacyPath, page, 'restorePackage')).dataset;
  assert.equal(legacy.manifest.parserVersion, 'retained-v1');
  assert.equal((await page.evaluate((id) => library.verifyDataset(id), legacy.id)).verified, true);
  assert.ok((await query('prepare', selection([legacy.id]))).sources[0].manifest.counts.observations >= legacy.manifest.counts.measurements);
  checks.push('existing immutable retained-v1 package restores, verifies and builds viewer cache under v2 writer');

  const defaults = (await importFile(resolve(fixtures, 'defaults-only.stdf'))).dataset;
  assert.equal(defaults.manifest.parserVersion, 'retained-v2'); assert.equal(defaults.manifest.coverage.default_only_ptr, 1);
  const defaultsPrepared = await query('prepare', selection([defaults.id])); assert.equal(defaultsPrepared.sources[0].manifest.counts.observations, 1);
  await page.evaluate(async (id) => { window.backup = await library.exportDataset(id); }, defaults.id);
  const download = page.waitForEvent('download');
  await page.evaluate(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(backup.file); a.download = 'defaults.sdlibrary'; a.click(); });
  const packagePath = resolve(output, 'defaults.sdlibrary'); await (await download).saveAs(packagePath);
  restored = await chromium.launchPersistentContext(resolve(output, 'restore-profile'), { channel, headless: true });
  const fresh = await restored.newPage(); await attach(fresh);
  const restoredDataset = (await importFile(packagePath, fresh, 'restorePackage')).dataset;
  assert.deepEqual(restoredDataset.manifest, defaults.manifest);
  assert.equal((await fresh.evaluate((id) => library.verifyDataset(id), restoredDataset.id)).verified, true);
  const restoredViewer = await fresh.evaluate((selected) => library.viewer('prepare', selected), selection([restoredDataset.id]));
  assert.equal(restoredViewer.sources[0].manifest.counts.observations, 1);
  checks.push('retained-v2 default-only source exports/restores unchanged in fresh profile and rebuilds viewer cache');

  if (process.argv.includes('--plans')) {
    const million = (await importFile(resolve(repo, '.venv/bench-data/benchmark-10000d-100t.stdf'))).dataset.id;
    const selected = selection([million], 'current');
    const built = await query('prepare', selected); assert.equal(built.sources[0].manifest.counts.observations, 1000000);
    const deep = await query('devices', selected, { offset: 5000, limit: 20 });
    assert.deepEqual(deep.items.map((d) => d.dut_index), Array.from({ length: 20 }, (_, i) => 5001 + i));
    for (const [sort, field] of [['part', 'part_id'], ['time', 'test_time'], ['head', 'head'], ['site', 'site']]) {
      const result = await query('devices', selected, { sort, offset: 4090, limit: 50 });
      assert.equal(result.items.length, 50);
      for (let i = 1; i < result.items.length; i++) {
        const a = result.items[i - 1][field], b = result.items[i][field];
        assert.ok(typeof a === 'string' ? Buffer.compare(Buffer.from(a), Buffer.from(b)) <= 0 : a <= b, sort);
      }
    }
    const result = await inspectPlans(selected);
    traces.push({ million: built.sources[0].manifest, ...result });
    assert.ok(result.plans.value.some((p) => /observations_value/.test(p.detail)));
    assert.ok(!result.plans.value.some((p) => /TEMP B-TREE.*ORDER BY/.test(p.detail)), JSON.stringify(result.plans.value));
    for (const kind of ['device', 'part', 'time', 'head', 'site']) assert.ok(!result.plans[kind].some((p) => /TEMP B-TREE/.test(p.detail)), `${kind}: ${JSON.stringify(result.plans[kind])}`);
    checks.push('actual 1M cache: value and five device cursors use indexes without sorts; deep offset>=4096 and all five sort orders complete across async yields');
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ channel, browserVersion: browser.browser().version(), checks, errors, traces }, null, 2));
  console.log(JSON.stringify({ output, checks, errors }, null, 2));
} catch (error) {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: error.stack, checks, errors, traces }, null, 2));
  throw error;
} finally { await restored?.close(); await browser?.close(); await new Promise((done) => server.close(done)); }
