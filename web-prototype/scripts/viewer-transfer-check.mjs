import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url)), repository = resolve(root, '..'), site = resolve(root, 'site');
const channel = process.argv[2] ?? 'chrome';
if (!['chrome', 'msedge'].includes(channel)) throw Error('Use chrome or msedge');
const output = resolve(root, 'results', `viewer-transfer-${channel}-${Date.now()}`), fixtures = resolve(output, 'fixtures');
await mkdir(fixtures, { recursive: true });
function python(args) {
  const result = spawnSync(resolve(repository, '.venv/Scripts/python.exe'), args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw Error(result.stderr || result.error?.message || 'Python check failed');
  return result.stdout;
}
python([resolve(root, 'scripts/make-library-fixtures.py'), fixtures]);
await writeFile(resolve(fixtures, 'mixed.stdf'), await readFile(resolve(repository, '.venv/viewer-fixtures/golden-little.stdf')));
const worker = String.raw`
import { LibraryStore } from './library-store.js';
import { runOperation } from './library-operations.js';
import { runViewerTransfer, cleanupViewerTransfers } from './viewer-transfer.js';
import { writeWorkbook } from './xlsx-writer.js';
let store, cancelled=false;
const list = async () => { const root=await navigator.storage.getDirectory(), names=[]; for(const name of ['semidata-viewer-exports-v1','semidata-exports-v1']) { const dir=await root.getDirectoryHandle(name,{create:true}); for await (const [file] of dir.entries()) names.push(name+'/'+file); } return names; };
const context={checkCancelled(){if(cancelled)throw Object.assign(Error('Test cancellation'),{code:'CANCELLED'});},progress(p){self.postMessage({progress:p});}};
async function input(name){return new File([await(await fetch('/fixture/'+name)).blob()],name);}
async function upload(name,file){const result=await fetch('/artifact/'+name,{method:'POST',body:file});if(!result.ok)throw Error('Artifact upload failed');}
self.onmessage=async({data})=>{
 if(data.type==='cancel'){cancelled=true;return;}
 cancelled=false;
 try {
  let result;
  if(data.type==='seed'){
    store??=new LibraryStore();await store.open();const ids=[];
    for(const name of ['golden-little.stdf','golden-big.stdf'])ids.push((await runOperation(store,{type:'importFile',file:await input(name)},context)).dataset.id);
    result={ids};
  }else if(data.type==='save'){
    const ids=data.ids;
    const state={selection:{groups:[{name:'Merged <A>',datasetIds:ids},{name:'Compare',datasetIds:[ids[0]]}],heads:[1,2],sites:null,attempts:'all'},settings:{bins:37,title:'=SUM(A1:A3)\n<raw>'},tests:[JSON.stringify([10,77,'Name','V','','resolved']),JSON.stringify([10,88,'','','',ids[1]+':7:unresolved-omitted'])]};
    if(data.invalidState)state.tests.push(JSON.stringify([10,99,'','','',crypto.randomUUID()+':1:unresolved-omitted']));
    if(data.tooManyTests)state.tests=Array.from({length:13},(_,i)=>JSON.stringify([10,i,'','','','resolved']));
    const hooks=data.cancelAfterFirst?{...context,progress(p){context.progress(p);if(p.phase==='save-workspace')cancelled=true;}}:context;
    const saved=await runViewerTransfer(store,{action:'saveSession',state},hooks);
    await upload('workspace.sdworkspace',saved.file);await runViewerTransfer(store,{action:'release',token:saved.token},context);await runViewerTransfer(store,{action:'release',token:saved.token},context);
    result={state,bytes:saved.bytes,sourceCount:saved.sourceCount,leftovers:await list()};
  }else if(data.type==='restore'){
    store??=new LibraryStore();await store.open();
    const hooks=data.cancelAfterFirst?{...context,progress(p){context.progress(p);if(p.phase==='restore-workspace')cancelled=true;}}:context;
    result=await runViewerTransfer(store,{action:'restoreSession',file:await input(data.name)},hooks);
    result.leftovers=await list();result.datasets=store.list('datasets').items;
  }else if(data.type==='bad-token'){
    result=await runViewerTransfer(store,{action:'release',token:'../../source.stdf'},context);
  }else if(data.type==='orphan'){
    const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('semidata-viewer-exports-v1',{create:true});
    const name=crypto.randomUUID()+'.sdworkspace';await dir.getFileHandle(name,{create:true});await dir.getFileHandle('leave-me.txt',{create:true});
    result=await cleanupViewerTransfers();result.leftovers=await list();await dir.removeEntry('leave-me.txt');
  }else if(data.type==='xlsx'){
    const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('xlsx-test',{create:true});
    const handle=await dir.getFileHandle(data.name+'.xlsx',{create:true});const fileWritable=await handle.createWritable();
    let aborted=false,closed=false,maxWrite=0,finished=false;
    const writable={async write(bytes){maxWrite=Math.max(maxWrite,bytes.byteLength);if(data.fault==='io')throw new DOMException('Injected full storage','QuotaExceededError');await fileWritable.write(bytes);},async close(){closed=true;await fileWritable.close();},async abort(error){aborted=true;await fileWritable.abort(error);}};
    async function* rows(){try{for(let i=0;i<(data.count??70000);i++){
      if(data.fault==='number')yield[Infinity];else if(data.fault==='columns')yield Array(16385).fill(1);else if(data.fault==='text')yield['x'.repeat(32768)];else if(data.fault==='row')yield Array(40).fill('x'.repeat(30000));
      else if(data.split)yield[i];else yield i===0?[i,'=1+1','+CMD','-1+2','@SUM(A1)','line1\nline2 & < > "',true,null,-0,'_x000A_','a\\b','bad\\u000B'.replace('\\u000B','\u000B'),'💾','CR\rLF\r\n']: [i,'row '+i];
    }}finally{finished=true;}}
    const png=new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'});
    try{
      result=await writeWorkbook({writable,sheets:[{name:"'Unsafe:/[]*?\\\\name'",headers:['number','value'],rows:rows(),autoFilter:true},{name:"'Unsafe:/[]*?\\\\name'",rows:[]}],images:data.fault?[]:[{sheet:0,blob:png,anchor:{column:2,row:3,width:320,height:180}}],context});
      const file=await handle.getFile();await upload(data.name+'.xlsx',file);result={...result,aborted,closed,maxWrite,finished};
    }catch(error){result={error:{code:error.code,message:error.message},aborted,closed,maxWrite,finished,size:(await handle.getFile()).size};}
    await dir.removeEntry(data.name+'.xlsx');
  }else if(data.type==='close'){await store?.close();store=null;result={closed:true};}
  else throw Error('Unknown test action');
  self.postMessage({ok:true,result});
 }catch(error){self.postMessage({ok:false,error:{code:error.code,message:error.message,completedDatasetIds:error.completedDatasetIds},leftovers:await list(),datasets:store?.list('datasets').items??[]});}
};`;
const generator = String.raw`
import io,json,pathlib,struct,sys,zipfile
p=pathlib.Path(sys.argv[1]); src=p/'workspace.sdworkspace'
with zipfile.ZipFile(src) as z:
 assert z.testzip() is None
 parts={n:z.read(n) for n in z.namelist()}
 assert len(parts)==3 and all(i.compress_type==0 for i in z.infolist())
m=json.loads(parts['manifest.json']);assert m['format']=='semidata-workspace' and m['version']==1 and len(m['sources'])==2
for s in m['sources']:
 b=parts[s['member']];assert b[:8]==b'SDPKG001'; h=json.loads(b[12:12+struct.unpack_from('<I',b,8)[0]])
 assert h['manifest']['source']['sha256']==s['sha256']
def save(name,items,method=0):
 with zipfile.ZipFile(p/name,'w',compression=method) as z:
  for n,b in items.items():z.writestr(n,b)
save('deflated.sdworkspace',parts,8)
bad=dict(parts);bad['unexpected.txt']=b'extra';save('extra.sdworkspace',bad)
bad=dict(parts);bad['../manifest.json']=bad.pop('manifest.json');save('traversal.sdworkspace',bad)
bad=dict(parts);bad['manifest.json']=b'x'*131073;save('large-manifest.sdworkspace',bad)
bad=dict(parts);mm=json.loads(parts['manifest.json']);mm['sources'][0]['sha256']='0'*64;bad['manifest.json']=json.dumps(mm).encode();save('wrong-hash.sdworkspace',bad)
bad=dict(parts);mm=json.loads(parts['manifest.json']);mm['state']['settings']['__proto__']={'polluted':True};bad['manifest.json']=json.dumps(mm).encode();save('prototype.sdworkspace',bad)
for member,name in [(m['sources'][0]['member'],'corrupt-first.sdworkspace'),(m['sources'][1]['member'],'corrupt-second.sdworkspace')]:
 bad=dict(parts);b=bytearray(bad[member]);n=struct.unpack_from('<I',b,8)[0];b[12+n+20]^=1;bad[member]=b;save(name,bad)
(p/'native.db').write_bytes(b'SQLite format 3\x00'+bytes(100))
save('crc-base.sdworkspace',parts)
bad=bytearray((p/'crc-base.sdworkspace').read_bytes());start=0;changed=False
while True:
 pos=bad.find(b'PK\x01\x02',start)
 if pos<0:break
 size=struct.unpack_from('<H',bad,pos+28)[0];name=bad[pos+46:pos+46+size]
 if name==b'manifest.json':
  crc=struct.unpack_from('<I',bad,pos+16)[0]^1;struct.pack_into('<I',bad,pos+16,crc)
  local=struct.unpack_from('<I',bad,pos+42)[0];struct.pack_into('<I',bad,local+14,crc);changed=True;break
 start=pos+46+size
assert changed,'Missing central directory'
(p/'zip-crc.sdworkspace').write_bytes(bad)
print(json.dumps({'workspaceEntries':list(parts),'sources':len(m['sources'])}))
`;
const inspect = String.raw`
import json,pathlib,sys,zipfile,xml.etree.ElementTree as E
p=pathlib.Path(sys.argv[1]);ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
checks=[]
for name in ['rows.xlsx','split.xlsx']:
 with zipfile.ZipFile(p/name) as z:
  assert z.testzip() is None
  for n in z.namelist():
   if n.endswith('.xml') or n.endswith('.rels'):
    if not n.startswith('xl/worksheets/sheet'):E.fromstring(z.read(n))
  wb=E.fromstring(z.read('xl/workbook.xml')); names=[n.attrib['name'] for n in wb.findall('s:sheets/s:sheet',ns)]
  assert len({n.lower() for n in names})==len(names) and all(len(n)<=31 and not any(c in n for c in '[]:*?/\\') for n in names)
  assert z.read('xl/media/image1.png').startswith(b'\x89PNG\r\n\x1a\n')
  drawing=E.fromstring(z.read('xl/drawings/drawing1.xml'));assert '3048000' in z.read('xl/drawings/drawing1.xml').decode()
  rows=[];first=[];last=[]
  for index in range(len(names)):
   count=0;firstvalue=None;lastvalue=None
   with z.open(f'xl/worksheets/sheet{index+1}.xml') as f:
    for event,node in E.iterparse(f,events=['end']):
     if node.tag.endswith('}row'):
      count+=1
      if count==2:firstvalue=node.find('s:c/s:v',ns).text
      if count>1:lastvalue=node.find('s:c/s:v',ns).text
      if name=='rows.xlsx' and index==0 and count==2:
       texts=[n.text for n in node.findall('s:c/s:is/s:t',ns)]
       assert '=1+1' in texts and '@SUM(A1)' in texts and 'line1\nline2 & < > "' in texts and '_x005F_x000A_' in texts and 'bad_x000B_' in texts and '💾' in texts and 'CR\rLF\r\n' in texts
       assert not node.findall('s:c/s:f',ns)
      node.clear()
   rows.append(count);first.append(firstvalue);last.append(lastvalue)
  if name=='rows.xlsx':assert rows==[70001,0] and first[0]=='0' and last[0]=='69999'
  else:assert rows==[1048576,5,0] and first[:2]==['0','1048575'] and last[:2]==['1048574','1048578']
  checks.append({'file':name,'rows':rows,'names':names,'entries':len(z.namelist())})
print(json.dumps(checks))
`;
const inspectReports = String.raw`
import json,pathlib,sys,zipfile,xml.etree.ElementTree as E
p=pathlib.Path(sys.argv[1]);ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(p/'integrated-report.xlsx') as z:
 assert z.testzip() is None
 names=[n.attrib['name'] for n in E.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet',ns)]
 assert names==['File Info','DUT Summary','Trend Chart','Histogram','Bin Chart','Wafer Map','Test Statistics','GDR & DTR Summary']
 assert z.read('xl/media/image1.png').startswith(b'\x89PNG')
 counts=[]
 for i in range(8):
  sheet=E.fromstring(z.read(f'xl/worksheets/sheet{i+1}.xml'));counts.append(len(sheet.findall('s:sheetData/s:row',ns)))
  assert counts[-1]>1 and not sheet.findall('.//s:f',ns)
with zipfile.ZipFile(p/'integrated-records.xlsx') as z:
 assert z.testzip() is None
 sheet=E.fromstring(z.read('xl/worksheets/sheet2.xml'));rows=sheet.findall('s:sheetData/s:row',ns);assert len(rows)==32
 raw=(p/'mixed.stdf').read_bytes();seen=[]
 for row in rows[1:]:
  values=[]
  for cell in row.findall('s:c',ns):
   values.append(cell.find('s:is/s:t',ns).text if cell.attrib.get('t')=='inlineStr' else int(cell.find('s:v',ns).text))
  seq,offset,length,typ,sub,name,n,m=values[:8];assert seq==len(seen)+1
  fields=json.loads(''.join(values[8:8+n]));assert isinstance(fields,dict)
  assert bytes.fromhex(''.join(values[8+n:8+n+m]))==raw[offset:offset+length]
  assert raw[offset+2:offset+4]==bytes([typ,sub]);seen.append(name)
 assert {'MPR','FTR','PTR','GDR','DTR'}.issubset(seen)
print(json.dumps({'sections':names,'reportRows':counts,'convertedRecords':len(seen)}))
`;
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (request.method === 'POST' && /^\/artifact\/[a-z.-]+$/.test(path)) {
      await pipeline(request, createWriteStream(resolve(fixtures, path.slice(10)))); response.end('OK'); return;
    }
    response.setHeader('Content-Type', 'text/javascript');
    if (path === '/__transfer-worker.js') { response.end(worker); return; }
    if (path === '/__transfer.html') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Isolated workspace and workbook checks</title>'); return; }
    const base = path.startsWith('/fixture/') ? fixtures : site, file = resolve(base, '.' + (base === fixtures ? path.slice(8) : path));
    if (!file.startsWith(base + sep)) throw Error('Outside root');
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' })[extname(file)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, contexts = [], results = [], checks = [], pageErrors = [], externalRequests = [];
async function browser(label) {
  const context = await chromium.launchPersistentContext(resolve(output, label), { channel, headless: true }); contexts.push(context);
  context.on('request', (r) => { if (!r.url().startsWith(origin)) externalRequests.push(r.url()); });
  const page = await context.newPage(); page.on('pageerror', (e) => pageErrors.push(e.message)); await page.goto(origin + '/__transfer.html');
  await page.evaluate(() => { window.testWorker = new Worker('./__transfer-worker.js', { type: 'module' }); });
  return async (message) => {
    const result = await page.evaluate((message) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Transfer check timeout: ' + message.type)), 180000);
      window.testWorker.onerror = (e) => { clearTimeout(timer); reject(Error(e.message)); };
      let sent = false;
      window.testWorker.onmessage = ({ data }) => {
        if (data.progress) { if (message.cancel && !sent && data.progress.phase === 'report') { sent = true; window.testWorker.postMessage({ type: 'cancel' }); } return; }
        clearTimeout(timer); resolve({ ...data, cancelSent: sent });
      };
      window.testWorker.postMessage(message);
    }), message);
    results.push({ label, message, ...result }); return result;
  };
}
try {
  const run = await browser('profile-original');
  const seed = await run({ type: 'seed' }); assert.equal(seed.ok, true, JSON.stringify(seed.error));
  const saved = await run({ type: 'save', ids: seed.result.ids }); assert.equal(saved.ok, true, JSON.stringify(saved.error)); assert.deepEqual(saved.result.leftovers, []);
  for (const option of ['invalidState', 'tooManyTests', 'cancelAfterFirst']) {
    const failedSave = await run({ type: 'save', ids: seed.result.ids, [option]: true });
    assert.equal(failedSave.ok, false); assert.deepEqual(failedSave.leftovers, []); assert.equal(failedSave.datasets.length, 2);
  }
  const generatorPath = resolve(output, 'mutations.py'); await writeFile(generatorPath, generator); const packageChecks = JSON.parse(python([generatorPath, fixtures]));
  const reused = await run({ type: 'restore', name: 'workspace.sdworkspace' }); assert.equal(reused.ok, true, JSON.stringify(reused.error)); assert.equal(reused.result.reused, 2); assert.deepEqual(reused.result.state, saved.result.state); assert.deepEqual(reused.result.leftovers, []);
  checks.push('Real two-source STORE workspace, source SHA metadata, repeated comparison group and unresolved key round trip; duplicate restore verifies packages and reuses datasets');
  for (const name of ['deflated.sdworkspace', 'extra.sdworkspace', 'traversal.sdworkspace', 'large-manifest.sdworkspace', 'wrong-hash.sdworkspace', 'prototype.sdworkspace', 'corrupt-first.sdworkspace', 'zip-crc.sdworkspace', 'native.db']) {
    const value = await run({ type: 'restore', name }); assert.equal(value.ok, false, name); assert.deepEqual(value.leftovers, [], name); assert.equal(value.datasets.length, 2); assert.match(value.error.message, /workspace|checksum|compatible/i);
  }
  assert.equal((await run({ type: 'bad-token' })).error.code, 'INVALID_REQUEST');
  const orphan = await run({ type: 'orphan' }); assert.equal(orphan.result.removed, 1); assert.deepEqual(orphan.result.leftovers, ['semidata-viewer-exports-v1/leave-me.txt']);
  checks.push('Hostile inventories, compressed members, traversal, oversized manifest, hash mismatch, prototype keys, native DB and corrupt nested package rejected; no source mutation or temporary leftovers');
  const fresh = await browser('profile-fresh');
  const restored = await fresh({ type: 'restore', name: 'workspace.sdworkspace' }); assert.equal(restored.ok, true, JSON.stringify(restored.error)); assert.equal(restored.result.restored, 2); assert.equal(restored.result.reused, 0); assert.deepEqual(restored.result.leftovers, []);
  const mapped = seed.result.ids.map((id) => restored.result.datasetMap[id]); assert.ok(mapped.every((id, i) => id !== seed.result.ids[i]));
  assert.deepEqual(restored.result.state.selection.groups[0].datasetIds, mapped); assert.equal(JSON.parse(restored.result.state.tests[1])[5], mapped[1] + ':7:unresolved-omitted'); assert.deepEqual(restored.result.state.settings, saved.result.state.settings);
  const partial = await browser('profile-partial');
  const failed = await partial({ type: 'restore', name: 'corrupt-second.sdworkspace' }); assert.equal(failed.ok, false); assert.equal(failed.datasets.length, 1); assert.equal(failed.error.completedDatasetIds.length, 1); assert.match(failed.error.message, /state was not applied.*completed source.*remain/i); assert.deepEqual(failed.leftovers, []);
  const cancelled = await partial({ type: 'restore', name: 'workspace.sdworkspace', cancelAfterFirst: true }); assert.equal(cancelled.ok, false); assert.equal(cancelled.error.code, 'CANCELLED'); assert.equal(cancelled.datasets.length, 1); assert.deepEqual(cancelled.leftovers, []);
  checks.push('Fresh profile restores and remaps all group IDs plus unresolved test identity; later corruption/cancellation preserves completed import without returning session state');
  for (const message of [{ type: 'xlsx', name: 'rows' }, { type: 'xlsx', name: 'split', count: 1048579, split: true }]) {
    const value = await run(message); assert.equal(value.ok, true); assert.equal(value.result.error, undefined, JSON.stringify(value.result)); assert.equal(value.result.closed, true); assert.equal(value.result.aborted, false); assert.equal(value.result.finished, true); assert.ok(value.result.maxWrite <= 1024 * 1024);
  }
  const inspectPath = resolve(output, 'inspect.py'); await writeFile(inspectPath, inspect); const workbookChecks = JSON.parse(python([inspectPath, fixtures]));
  checks.push('Independent Python ZIP/XML inspection verifies 70,000 literal rows, actual newlines and XML/OOXML escaping, sanitized unique names, PNG relationships; 1,048,579 data rows split exactly with repeated headers and first-part image');
  for (const fault of ['number', 'columns', 'text', 'row', 'io']) {
    const value = await run({ type: 'xlsx', name: 'failure-' + fault, count: 1, fault }); assert.equal(value.result.aborted, true); assert.equal(value.result.closed, false); assert.equal(value.result.size, 0); assert.ok(value.result.error);
  }
  const interrupted = await run({ type: 'xlsx', name: 'interrupted', count: 100000, cancel: true }); assert.equal(interrupted.cancelSent, true); assert.equal(interrupted.result.error.code, 'CANCELLED'); assert.equal(interrupted.result.aborted, true); assert.equal(interrupted.result.closed, false); assert.equal(interrupted.result.size, 0); assert.equal(interrupted.result.finished, true);
  checks.push('Invalid cell values/column count/text/row budget, injected storage failure and real worker cancellation abort unpublished output and close row generators');
  await run({ type: 'close' }); await fresh({ type: 'close' }); await partial({ type: 'close' });
  const page = contexts[0].pages().at(-1);
  const integrated = await page.evaluate(async () => {
    const { DataLibraryClient } = await import('./data-client.js'); const client = new DataLibraryClient(); await client.open();
    try {
      const file = new File([await (await fetch('/fixture/mixed.stdf')).blob()], 'mixed.stdf');
      const dataset = (await client.importFile(file)).dataset;
      const selection = { groups: [{ name: 'Mixed families', datasetIds: [dataset.id] }], attempts: 'all' };
      const tests = (await client.viewer('tests', selection)).items.map((t) => t.key);
      const png = new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='), (c) => c.charCodeAt(0))], { type: 'image/png' });
      const reports = [];
      for (const kind of ['report', 'records']) {
        const result = await client.viewerReport(selection, { kind, tests, datasetId: dataset.id, images: kind === 'report' ? [{ sheet: 'Trend Chart', blob: png }] : [] });
        await fetch('/artifact/integrated-' + kind + '.xlsx', { method: 'POST', body: result.file });
        reports.push(result.report); await client.request('viewerReport', { action: 'release', token: result.token });
      }
      let failure;
      try { await client.viewerReport(selection, { tests, images: [{ sheet: 0, blob: new Blob(['bad PNG']) }] }); } catch (error) { failure = { code: error.code, message: error.message }; }
      const exports = await (await navigator.storage.getDirectory()).getDirectoryHandle('semidata-report-exports-v1'), names = [];
      for await (const [name] of exports.entries()) names.push(name);
      const session = await client.viewerTransfer('saveSession', { state: { selection, tests, settings: { bins: 30 } } });
      const restored = await client.viewerTransfer('restoreSession', { file: session.file });
      await client.viewerTransfer('release', { token: session.token });
      return { reports, failure, leftovers: names, restoredTests: restored.state.tests, tests, reused: restored.reused, verified: await client.verifyDataset(dataset.id) };
    } finally { await client.close(); }
  });
  assert.equal(integrated.failure.code, 'INVALID_REPORT'); assert.deepEqual(integrated.leftovers, []); assert.equal(integrated.reused, 1); assert.deepEqual(integrated.restoredTests, integrated.tests); assert.equal(integrated.verified.verified, true);
  const reportPath = resolve(output, 'inspect-reports.py'); await writeFile(reportPath, inspectReports); const reportChecks = JSON.parse(python([reportPath, fixtures]));
  checks.push('Production DataLibraryClient/worker routes generate all eight real report sections and PNG; record converter reconstructs every original STDF record byte-for-byte, failed report cleans output, workspace routes preserve test keys');
  assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ channel, passed: true, checks, packageChecks, workbookChecks, reportChecks, integrated, results, pageErrors, externalRequests }, null, 2));
  console.log(JSON.stringify({ output, checks, cases: results.length }));
} catch (error) { await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: error.stack, checks, results, pageErrors, externalRequests }, null, 2)); throw error; }
finally { for (const context of contexts) await context.close(); await new Promise((done) => server.close(done)); }
