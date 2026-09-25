// Focused lifecycle regressions. UI APIs are mocked only for deterministic races;
// CSV cancellation and paged reports use real retained SQLite datasets/workers.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const root = fileURLToPath(new URL('../', import.meta.url)), repo = resolve(root, '..'), site = resolve(root, 'site');
const channel = process.argv[2] ?? 'chrome'; if (!['chrome', 'msedge'].includes(channel)) throw Error('Use chrome or msedge');
const output = resolve(root, 'results', `viewer-lifecycle-${channel}-${Date.now()}`); await mkdir(output, { recursive: true });
function python(code, name) {
  return writeFile(resolve(output, name), code).then(() => {
    const p = spawnSync(resolve(repo, '.venv/Scripts/python.exe'), [resolve(output, name), output, root], { encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr); return p.stdout;
  });
}
await python(String.raw`
import importlib.util,pathlib,sys
p=pathlib.Path(sys.argv[1]);module=importlib.util.spec_from_file_location('population',pathlib.Path(sys.argv[2])/'scripts/make-viewer-populations.py');m=importlib.util.module_from_spec(module);module.loader.exec_module(m)
s=m.Source()
for i in range(253):
 a=s.begin(1,1,f'PART-{i:04d}');s.ptr(a,101,float(i));s.end(a)
for i in range(257):s.record(50,30,s.cn(f'Datalog {i:04d}'))
s.save(p/'pages.stdf')
`, 'fixture.py');
const worker = String.raw`
import {LibraryStore} from './library-store.js';
import {runOperation} from './library-operations.js';
import {runViewerReport} from './viewer-report.js';
import {runViewerDownloads} from './viewer-downloads.js';
import {runViewerQuery} from './viewer-queries.js';
self.onmessage=async()=>{
 const store=new LibraryStore();let cancelled=false,writes=0;
 const context={checkCancelled(){if(cancelled)throw Object.assign(Error('Injected last-page cancellation'),{code:'CANCELLED'});},progress(){}};
 const original=FileSystemWritableFileStream.prototype.write;
 try{
  await store.open();const imported=await runOperation(store,{type:'importFile',file:new File([await(await fetch('/pages.stdf')).blob()],'pages.stdf')},context);
  const id=imported.dataset.id,selection={groups:[{name:'Pages',datasetIds:[id]}],attempts:'all'};
  const tests=(await runViewerQuery(store,{action:'tests',selection},context)).items.map(t=>t.key);
  const report=await runViewerReport(store,{selection,options:{sections:['DUT Summary','GDR & DTR Summary'],tests}},context);
  await fetch('/report.xlsx',{method:'POST',body:report.file});
  await runViewerReport(store,{action:'release',token:report.token},context);await runViewerReport(store,{action:'release',token:report.token},context);
  FileSystemWritableFileStream.prototype.write=async function(bytes){await original.call(this,bytes);if(++writes===2)cancelled=true;};
  let error,completed=false;
  try{await runViewerReport(store,{selection,options:{kind:'deviceCsv',device:{datasetId:id,deviceId:5,group:0}}},context);completed=true;}catch(e){error={code:e.code,message:e.message};}
  finally{FileSystemWritableFileStream.prototype.write=original;cancelled=false;}
  const inventory=await runViewerDownloads({action:'list'},context);
  const token=crypto.randomUUID()+'.xlsx';await runViewerDownloads({action:'release',kind:'report',token},context);await runViewerDownloads({action:'release',kind:'report',token},context);
  const verified=await runOperation(store,{type:'verifyDataset',datasetId:id},context);
  self.postMessage({ok:true,error,completed,writes,inventory,verified,sheets:report.report.sheets});
 }catch(e){self.postMessage({ok:false,error:{message:e.message,stack:e.stack}});}
 finally{FileSystemWritableFileStream.prototype.write=original;await store.close();}
};`;
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/report.xlsx' && request.method === 'POST') { await pipeline(request, createWriteStream(resolve(output, 'report.xlsx'))); response.end('ok'); return; }
    if (pathname === '/__worker.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(worker); return; }
    if (pathname === '/__test.html') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Targeted lifecycle checks</title><input id="viewer-session-file" type="file"><footer class="viewer-footer"></footer>'); return; }
    const base = pathname === '/pages.stdf' ? output : site, file = resolve(base, '.' + decodeURIComponent(pathname));
    if (!file.startsWith(base + sep)) throw Error('Outside root');
    response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' })[extname(file)] ?? 'application/octet-stream'); response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done)); const origin = `http://127.0.0.1:${server.address().port}`;
let browser; const errors = [], checks = [];
try {
  browser = await chromium.launchPersistentContext(resolve(output, 'profile'), { channel, headless: true, acceptDownloads: true });
  const page = await browser.newPage(); page.on('pageerror', (e) => errors.push(e.message)); await page.goto(origin + '/__test.html');
  const real = await page.evaluate(() => new Promise((resolve, reject) => {
    const worker = new Worker('./__worker.js', { type: 'module' }); worker.onmessage = ({ data }) => { worker.terminate(); resolve(data); }; worker.onerror = (e) => reject(Error(e.message)); worker.postMessage({});
  }));
  assert.equal(real.ok, true, JSON.stringify(real.error)); assert.equal(real.completed, false); assert.equal(real.error.code, 'CANCELLED'); assert.equal(real.writes, 2); assert.equal(real.inventory.total, 0); assert.equal(real.verified.verified, true);
  const inspected = JSON.parse(await python(String.raw`
import json,pathlib,sys,zipfile,xml.etree.ElementTree as E
p=pathlib.Path(sys.argv[1]);n={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(p/'report.xlsx') as z:
 assert z.testzip() is None
 dev=E.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('s:sheetData/s:row',n)[1:]
 log=E.fromstring(z.read('xl/worksheets/sheet2.xml')).findall('s:sheetData/s:row',n)[1:]
 assert len(dev)==253 and len(log)==257
 for i,row in enumerate(dev):assert row.find(f"s:c[@r='F{i+2}']/s:is/s:t",n).text==f'PART-{i:04d}'
 for i,row in enumerate(log):assert json.loads(row.find(f"s:c[@r='I{i+2}']/s:is/s:t",n).text)['TEXT_DAT']==f'Datalog {i:04d}'
print(json.dumps({'devices':len(dev),'datalog':len(log)}))
`, 'inspect.py'));
  checks.push('Real reports stream 253 ordered devices and257 DTR records across internal pages without gaps; CSV cancellation during its final single-row page aborts publication; releases are idempotent and source remains verified');
  await page.evaluate(async () => {
    const { installViewerActions } = await import('./viewer-actions.js');
    window.cancelled=false;window.reportCalls=0;window.revoked=[];window.items=[];window.pendingGet=false;
    const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=(url)=>{window.revoked.push(url);revoke(url);};
    window.state={selection:{groups:[{name:'Group',datasetIds:['11111111-1111-4111-8111-111111111111']}]},tests:['test'],settings:{},seriesBy:'aggregate'};
    const workspaceToken='22222222-2222-4222-8222-222222222222.sdworkspace',file=new File(['test workspace'],'workspace.sdworkspace');
    window.client={async viewerReport(){window.reportCalls++;throw Error('Report should not start after cancellation');},async viewerTransfer(action){if(action==='saveSession'){window.items=[{kind:'workspace',token:workspaceToken,bytes:file.size}];return{file,filename:'workspace.sdworkspace',token:workspaceToken};}window.items=[];return{released:true};},async request(type,message){
      if(message.action==='list')return{items:window.items,total:window.items.length,nextOffset:null};
      if(message.action==='release'){window.items=[];return{released:true};}
      if(window.pendingGet)return new Promise((resolve)=>{window.finishGet=()=>{window.pendingGet=false;resolve({file,filename:workspaceToken});};});
      return{file,filename:workspaceToken};
    }};
    installViewerActions({installActions(handlers){window.actions=handlers;},client:()=>window.client,getDatasets:()=>[],checkCancelled(){if(window.cancelled)throw Object.assign(Error('Cancelled between worker requests'),{code:'CANCELLED'});},async query(){return{test:{number:1,name:'Test',family:10,unit:'V'},series:[]};}});
    const toBlob=HTMLCanvasElement.prototype.toBlob;window.restoreCanvas=()=>{HTMLCanvasElement.prototype.toBlob=toBlob;};
    HTMLCanvasElement.prototype.toBlob=function(callback,...args){window.captureReady=true;window.finishCapture=()=>toBlob.call(this,callback,...args);};
    window.exportOutcome=null;window.exportTask=window.actions.export(window.state).then(()=>{window.exportOutcome='completed';},e=>{window.exportOutcome=e.code;});
  });
  await page.locator('#viewer-export-dialog').waitFor({ state: 'visible' }); await page.getByRole('button', { name: 'Generate export', exact: true }).click();
  await page.waitForFunction(() => window.captureReady); await page.evaluate(() => { window.cancelled=true;window.finishCapture(); });
  await page.waitForFunction(() => window.exportOutcome !== null); assert.equal(await page.evaluate(() => window.exportOutcome), 'CANCELLED'); assert.equal(await page.evaluate(() => window.reportCalls), 0); assert.equal(await page.locator('.viewer-chart').count(), 0);
  checks.push('Test-only canvas gate proves cancellation between worker requests stops PNG capture before report generation and removes its hidden chart');
  await page.evaluate(async () => { window.restoreCanvas();window.cancelled=false;await window.actions.saveSession(window.state);window.manageDone=false;window.manageTask=window.actions.manageDownloads().then(()=>{window.manageDone=true;}); });
  await page.locator('#viewer-download-dialog').waitFor({ state: 'visible' }); await page.locator('#viewer-download-dialog').getByRole('button', { name: 'Download', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('#viewer-downloads a[download]').length===2);
  await page.locator('#viewer-download-dialog').getByRole('button', { name: 'Remove temporary copy', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('#viewer-downloads a[download]').length===0);
  assert.equal(await page.evaluate(() => window.revoked.length), 2);
  await page.locator('#viewer-download-dialog').getByRole('button', { name: 'Close', exact: true }).click(); await page.waitForFunction(() => window.manageDone);
  await page.evaluate(async () => { await window.actions.saveSession(window.state);window.pendingGet=true;window.manageDone=false;window.manageTask=window.actions.manageDownloads().then(()=>{window.manageDone=true;}); });
  await page.locator('#viewer-download-dialog').waitFor({ state: 'visible' }); await page.locator('#viewer-download-dialog').getByRole('button', { name: 'Download', exact: true }).click();
  await page.waitForFunction(() => typeof window.finishGet==='function'); await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.manageDone), false); assert.equal(await page.locator('#viewer-download-dialog').evaluate((d) => d.open), true);
  await page.evaluate(() => window.finishGet()); await page.waitForFunction(() => window.manageDone); assert.equal(await page.locator('#viewer-download-dialog').count(), 0);
  checks.push('Test-only inventory API proves deleting one token revokes all duplicate Blob URLs and removes stale rows; Escape waits for pending download request before completing modal action');
  assert.deepEqual(errors, []); await writeFile(resolve(output, 'results.json'), JSON.stringify({ channel, checks, real, inspected, errors }, null, 2)); console.log(JSON.stringify({ output, checks }));
} catch(error) { await writeFile(resolve(output,'failure.json'),JSON.stringify({error:error.stack,checks,errors},null,2));throw error; }
finally { await browser?.close();await new Promise((done)=>server.close(done)); }
