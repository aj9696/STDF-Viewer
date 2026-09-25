// Independent STDF fixtures -> pinned Rust/WASM + SQLite -> real study providers.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { computeGauge } from '../site/viewer-studies.js';

const root = fileURLToPath(new URL('../', import.meta.url)), repo = resolve(root, '..'), site = resolve(root, 'site');
const channel = process.argv[2] ?? 'chrome';
if (!['chrome', 'msedge'].includes(channel)) throw Error('Choose chrome or msedge');
const output = resolve(root, 'results', `viewer-studies-${channel}-${Date.now()}`), fixtures = resolve(output, 'fixtures');
await mkdir(output, { recursive: true });
const generated = spawnSync(resolve(repo, '.venv/Scripts/python.exe'), [resolve(root, 'scripts/make-study-fixtures.py'), fixtures], { encoding: 'utf8' });
assert.equal(generated.status, 0, generated.stderr);
const expected = JSON.parse(await readFile(resolve(fixtures, 'expected.json'), 'utf8'));
const worker = `import {LibraryStore} from './library-store.js';
import {importSource} from './import-source.js';
import {openViewerContext} from './viewer-context.js';
import {listViewerTests,listDevices} from './viewer-tables.js';
import {iterateJoinedDevices} from './viewer-population.js';
import {correlateTests} from './viewer-correlations.js';
import {compareDistributions} from './viewer-distributions.js';
import {previewScreening} from './viewer-screening.js';
import {pvtStudy,gaugeStudy} from './viewer-studies.js';
const store=new LibraryStore();
self.onmessage=async({data})=>{let view;try{const context={progress(){},checkCancelled(){if(data.cancel)throw Error('Intentional cancellation');}};
if(data.action==='open'){await store.open();self.postMessage({ok:true});return;}
if(data.action==='close'){await store.close();self.postMessage({ok:true});return;}
if(data.action==='import'){const result=await importSource(store,data.file,data.file.name,context);self.postMessage({ok:true,result});return;}
view=await openViewerContext(store,data.selection,context);
let result;const actions={sort:listDevices,correlation:correlateTests,distribution:compareDistributions,screen:previewScreening,pvt:pvtStudy,gauge:gaugeStudy};
if(data.action==='tests')result=listViewerTests(view,{});else if(data.action==='joined'){result=[];for await(const d of iterateJoinedDevices(view,data.options))result.push(d);}
else if(data.action==='sortPlans'){result=[];const original=view.db.prepare.bind(view.db);view.db.prepare=(sql,...args)=>{const s=original(sql,...args),bind=s.bind.bind(s);s.bind=(values)=>{if(sql.includes('sort_value'))result.push(...view.db.selectObjects('EXPLAIN QUERY PLAN '+sql,values));return bind(values);};return s;};await listDevices(view,data.options);}
else if(data.action==='plans'){result=[];const original=view.db.prepare.bind(view.db);view.db.prepare=(sql,...args)=>{const s=original(sql,...args),bind=s.bind.bind(s);s.bind=(values)=>{if(sql.includes('observations_'))result.push({sql,plan:view.db.selectObjects('EXPLAIN QUERY PLAN '+sql,values)});return bind(values);};return s;};await previewScreening(view,data.options);}
else result=await actions[data.action](view,data.options);
self.postMessage({ok:true,result});}catch(error){self.postMessage({ok:false,error:error.stack??error.message});}finally{view?.close();}};`;
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<input id="file" type="file">'); return; }
    if (pathname === '/study-worker.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(worker); return; }
    const path = resolve(site, '.' + decodeURIComponent(pathname)); if (!path.startsWith(site + sep)) throw Error('Outside site');
    response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' })[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, checks = [], results = {};
let browser;
const close = (actual, wanted, label) => assert.ok(Math.abs(actual - wanted) < 1e-10 * Math.max(1, Math.abs(wanted)), `${label}: ${actual} != ${wanted}`);
const selection = (id, groups = 1) => ({ groups: Array.from({ length: groups }, (_, i) => ({ name: `Group ${i + 1}`, datasetIds: [id] })), attempts: 'all' });
try {
  browser = await chromium.launch({ channel, headless: true });
  const page = await browser.newPage(); await page.goto(origin);
  await page.evaluate(() => { window.worker = new Worker('/study-worker.js', { type: 'module' }); window.call = (data) => new Promise((resolve, reject) => { worker.onmessage = ({ data }) => data.ok ? resolve(data.result) : reject(Error(data.error)); worker.onerror = reject; worker.postMessage(data); }); });
  const call = (action, selected, options = {}, extra = {}) => page.evaluate((data) => window.call(data), { action, selection: selected, options, ...extra });
  await call('open');
  const importFile = async (name) => {
    await page.locator('#file').setInputFiles(resolve(fixtures, name));
    return page.evaluate(() => window.call({ action: 'import', file: document.querySelector('#file').files[0] }));
  };
  for (const endian of ['little', 'big']) {
    const imported = await importFile(`study-${endian}.stdf`), id = imported.dataset.id, selected = selection(id);
    const sortKey=(await call('tests',selected)).items.find(t=>t.number===101).key;
    const sorted=await call('sort',selected,{sortTest:sortKey,direction:'asc'});assert.deepEqual(sorted.items.map(row=>row.part_id),['A','B','C','D','F','G','H','E']);
    const reversed=await call('sort',selected,{sortTest:sortKey,direction:'desc'});assert.deepEqual(reversed.items.map(row=>row.part_id),['H','G','F','D','C','B','A','E']);
    const sortPlans=await call('sortPlans',selected,{sortTest:sortKey});assert.ok(!sortPlans.some(row=>/TEMP B-TREE/.test(row.detail)),JSON.stringify(sortPlans));checks.push(`${endian} numeric final-execution sorting, invalid-last in both directions, no temporary sort`);
    const keys = (await call('tests', selected)).items.sort((a, b) => a.number - b.number).map((test) => test.key);
    const joined = await call('joined', selected, { tests: keys });
    assert.equal(joined.length, 8); assert.equal(joined[0].values[keys[0]], 1); assert.equal(joined[4].values[keys[0]], null); assert.equal(joined[4].results[keys[0]].value, 500);
    const correlation = await call('correlation', selected, { tests: keys });
    assert.deepEqual(correlation.population, { devices: 8, complete: 5, missing: 1, invalid: 2 });
    for (const name of ['r', 'slope', 'intercept']) close(correlation.series[0].regression[name], expected.correlation[name], name);
    assert.deepEqual(correlation.series[0].points.map((point) => point.x), [1, 3, 6, 7, 8]);
    assert.equal(correlation.series[0].correlations.xz.r, -1);
    const sample = await call('correlation', selected, { tests: keys, maxPoints: 2 });
    assert.equal(sample.displayed, 2); assert.equal(sample.population.complete, 5);
    assert.deepEqual(sample, await call('correlation', selected, { tests: keys, maxPoints: 2 }));
    const duplicate = await call('correlation', selection(id, 2), { tests: keys });
    assert.equal(duplicate.population.complete, 10); assert.equal(duplicate.series.length, 2);
    const distribution = await call('distribution', selected, { testKey: keys[0], maxCdfPoints: 3 });
    const series = distribution.series[0];
    for (const name of ['count', 'mean', 'stdev', 'median']) close(series.stats[name], expected.distribution[name], name);
    for (const name of ['q1', 'q3', 'median', 'whiskerLow', 'whiskerHigh', 'outlierCount']) close(series.distribution[name], expected.distribution[name], name);
    assert.ok(series.distribution.cdf.length <= 3); assert.equal(series.distribution.cdf.at(-1).probability, 1);
    close(series.stats.cp, 200 / (6 * expected.distribution.stdev), 'Cp');
    const whatif = await call('screen', selected, { method: 'whatif', recipes: [{ testKey: keys[0], low: 0, high: 5 }] });
    assert.equal(whatif.summary.selectedPass, 4); assert.equal(whatif.summary.selectedFail, 3); assert.equal(whatif.summary.selectedUnknown, 1);
    assert.equal(whatif.summary.projectedPass, 5); assert.equal(whatif.summary.projectedFail, 2); assert.equal(whatif.summary.projectedUnknown, 1);
    assert.equal(whatif.decisions.find((decision) => decision.partId === 'H').projectedOutcome, 'unknown');
    const pvt = await call('pvt', selected, { testKey: keys[0], corners: [{ datasetId: id, process: 'TT', voltage: 1, temperature: 25 }] });
    assert.equal(pvt.corners[0].stats.count, 7); close(pvt.corners[0].stats.mean, 31 / 7, 'PVT mean'); assert.equal(pvt.corners[0].stats.median, 4);
    await assert.rejects(call('correlation', selected, { tests: [keys[0], keys[0]] }), /distinct/);
    await assert.rejects(call('joined', selected, { tests: keys }, { cancel: true }), /cancellation/);
    results[endian] = { correlation, distribution, whatif, pvt };
    checks.push(`${endian}: exact attempt joins, sparse axes, repeated/final invalid, 2D/3D covariance, deterministic bounded sampling, group isolation, exact quartiles/CDF/Cp, What-If unknown preservation, explicit PVT, cancellation`);
  }
  const patId = (await importFile('study-pat.stdf')).dataset.id, selected = selection(patId), key = (await call('tests', selected)).items.find((test) => test.number === 101).key;
  for (const fit of ['sigma', 'mad']) {
    const result = await call('screen', selected, { method: 'pat', tests: [key], fit, k: 3 });
    for (const name of ['devices', 'eligible', 'excluded', 'flagged']) assert.equal(result.summary[name], expected.pat[name]);
    assert.equal(result.tests[0].referenceCount, 31); close(result.tests[0].center, expected.pat[`${fit}Center`], `${fit} center`); close(result.tests[0].spread, expected.pat[`${fit}Spread`], `${fit} spread`);
    assert.equal(result.decisions[0].partId, 'PAT-30'); results[fit] = result;
  }
  const manual = await call('screen', selected, { method: 'pat', recipes: [{ testKey: key, low: -1, high: 1 }] });
  assert.equal(manual.summary.flagged, 1); assert.equal(manual.summary.eligible, 31);
  await assert.rejects(call('screen', selected, { method: 'pat', tests: [key], k: 0 }), /multiplier/);
  const truncated = await call('screen', selected, { method: 'whatif', recipes: [{ testKey: key, high: 0 }], limit: 1 });
  assert.equal(truncated.decisions.length, 1); assert.equal(truncated.decisionsTruncated, true);
  const plans = await call('plans', selected, { method: 'pat', tests: [key], fit: 'mad' });
  assert.ok(plans.length > 0); assert.ok(!plans.flatMap((item) => item.plan).some((row) => /TEMP B-TREE/.test(row.detail)));
  results.queryPlans = plans;
  checks.push('PAT: independent sigma/MAD oracle, known-pass-only population, invalid-final exclusion, boundary equality, preview cap and indexed no-temporary-sort MAD');
  const gaugeId = (await importFile('study-gauge.stdf')).dataset.id, gaugeSelection = selection(gaugeId), gaugeKey = (await call('tests', gaugeSelection)).items[0].key;
  const mapped = expected.gauge.rows.map(({ value, ...row }) => ({ ...row, datasetId: gaugeId }));
  const gauge = await call('gauge', gaugeSelection, { testKey: gaugeKey, rows: mapped, tolerance: 30 });
  close(gauge.mean, expected.gauge.mean, 'Gauge mean');
  for (const name of ['repeatability', 'operator', 'interaction', 'part', 'gauge', 'total']) close(gauge.components.find((item) => item.name === name).variance, expected.gauge[name], name);
  for (const [index, name] of ['ssPart', 'ssOperator', 'ssInteraction', 'ssError'].entries()) close(gauge.anova[index].ss, expected.gauge[name], name);
  close(gauge.components.find((item) => item.name === 'gauge').percentStudyVariation, 100 * Math.sqrt(3 / 103), 'Gauge percent study variation');
  assert.ok(gauge.warnings.some((warning) => /clamped/.test(warning)));
  assert.throws(() => computeGauge(expected.gauge.rows.slice(1)), /balanced/);
  assert.throws(() => computeGauge([...expected.gauge.rows, expected.gauge.rows[0]]), /more than once/);
  const constant = computeGauge(expected.gauge.rows.map((row) => ({ ...row, value: 1 })));
  assert.equal(constant.components[0].percentStudyVariation, null);
  await assert.rejects(call('gauge', gaugeSelection, { testKey: gaugeKey, rows: [...mapped.slice(0, -1), mapped[0]] }), /reused/);
  results.gauge = gauge; checks.push('Gauge: independent balanced 3×2×3 ANOVA oracle, variance clamping, study/tolerance percentages, duplicate/unbalanced/constant designs');
  await call('close');
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ channel, browser: browser.version(), checks, results }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, output }, null, 2));
} finally { await browser?.close(); await new Promise((done) => server.close(done)); }
