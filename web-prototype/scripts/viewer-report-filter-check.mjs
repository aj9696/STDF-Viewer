// Real parser/SQLite/worker and workbook checks for ephemeral report filters.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createWriteStream } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url)), repo = resolve(root, '..'), site = resolve(root, 'site');
const channel = process.argv[2] ?? 'chrome';
if (!['chrome', 'msedge'].includes(channel)) throw Error('Choose chrome or msedge');
const output = resolve(root, 'results', `viewer-report-filter-${channel}-${Date.now()}`), fixtures = resolve(output, 'fixtures');
await mkdir(output, { recursive: true });
const python = (file, args = []) => {
  const result = spawnSync(resolve(repo, '.venv/Scripts/python.exe'), [file, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout;
};
python(resolve(root, 'scripts/make-report-filter-fixtures.py'), [fixtures]);
const worker = `import {LibraryStore} from './library-store.js';
import {importSource} from './import-source.js';
import {runViewerQuery} from './viewer-queries.js';
import {runViewerReport} from './viewer-report.js';
const store=new LibraryStore();
self.onmessage=async({data})=>{try{
const context={progress(){},checkCancelled(){}};
if(data.action==='open'){await store.open();self.postMessage({ok:true});return;}
if(data.action==='close'){await store.close();self.postMessage({ok:true});return;}
if(data.action==='import'){const result=await importSource(store,data.file,data.file.name,context);self.postMessage({ok:true,result});return;}
if(data.action==='report'){
const result=await runViewerReport(store,{selection:data.selection,options:data.options},context);
await fetch('/artifact/'+data.filename,{method:'POST',body:result.file});
await runViewerReport(store,{action:'release',token:result.token},context);self.postMessage({ok:true,result:result.report});return;}
const result=await runViewerQuery(store,data,context);self.postMessage({ok:true,result});
}catch(error){self.postMessage({ok:false,error:error.stack??error.message,code:error.code});}};`;
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (/^\/artifact\/[a-z-]+\.xlsx$/.test(pathname) && request.method === 'POST') {
      await pipeline(request, createWriteStream(resolve(output, pathname.slice('/artifact/'.length)))); response.end('ok'); return;
    }
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<input id="file" type="file">'); return; }
    if (pathname === '/filter-worker.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(worker); return; }
    const path = resolve(site, '.' + decodeURIComponent(pathname)); if (!path.startsWith(site + sep)) throw Error('Outside site');
    response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' })[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, checks = [], pageErrors = [];
let browser;
try {
  browser = await chromium.launch({ channel, headless: true });
  const page = await browser.newPage(); page.on('pageerror', error => pageErrors.push(error.message)); await page.goto(origin);
  await page.evaluate(() => {
    window.worker = new Worker('/filter-worker.js', { type: 'module' });
    window.call = data => new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => data.ok ? resolve(data.result) : reject(Object.assign(Error(data.error), { code: data.code }));
      worker.onerror = reject; worker.postMessage(data);
    });
  });
  const call = (action, selection, options = {}, extra = {}) => page.evaluate(data => window.call(data), { action, selection, options, ...extra });
  const reject = (action, selection, options) => page.evaluate(async data => { try { await window.call(data); return null; } catch(error) { return error.code; } }, { action, selection, options });
  await call('open'); const ids = {};
  for (const name of ['base', 'retest', 'only-fail']) {
    await page.locator('#file').setInputFiles(resolve(fixtures, name + '.stdf'));
    ids[name] = (await page.evaluate(() => window.call({ action: 'import', file: document.querySelector('#file').files[0] }))).dataset.id;
  }
  const selected = attempts => ({ groups: [{ name: 'Production', datasetIds: [ids.base, ids.retest] }], attempts });
  const testKey = (await call('tests', selected('current'))).items[0].key;
  for (const attempts of ['current', 'all']) for (const mode of ['all', 'non-failed', 'pass']) {
    const selection = selected(attempts), options = { deviceOutcomes: mode };
    const devices = await call('devices', selection, options), overview = await call('overview', selection, options);
    const expected = attempts === 'current' ? { all: 8, 'non-failed': 6, pass: 3 } : { all: 9, 'non-failed': 7, pass: 4 };
    assert.equal(devices.total, expected[mode]);
    const group = overview.groups[0]; assert.equal(group.passed + group.failed + group.unknown, devices.total);
    assert.equal(group.failed, mode === 'all' ? 2 : 0); assert.equal(group.unknown, mode === 'pass' ? 0 : 3);
    if (attempts === 'current' && mode !== 'all') assert.ok(!devices.items.some(row => row.part_id === 'A'), 'Later failed retest must not revive the retired pass');
    const analysis = await call('analyze', selection, { ...options, testKey, bins: 5 });
    assert.equal(analysis.series.reduce((sum, series) => sum + series.stats.count, 0), devices.total);
    assert.equal(analysis.series.reduce((sum, series) => sum + series.stats.fail, 0), 1, 'Retained passing device keeps its failed test execution');
    assert.equal(analysis.series.reduce((sum, series) => sum + series.bins.reduce((n, bin) => n + bin.count, 0), 0), devices.total);
    const summaries = await call('testSummaries', selection, { ...options, tests: [testKey] });
    assert.deepEqual(summaries.items[0].series.map(series => series.stats), analysis.series.map(series => series.stats));
    const bins = await call('bins', selection, options); assert.equal(bins.series.reduce((sum, series) => sum + series.total, 0), devices.total);
    const wafers = await call('wafers', selection, options); let waferAttempts = 0;
    for (const wafer of wafers.items) waferAttempts += (await call('wafer', selection, { ...options, waferKey: wafer.key })).attempts;
    // This fixture has one wafer per source on head 1. Head 2 has no wafer context.
    assert.equal(waferAttempts, devices.items.filter(row => row.head === 1).length);
    const dashboard = await call('advanced', selection, { ...options, kind: 'dashboard', topFailures: false, waferPreview: false });
    assert.equal(dashboard.totals.total, devices.total); assert.equal(dashboard.deviceTrends[0].attempts, devices.total);
    checks.push(`${attempts}/${mode}: overview, DUTs, exact statistics/median, histogram, bins, wafer and device trends agree`);
  }
  const selection = { ...selected('current'), heads: [1], sites: [1] }, options = { deviceOutcomes: 'non-failed' };
  const analysis = await call('analyze', selection, { ...options, testKey });
  assert.equal(analysis.series[0].stats.mean, 5); assert.equal(analysis.series[0].stats.median, 5); assert.equal(analysis.series[0].stats.count, 4);
  const notes = await call('records', selection, { ...options, family: 'datalog' });
  assert.equal(notes.total, 13); assert.ok(notes.items.every(record => record.device_id === null));
  assert.ok(notes.items.some(record => record.fields.TEXT_DAT === 'DEVICE FAIL'), 'Unassociated datalog context must not be guessed as an owned device record');
  const headers = await call('records', selection, { ...options, family: 'headers', query: 'PART_CNT' });
  assert.deepEqual(headers.items.map(row => row.fields.GOOD_CNT), [1234, 1234]);
  const pat = await call('advanced', selection, { ...options, kind: 'screening', method: 'pat', tests: [testKey], fit: 'mad', k: 3, limit: 100 });
  assert.equal(pat.recipe.selection.deviceOutcomes, 'non-failed'); assert.equal(pat.summary.devices, 4);
  checks.push('Head/site scope, retained unassociated datalog context/original PCR facts and PAT population');
  const empty = { groups: [{ name: 'Fail only', datasetIds: [ids['only-fail']] }], attempts: 'current' };
  assert.equal((await call('devices', empty, options)).total, 0);
  assert.equal((await call('overview', empty, options)).groups[0].yield, null);
  assert.equal((await call('analyze', empty, { ...options, testKey })).series.length, 0);
  for (const invalid of ['fail', '', null, {}, 0]) assert.equal(await reject('analyze', selection, { deviceOutcomes: invalid, testKey }), 'INVALID_REQUEST');
  for (const action of ['device', 'record', 'rawRecords']) assert.equal(await reject(action, selection, options), 'INVALID_REQUEST');
  for (const kind of ['records', 'device', 'deviceCsv']) assert.equal(await reject('report', selection, { ...options, kind }), 'INVALID_REQUEST');
  assert.equal((await call('devices', selection)).total, 6, 'Filtered requests do not modify subsequent workspace queries');
  checks.push('Empty population is unavailable yield; malformed/unsupported filters reject; original selection remains unchanged');
  for (const mode of ['all', 'non-failed', 'pass']) await call('report', selection, { kind: 'report', deviceOutcomes: mode, tests: [testKey] }, { filename: mode + '.xlsx' });
  await call('report', selection, { ...options, tests: [testKey], sections: ['DUT Summary', 'Test Statistics'] }, { filename: 'no-info.xlsx' });
  await call('report', empty, { ...options, tests: [testKey], sections: ['DUT Summary', 'Test Statistics'] }, { filename: 'empty.xlsx' });
  await call('close');
  const inspector = resolve(output, 'inspect.py');
  await writeFile(inspector, String.raw`
import json,pathlib,sys,zipfile,xml.etree.ElementTree as E
p=pathlib.Path(sys.argv[1]);ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def book(name):
 with zipfile.ZipFile(p/name) as z:
  assert z.testzip() is None
  names=[n.attrib['name'] for n in E.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet',ns)]
  sheets={}
  for i,name in enumerate(names):
   rows=[]
   for row in E.fromstring(z.read(f'xl/worksheets/sheet{i+1}.xml')).findall('s:sheetData/s:row',ns):
    values=[]
    for cell in row.findall('s:c',ns):
     value=cell.find('s:is/s:t' if cell.attrib.get('t')=='inlineStr' else 's:v',ns)
     values.append(value.text if value is not None else None)
    rows.append(values)
   sheets[name]=rows
  return sheets
for mode,count in [('all',6),('non-failed',4),('pass',1)]:
 sheets=book(mode+'.xlsx')
 assert len(sheets['DUT Summary'])-1==count,(mode,sheets['DUT Summary'])
 stats=sheets['Test Statistics'][1]
 assert int(stats[6])==count and int(stats[10])==1,(mode,stats)
 assert sum(int(row[8]) for row in sheets['Histogram'][1:])==count
 assert sum(int(row[4]) for row in sheets['Bin Chart'][1:] if row[0]=='soft')==count
 info=json.dumps(sheets['File Info'])
 assert 'Device outcome filter' in info and 'original files' in info
 if mode!='all':
  assert not any(row[5] in ['A','FAIL'] for row in sheets['DUT Summary'][1:])
  assert 'do not represent the original production yield' in info
  assert len(sheets['GDR & DTR Summary'])-1==13
scoped=book('no-info.xlsx')
assert list(scoped)==['Report scope','DUT Summary','Test Statistics']
assert 'Failed device attempts excluded' in json.dumps(scoped['Report scope'])
empty=book('empty.xlsx')
assert len(empty['DUT Summary'])==1 and len(empty['Test Statistics'])==1
print(json.dumps({'workbooks':5,'verified':True}))
`);
  const workbooks = JSON.parse(python(inspector, [output]));
  checks.push('Five real XLSX workbooks: filtered rows/statistics/histograms/bins/notes and mandatory scope even without File Info; empty headers only');
  assert.deepEqual(pageErrors, []);
  const result = { channel, browserVersion: browser.version(), passed: true, checks, workbooks, pageErrors };
  await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
