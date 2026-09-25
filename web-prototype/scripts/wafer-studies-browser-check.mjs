import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url)), repo = resolve(root, '..'), site = resolve(root, 'site');
const channel = process.argv[2] ?? 'chrome';
if (!['chrome', 'msedge'].includes(channel)) throw Error('Use chrome or msedge');
const output = resolve(root, 'results', `wafer-studies-${channel}-${Date.now()}`), fixtures = resolve(output, 'fixtures');
await mkdir(fixtures, { recursive: true });
const python = spawnSync(resolve(repo, '.venv/Scripts/python.exe'), [resolve(root, 'scripts/make-wafer-studies.py'), fixtures], { encoding: 'utf8' });
assert.equal(python.status, 0, python.stderr);
const expected = JSON.parse(await readFile(resolve(fixtures, 'expected.json'), 'utf8'));
const worker = `import {LibraryStore} from './library-store.js';
import {openViewerContext} from './viewer-context.js';
import {listViewerTests} from './viewer-tables.js';
import {listWafers} from './viewer-maps.js';
import {waferValues,waferGallery,spatialScreening} from './viewer-wafer-studies.js';
import {dashboard,recordSummary} from './viewer-dashboard.js';
import {analyzeTest} from './viewer-analysis.js';
import {waferValueAggregate} from './viewer-wafer-aggregate.js';
self.onmessage=async({data})=>{const store=new LibraryStore();let view;try{await store.open();
view=await openViewerContext(store,data.selection??data,{checkCancelled(){},progress(){}});
const key=data.testKey??listViewerTests(view,{}).items.find(t=>t.number===101).key,wafers=listWafers(view).items;
if(data.aggregateOnly){self.postMessage(await waferValueAggregate(view,{testKey:key}));return;}
const map=await waferValues(view,{testKey:key,waferKey:wafers[0].key,limits:{low:1,high:7}});
const bounded=await waferValues(view,{testKey:key,waferKey:wafers[0].key,bounds:{x:[-1,0],y:[-1,0]}});
const gallery=await waferGallery(view,{testKey:key,mode:'value',limit:2,sort:'yield'});
const next=await waferGallery(view,{testKey:key,mode:'value',offset:gallery.nextOffset,limit:2,sort:'yield'});
const gdbn=await spatialScreening(view,{method:'gdbn',minFailNeighbors:3});
const cd=await spatialScreening(view,{method:'cd',minCluster:3,failFraction:0.5});
const dash=await dashboard(view),summary=recordSummary(view),analysis=await analyzeTest(view,{testKey:key});
self.postMessage({key,wafers,map,bounded,gallery,next,gdbn,cd,dash,summary,analysis});
}catch(error){self.postMessage({error:error.stack??String(error)});}finally{view?.close();await store.close();}};`;
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/seed.html') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Wafer provider checks</title>'); return; }
    if (pathname === '/qualification-wafer.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(worker); return; }
    const base = pathname.startsWith('/fixtures/') ? fixtures : site, path = resolve(base, '.' + (base === fixtures ? pathname.slice(9) : pathname));
    if (!path.startsWith(base + sep)) throw Error('Outside root');
    response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.wasm': 'application/wasm', '.css': 'text/css' })[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, checks = [], results = [], errors = [];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
let browser;
try {
  browser = await chromium.launch({ channel, headless: true });
  const page = await browser.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/seed.html');
  const ids = await page.evaluate(async (names) => {
    const { DataLibraryClient } = await import('./data-client.js'); const client = new DataLibraryClient(); await client.open();
    const ids = [];
    try { for (const name of names) { const blob = await (await fetch('/fixtures/' + name)).blob(); const data = await client.importFile(new File([blob], name)); ids.push(data.dataset.id); } }
    finally { await client.close(); client.terminate(); }
    return ids;
  }, Object.keys(expected));
  const run = async (selection) => page.evaluate((selected) => new Promise((done, fail) => {
      const worker = new Worker('/qualification-wafer.js', { type: 'module' });
      worker.onmessage = ({ data }) => { worker.terminate(); data.error ? fail(Error(data.error)) : done(data); }; worker.onerror = fail; worker.postMessage(selected);
    }), selection);
  for (let i = 0; i < ids.length; i++) {
    const selection = { groups: [{ name: 'Fixture', datasetIds: [ids[i]] }], attempts: 'all', heads: null, sites: null };
    const data = await run(selection);
    const oracle = Object.values(expected)[i], name = Object.keys(expected)[i];
    assert.equal(data.wafers.length, 3);
    for (const [field, value] of Object.entries(oracle.map)) close(data.map.summary[field], value);
    assert.equal(data.map.orientation.posX, 'L'); assert.equal(data.map.orientation.posY, 'D'); assert.equal(data.map.orientation.dieAspectRatio, 0.5);
    assert.equal(data.map.omittedCoordinates, 1); assert.equal(data.map.summary.outliers, 1);
    assert.equal(data.map.cells.find((c) => c.x === 1 && c.y === 1).value, null);
    assert.equal(data.bounded.cells.length, 4); checks.push(`${name}: finite final values, missing/invalid, source orientation, bounds and inclusive limits`);
    assert.equal(data.gallery.total, 3); assert.equal(data.gallery.tiles.length, 2); assert.equal(data.next.tiles.length, 1); assert.equal(data.next.nextOffset, null);
    assert.equal(data.gallery.tiles[0].wafer.name, 'GRID'); assert.equal(data.gallery.tiles[1].wafer.name, 'ISOLATED'); checks.push(`${name}: paged wafer gallery and yield order`);
    assert.equal(data.gdbn.counts.newlyFailed, 1); assert.deepEqual(data.gdbn.decisions.map((d) => [d.x, d.y, d.waferId, d.head]), [[0, 0, oracle.wafer, 1]]);
    assert.equal(data.cd.counts.newlyFailed, 3); assert.equal(data.cd.counts.flagged, 6); checks.push(`${name}: GDBN/CD do not cross WIR or head`);
    for (const field of ['passed', 'failed', 'unknown']) assert.equal(data.dash.totals[field], oracle[field]);
    assert.equal(data.dash.totals.total, 13); close(data.dash.totals.yield, 0.75); close(data.dash.totals.timeMeanMs, 100);
    assert.equal(data.dash.files[0].lotId, 'LOT-A'); assert.equal(data.dash.files[0].elapsedSeconds, 150);
    assert.equal(data.dash.topFailTests.items[0].failureDevices, 3); assert.equal(data.dash.topFailTests.items[0].failedExecutions, 3);
    const deviceTrend = data.dash.deviceTrends[0];
    assert.equal(deviceTrend.attempts, 13); assert.equal(deviceTrend.knownOutcomes, 12); assert.equal(deviceTrend.passed, 9);
    assert.equal(deviceTrend.timePoints.length, 13); assert.ok(deviceTrend.timePoints.every((point) => point.value === 100)); close(deviceTrend.yieldPoints.at(-1).value, .75);
    const unknownYield = deviceTrend.yieldPoints.find((point) => point.outcome === 'unknown'); assert.equal(unknownYield.knownOutcomes, 9); assert.equal(unknownYield.passed, 6); close(unknownYield.value, 6 / 9);
    const headOne = data.analysis.series.find((series) => series.head === 1); assert.equal(headOne.gapRuns, 1); assert.equal(headOne.points.filter((point) => point.failed).length, 3);
    assert.ok(headOne.points.some((point) => point.segment === 1)); assert.ok(headOne.points.every((point) => point.value !== 999));
    assert.equal(data.summary.total, oracle.records);
    for (const record of data.summary.items) assert.equal(record.count, oracle.recordCounts[`${record.type}/${record.subtype}`]);
    checks.push(`${name}: scoped dashboard, timing, top fails, cumulative known-outcome yield, invalid-run trend metadata and complete record counts`); results.push(data);
  }
  const merged = await run({ groups: [{ name: 'Merged', datasetIds: ids }], attempts: 'all' });
  assert.equal(merged.dash.totals.total, 26); assert.equal(merged.dash.lots.length, 1); assert.equal(merged.dash.lots[0].total, 26);
  assert.equal(merged.dash.topFailTests.items[0].failureDevices, 6); assert.equal(merged.gdbn.counts.newlyFailed, 2);
  assert.equal(merged.dash.deviceTrends[0].knownOutcomes, 24); close(merged.dash.deviceTrends[0].yieldPoints.at(-1).value, .75);
  const mergedHead = merged.analysis.series.find((series) => series.head === 1); assert.equal(mergedHead.gapRuns, 2); assert.ok(mergedHead.points.some((point) => point.segment >= 2));
  assert.equal(merged.summary.total, Object.values(expected).reduce((n, r) => n + r.records, 0));
  checks.push('Two sources with same lot and XY retain independent source neighborhoods and aggregate counts');
  const overlapping = await run({ groups: [{ name: 'A', datasetIds: [ids[0]] }, { name: 'B', datasetIds: [ids[0]] }], attempts: 'all' });
  assert.equal(overlapping.dash.totals.total, 26); assert.equal(overlapping.dash.lots.length, 2); assert.equal(overlapping.summary.total, Object.values(expected)[0].records);
  assert.equal(overlapping.dash.topFailTests.items.length, 2); assert.equal(overlapping.gdbn.counts.newlyFailed, 2);
  checks.push('Overlapping comparison groups count independently while original record inventory deduplicates');
  const extraId = await page.evaluate(async () => {
    const { DataLibraryClient } = await import('./data-client.js'); const client = new DataLibraryClient(); await client.open();
    try { const name = 'wafer-head3-different-geometry.stdf', blob = await (await fetch('/fixtures/' + name)).blob(); return (await client.importFile(new File([blob], name))).dataset.id; }
    finally { await client.close(); client.terminate(); }
  });
  const aggregateSelection = { groups: [{ name: 'Selected wafers', datasetIds: [ids[0], extraId] }], attempts: 'all', heads: [1] };
  const aggregate = await run({ selection: aggregateSelection, testKey: results[0].key, aggregateOnly: true });
  assert.equal(aggregate.cells.length, 10); assert.equal(aggregate.contributingPositions, 11); close(aggregate.cells.find(cell => cell.x === 0 && cell.y === 0).value, 28.5);
  assert.ok(aggregate.cells.every(cell => cell.members.every(member => member.head === 1))); assert.equal(aggregate.orientation.dieAspectRatio, .5);
  assert.deepEqual(aggregate.recipe.selection.heads, [1]); assert.equal(aggregate.recipe.testKey, results[0].key); assert.equal(aggregate.sources.length, 2); assert.ok(aggregate.sources.every(source => /^[a-f0-9]{64}$/.test(source.sha256)));
  const emptyAggregate = await run({ selection: { ...aggregateSelection, heads: [99] }, testKey: results[0].key, aggregateOnly: true }); assert.equal(emptyAggregate.cells.length, 0); assert.equal(emptyAggregate.summary.valid, 0);
  await assert.rejects(run({ selection: { ...aggregateSelection, heads: null }, testKey: results[0].key, aggregateOnly: true }), /matching recorded wafer geometry/);
  checks.push('Aggregation checks geometry only for filtered contributors, excludes invalid values, retains exact means/recipe/hash provenance, and rejects included mismatches');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ channel, passed: true, checks, results }, null, 2));
  console.log(JSON.stringify({ output, checks: checks.length, passed: true }));
} finally { await browser?.close(); await new Promise((done) => server.close(done)); }
