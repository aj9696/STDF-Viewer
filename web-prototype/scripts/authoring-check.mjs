import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { atdfSample } from './authoring-model-check.mjs';
const base=fileURLToPath(new URL('../',import.meta.url)),repo=resolve(base,'..'),site=resolve(base,'site'),channel=process.argv[2]??'chrome';
if(!['chrome','msedge'].includes(channel))throw Error('Choose chrome or msedge');
const fixtures=spawnSync(resolve(repo,'.venv/Scripts/python.exe'),[resolve(base,'scripts/make-authoring-fixtures.py')],{encoding:'utf8'});if(fixtures.status!==0)throw Error(fixtures.stderr||fixtures.stdout);
const output=resolve(base,'results',`authoring-${channel}-${Date.now()}`);await mkdir(output,{recursive:true});
const worker=String.raw`
import {LibraryStore} from './library-store.js';
import {runOperation} from './library-operations.js';
import {runViewerAuthoring,AUTHORING_DIRECTORY} from './viewer-authoring.js';
let store;const context={checkCancelled(){},progress(){}};
const input=async(name)=>new File([await(await fetch('/fixture/'+name)).blob()],name);
const save=async(name,file)=>{const r=await fetch('/artifact/'+name,{method:'POST',body:file});if(!r.ok)throw Error('Artifact upload failed');};
const expect=async(fn,label)=>{try{await fn();}catch(e){return {label,code:e.code,message:e.message};}throw Error('Expected rejection: '+label);};
const exports=async()=>{const d=await(await navigator.storage.getDirectory()).getDirectoryHandle(AUTHORING_DIRECTORY,{create:true}),a=[];for await(const[n]of d.entries())a.push(n);return a.sort();};
self.onmessage=async({data})=>{try{
store??=new LibraryStore();if(!store.catalog)await store.open();const result={cases:[],sources:[]};
for(const endian of ['little','big']){
 const imported=await runOperation(store,{type:'importFile',file:await input('golden-'+endian+'.stdf')},context),id=imported.dataset.id;
 const before=await runOperation(store,{type:'verifyDataset',datasetId:id},context);
 const exact=await runViewerAuthoring(store,{action:'export',options:{datasetId:id}},context);await save('original-'+endian+'.stdf',exact.file);await runViewerAuthoring(store,{action:'release',options:{token:exact.token}},context);
 const options={datasetId:id,reason:'Independent authoring fixture',edits:[{seq:2,field:'LOT_ID',value:'DERIVED-LOT'},{seq:14,field:'RESULT',value:.8},{seq:9,field:'RTN_RSLT',ordinal:1,value:1.25},{seq:16,field:'SOFT_BIN',value:9},{seq:16,field:'PART_FLG',value:8}],remap:{kind:'soft',from:2,to:5,outcome:'pass'},insertRecords:[{name:'DTR',fields:{TEXT_DAT:'Derived note'}},{name:'SBR',fields:{HEAD_NUM:255,SITE_NUM:255,SBIN_NUM:5,SBIN_PF:'P',SBIN_NAM:'Reviewed'}}]};
 const preview=await runViewerAuthoring(store,{action:'preview',options},context);if(preview.remappedDevices!==1)throw Error('Wrong preview count after explicit bin edit');
 const edited=await runViewerAuthoring(store,{action:'edit',options},context);await save('revision-'+endian+'.json',edited.file);
 const derived=await runViewerAuthoring(store,{action:'export',options:{datasetId:id,plan:preview.plan}},context);await save('derived-'+endian+'.stdf',derived.file);
 const reimport=await runOperation(store,{type:'importFile',file:new File([derived.file],'derived-'+endian+'.stdf')},context);
 if(reimport.dataset.manifest.counts.devices!==3)throw Error('Reimport lost devices');
 const batch=await runViewerAuthoring(store,{action:'convert',options:{datasetIds:[id],formats:['csv','json','stdf','original'],plans:{[id]:preview.plan}}},context);await save('batch-'+endian+'.zip',batch.file);
 const removeOptions={datasetId:id,reason:'Remove documented duplicate attempt',deleteDevices:[6],edits:[{seq:16,field:'X_COORD',value:300},{seq:16,field:'Y_COORD',value:-99}]};
 const removedPreview=await runViewerAuthoring(store,{action:'preview',options:removeOptions},context);if(removedPreview.deletedDevices!==1)throw Error('Wrong removal count');
 const removed=await runViewerAuthoring(store,{action:'export',options:{datasetId:id,plan:removedPreview.plan}},context);await save('removed-'+endian+'.stdf',removed.file);
 const removedImport=await runOperation(store,{type:'importFile',file:new File([removed.file],'removed-'+endian+'.stdf')},context);if(removedImport.dataset.manifest.counts.devices!==2)throw Error('Removal affected the wrong attempt');
 const removedBatch=await runViewerAuthoring(store,{action:'convert',options:{datasetIds:[id],formats:['csv','json'],plans:{[id]:removedPreview.plan}}},context);await save('removed-'+endian+'.zip',removedBatch.file);
 for(const [label,option]of [['shared test defaults',{...removeOptions,deleteDevices:[3]}],['duplicate removed attempt',{...removeOptions,deleteDevices:[6,6]}],['absent removed attempt',{...removeOptions,deleteDevices:[99]}],['edit removed attempt',{...removeOptions,deleteDevices:[13]}],['coordinate overflow',{...removeOptions,edits:[{seq:16,field:'X_COORD',value:32768}]}]])result.cases.push(await expect(()=>runViewerAuthoring(store,{action:'preview',options:option},context),label));
 const after=await runOperation(store,{type:'verifyDataset',datasetId:id},context);if(before.sha256!==after.sha256)throw Error('Original changed');
 for(const [label,option] of [['structural',{...options,edits:[{seq:3,field:'HEAD_NUM',value:0}]}],['ordinal',{...options,edits:[{seq:9,field:'RTN_RSLT',ordinal:55,value:0}]}],['retest flags',{...options,edits:[{seq:16,field:'PART_FLG',value:1}]}]])result.cases.push(await expect(()=>runViewerAuthoring(store,{action:'preview',options:option},context),label));
 result.cases.push(await expect(()=>runViewerAuthoring(store,{action:'export',options:{datasetId:id,plan:{...preview.plan,sourceSha256:'0'.repeat(64)}}},context),'wrong source hash'));
 const inventory=await exports();let checks=0;const cancelled={...context,checkCancelled(){if(++checks===30)throw Object.assign(Error('cancelled'),{code:'CANCELLED'});}};
 result.cases.push(await expect(()=>runViewerAuthoring(store,{action:'export',options:{datasetId:id,plan:preview.plan}},cancelled),'cancelled'));if(JSON.stringify(inventory)!==JSON.stringify(await exports()))throw Error('Partial export leaked');
 for(const item of [edited,derived,batch,removed,removedBatch])await runViewerAuthoring(store,{action:'release',options:{token:item.token}},context);
 result.sources.push({endian,sourceHash:before.sha256,derivedRecords:derived.receipt.validation.records,conversion:batch.receipt});
 const metadata=await runOperation(store,{type:'importFile',file:await input('metadata-'+endian+'.stdf')},context),mid=metadata.dataset.id;
 const metadataOptions={datasetId:mid,reason:'Typed metadata correction',edits:[{seq:2,field:'SETUP_T',value:990},{seq:2,field:'START_T',value:1090},{seq:2,field:'STAT_NUM',value:7},{seq:2,field:'BURN_TIM',value:45},{seq:3,field:'SITE_GRP',value:4},{seq:14,field:'SBIN_NUM',value:7},{seq:17,field:'HEAD_NUM',value:1},{seq:17,field:'SITE_NUM',value:2},{seq:18,field:'TEST_NUM',value:20},{seq:19,field:'SITE_NUM',value:255},{seq:19,field:'HEAD_NUM',value:1},{seq:21,field:'FINISH_T',value:1310}]};
 const metadataPreview=await runViewerAuthoring(store,{action:'preview',options:metadataOptions},context);if(metadataPreview.plan.relatedEdits.length!==2||metadataPreview.plan.rebuiltSummaries.length!==2)throw Error('Metadata effects are missing from preview');
 const metadataExport=await runViewerAuthoring(store,{action:'export',options:{datasetId:mid,plan:{...metadataPreview.plan,relatedEdits:[{seq:4,field:'HEAD_NUM',value:88}],rebuiltSummaries:[]}}},context);await save('metadata-derived-'+endian+'.stdf',metadataExport.file);
 const importedMetadata=await runOperation(store,{type:'importFile',file:new File([metadataExport.file],'metadata-derived-'+endian+'.stdf')},context);if(importedMetadata.dataset.manifest.counts.devices!==2)throw Error('Metadata revision lost devices');await runViewerAuthoring(store,{action:'release',options:{token:metadataExport.token}},context);
 for(const [label,edits]of [['station overflow',[{seq:2,field:'STAT_NUM',value:256}]],['fractional timestamp',[{seq:2,field:'START_T',value:1100.5}]],['date order',[{seq:21,field:'FINISH_T',value:1000}]],['SDR ownership',[{seq:3,field:'HEAD_NUM',value:2}]],['unknown group rename',[{seq:3,field:'SITE_GRP',value:255}]],['duplicate bin identity',[{seq:14,field:'SBIN_NUM',value:2}]],['computed bin count',[{seq:14,field:'SBIN_CNT',value:99}]],['computed test count',[{seq:18,field:'EXEC_CNT',value:99}]],['ambiguous summary scope',[{seq:18,field:'SITE_NUM',value:2}]],['bad test family',[{seq:18,field:'TEST_TYP',value:'Q'}]],['duplicate test summary',[{seq:18,field:'TEST_TYP',value:'M'},{seq:18,field:'TEST_NUM',value:30}]],['removed edited summary',[{seq:18,field:'TEST_NUM',value:20},{seq:6,field:'RESULT',value:1.25}]]])result.cases.push(await expect(()=>runViewerAuthoring(store,{action:'preview',options:{datasetId:mid,reason:label,edits}},context),label));
}
const atdf=await runViewerAuthoring(store,{action:'importAtdf',options:{file:await input('sample.atdf'),utcOffsetMinutes:0}},context);const openedAtdf=await store.access(atdf.dataset.id);try{await save('canonical-atdf.stdf',openedAtdf.file);}finally{openedAtdf.db.close();}await save('original.atdf',atdf.originalFile);result.atdf={datasetId:atdf.dataset.id,provenance:atdf.atdf};
const archived=await runViewerAuthoring(store,{action:'atdfSources',options:{datasetId:atdf.dataset.id}},context);if(archived.items.length!==1)throw Error('Missing saved ATDF provenance');
const recovered=await runViewerAuthoring(store,{action:'atdfOriginal',options:{datasetId:atdf.dataset.id,originalToken:archived.items[0].originalToken}},context);if(await recovered.file.text()!==await atdf.originalFile.text())throw Error('Recovered ATDF is not exact');
result.cases.push(await expect(()=>runViewerAuthoring(store,{action:'atdfOriginal',options:{datasetId:atdf.dataset.id,originalToken:'../unrelated'}},context),'unrelated original ATDF token'));
const bad=await input('bad.atdf');result.cases.push(await expect(()=>runViewerAuthoring(store,{action:'importAtdf',options:{file:bad}},context),'malformed ATDF'));
const verified=await runOperation(store,{type:'verifyDataset',datasetId:atdf.dataset.id},context);result.atdf.hash=verified.sha256;
result.leftovers=await exports();if(result.leftovers.length)throw Error('Unexpected authored export leftovers');await store.close();self.postMessage({ok:true,result});
}catch(e){self.postMessage({ok:false,error:e.message,stack:e.stack});}};`;
const server=createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://localhost');if(u.pathname==='/authoring-worker.js'){res.setHeader('Content-Type','text/javascript');return res.end(worker);}
  if(u.pathname.startsWith('/artifact/')&&req.method==='POST'){const name=u.pathname.slice(10);if(!/^[a-z0-9.-]+$/.test(name))throw Error('Bad artifact');const chunks=[];for await(const b of req)chunks.push(b);await writeFile(resolve(output,name),Buffer.concat(chunks));return res.end('ok');}
  if(u.pathname.startsWith('/fixture/')){const name=u.pathname.slice(9);if(name==='sample.atdf')return res.end(atdfSample);if(name==='bad.atdf')return res.end(atdfSample.replace('PCR:||1|0|0|0|1','PCR:||oops'));
    if(!/^(golden|metadata)-(little|big)\.stdf$/.test(name))throw Error('Bad fixture');return res.end(await readFile(resolve(repo,'.venv/library-fixtures',name)));}
  const path=resolve(site,'.'+decodeURIComponent(u.pathname==='/'?'/storage.html':u.pathname));if(!path.startsWith(site+sep))throw Error('Outside site');res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.html':'text/html','.css':'text/css'})[extname(path)]??'application/octet-stream');res.end(await readFile(path));
}catch(e){res.statusCode=404;res.end(e.message);}});await new Promise((done)=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({channel,headless:true}),context=await browser.newContext(),page=await context.newPage();
try {await page.goto(`http://127.0.0.1:${server.address().port}/`);const result=await page.evaluate(()=>new Promise((resolve,reject)=>{const worker=new Worker('/authoring-worker.js',{type:'module'});worker.onerror=(e)=>reject(Error(e.message));worker.onmessage=({data})=>{worker.terminate();resolve(data);};worker.postMessage({run:true});}));
  if(!result.ok)throw Error(result.error+'\n'+result.stack);await writeFile(resolve(output,'results.json'),JSON.stringify({channel,browser:browser.version(),...result.result},null,2));
  const checked=spawnSync(resolve(repo,'.venv/Scripts/python.exe'),[resolve(base,'scripts/check-authoring-artifacts.py'),output,resolve(repo,'.venv/library-fixtures')],{encoding:'utf8'});if(checked.status!==0)throw Error(checked.stderr||checked.stdout);console.log(JSON.stringify({passed:true,output,cases:result.result.cases.length,independent:JSON.parse(checked.stdout)}));
}finally{await browser.close();await new Promise((done)=>server.close(done));}
