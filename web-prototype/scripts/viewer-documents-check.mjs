import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url)), repo = resolve(root, '..'), site = resolve(root, 'site');
const channel = process.argv[2] ?? 'chrome', output = resolve(root, 'results', `viewer-documents-${channel}-${Date.now()}`), fixtures = resolve(output, 'fixtures');
if (!['chrome','msedge'].includes(channel)) throw Error('Choose chrome or msedge');
await mkdir(output,{recursive:true});
const generated=spawnSync(resolve(repo,'.venv/Scripts/python.exe'),[resolve(root,'scripts/make-study-fixtures.py'),fixtures],{encoding:'utf8'});assert.equal(generated.status,0,generated.stderr);
const server=createServer(async(request,response)=>{
  try{
    const pathname=new URL(request.url,'http://localhost').pathname;
    if(pathname==='/'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/viewer.css"><link rel="stylesheet" href="/viewer-charts.css"><input id="file" type="file"><main id="tools"></main><footer class="viewer-footer"></footer>');return;}
    const path=resolve(site,'.'+decodeURIComponent(pathname));if(!path.startsWith(site+sep))throw Error('Path');
    response.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css'})[extname(path)]??'application/octet-stream');response.end(await readFile(path));
  }catch{response.writeHead(404);response.end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`;
let browser;const checks=[];
try{
  browser=await chromium.launch({channel,headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});await page.goto(origin);
  const result=await page.evaluate(async()=>{
    const {createDocumentExports,createDocumentBatch,validateDocumentReport,normalizeReportLayout}=await import('./viewer-document-formats.js');
    const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=400;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1000,400);ctx.fillStyle='#172331';ctx.font='28px Segoe UI';ctx.fillText('IDDQ_CORE   ΔV μA   측정 결과 测试结果',35,50);ctx.fillStyle='#245cce';for(let i=0;i<15;i++)ctx.fillRect(60+i*56,340-((i%5)+1)*44,38,((i%5)+1)*44);
    const image=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const report={title:'Local test analysis',createdAt:'2026-09-25T12:00:00.000Z',scope:'Lot QA · current attempts',provenance:{sources:[{datasetId:'source1',name:'시험 测试.stdf',sha256:'a'.repeat(64)}],method:'Independent export fixture'},sections:[
      {title:'Selected population',paragraphs:['The selected lot contains 24 passing devices and one failure. Values are in base units.','Unicode check ΔV μA 측정 결과 测试结果'],table:{headers:['Measurement','Value','Unit'],rows:[['Mean',1.25,'μA'],['Sigma',0.125,'μA'],['Cpk',1.333,'unitless']]}},
      {title:'Current distribution',image},
      {title:'Recorded test summaries',table:{headers:['Test','Count','Mean','Sigma','Cpk'],rows:Array.from({length:52},(_,i)=>[`CORE_CURRENT_${i}`,25,`${i+0.25}`,'0.125','1.333'])}},
      {title:'Source identity',paragraphs:['a'.repeat(64),'Long token '+'x'.repeat(350)]}
    ]};
    const created=await createDocumentExports(report,{formats:['pdf','docx','png','jpg']});window.created=created;
    const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('semidata-document-exports-v1');const names=async()=>{const values=[];for await(const [name] of dir.entries())values.push(name);return values.sort();};
    const before=await names();let cancel=false,cancelled=false;
    try{await createDocumentExports(report,{formats:['pdf','docx'],checkCancelled(){if(cancel)throw Error('cancel');},onProgress(progress){if(progress.phase==='document-format')cancel=true;}});}catch(error){cancelled=error.message==='cancel';}
    const after=await names();let bounded=false;try{validateDocumentReport({...report,sections:[{title:'Too large',table:{headers:['x'],rows:Array.from({length:5001},()=>['x'])}}]});}catch{bounded=true;}
    let rolledBack=false;try{await createDocumentBatch([()=>({...report,filenameStem:'batch-first'}),()=>{throw Error('scope failed');}],{formats:['docx']});}catch(error){rolledBack=error.message==='scope failed';}
    const afterBatch=await names();
    window.landscape=await createDocumentExports({...report,filenameStem:'landscape',layout:{pageWidthMm:297,pageHeightMm:210,imageWidthPx:1600},sections:[{title:'Landscape dimensions',paragraphs:['297 × 210 mm with a 1600 pixel page image.'],table:{headers:['Test','Value'],rows:[['IDDQ',1.25]]}}]},{formats:['pdf','docx','png']});
    window.summary=await createDocumentExports({...report,filenameStem:'summary',sections:[...report.sections,{title:'Literal cells',table:{headers:['Source text','Typed value'],rows:[['=HYPERLINK("https://invalid.example")',12.5],['+SUM(1,2)',false],['@DATA',0],['_x0041_','literal escape']]}}]},{formats:['xlsx']});
    const beforeWorkbookFailure=await names();let workbookRejected=false;try{await createDocumentExports({...report,sections:[{title:'Oversized cell',table:{headers:['Text'],rows:[['x'.repeat(32768)]]}}]},{formats:['docx','xlsx']});}catch(error){workbookRejected=/32,767/.test(error.message);}const afterWorkbookFailure=await names();
    let layoutBounded=false;try{normalizeReportLayout({pageWidthMm:148,pageHeightMm:594,imageWidthPx:2400});}catch{layoutBounded=true;}
    return{receipt:created.receipt,files:created.files.map(({file,...rest})=>({...rest,bytes:file.size})),before,after,afterBatch,cancelled,bounded,rolledBack,layoutBounded,workbookRejected,beforeWorkbookFailure,afterWorkbookFailure};
  });
  assert.equal(result.files.length,4);assert.ok(result.files[0].pages>=2);assert.deepEqual(result.before,result.after);assert.deepEqual(result.before,result.afterBatch);assert.equal(result.cancelled,true);assert.equal(result.rolledBack,true);assert.equal(result.bounded,true);
  for(let i=0;i<result.files.length;i++){
    const encoded=await page.evaluate(async index=>{const bytes=new Uint8Array(await window.created.files[index].file.arrayBuffer());let raw='';for(let at=0;at<bytes.length;at+=32768)raw+=String.fromCharCode(...bytes.subarray(at,at+32768));return btoa(raw);},i);
    await writeFile(resolve(output,result.files[i].filename),Buffer.from(encoded,'base64'));
  }
  checks.push('PDF/DOCX/PNG/JPEG real binary generation, multipage image ZIPs, Unicode source/measurement labels, bounded tables and cancellation rollback');
  assert.equal(result.layoutBounded,true);
  assert.equal(result.workbookRejected,true);assert.deepEqual(result.beforeWorkbookFailure,result.afterWorkbookFailure);
  for(let index=0;index<3;index++){
    const exported=await page.evaluate(async index=>{const item=window.landscape.files[index],bytes=new Uint8Array(await item.file.arrayBuffer());let raw='';for(let at=0;at<bytes.length;at+=32768)raw+=String.fromCharCode(...bytes.subarray(at,at+32768));return{filename:item.filename,bytes:btoa(raw)};},index);
    await writeFile(resolve(output,exported.filename),Buffer.from(exported.bytes,'base64'));
  }
  checks.push('Explicit landscape page dimensions, image resolution, layout receipt and oversized canvas rejection');
  const workbook=await page.evaluate(async()=>{const bytes=new Uint8Array(await window.summary.files[0].file.arrayBuffer());let raw='';for(let at=0;at<bytes.length;at+=32768)raw+=String.fromCharCode(...bytes.subarray(at,at+32768));return btoa(raw);});await writeFile(resolve(output,'semidata-summary-xlsx.xlsx'),Buffer.from(workbook,'base64'));
  await page.evaluate(async()=>{const {DataLibraryClient}=await import('./data-client.js');window.library=new DataLibraryClient();await library.open();});
  await page.locator('#file').setInputFiles(resolve(fixtures,'study-little.stdf'));
  await page.evaluate(async()=>{
    const {dataset}=await library.importFile(document.querySelector('#file').files[0]);
    const selection={groups:[{name:'Study sample',datasetIds:[dataset.id]}],attempts:'all'},catalog=await library.viewer('tests',selection),test=catalog.items[0];
    const {renderDocumentTools,collectDocumentReport}=await import('./viewer-document-ui.js');
    window.api={state:{selection,selected:new Map([[test.key,test]]),datasets:[dataset],settings:{bins:10,precision:3},seriesBy:'aggregate',includeAggregate:false},query:(action,options)=>library.viewer(action,selection,options),client:()=>library,run:async fn=>{try{await fn();window.finished=true;}catch(error){window.failure=error.stack;}},checkCancelled(){}};
    window.fullReport=await collectDocumentReport(api,{selection,scopeLabel:'Single source fixture',title:'STDF investigation report',sections:['summary','statistics','histogram','trend','bins','wafer','sites','deviceTrends','retest','pcr','datalog','pat','worstCpk'],patFit:'mad',patK:3});
    await renderDocumentTools(document.querySelector('#tools'),api);
  });
  const model=await page.evaluate(()=>({sections:fullReport.sections.map(section=>section.title),sources:fullReport.provenance.sources,rows:fullReport.sections.reduce((n,s)=>n+(s.table?.rows.length??0),0),pcr:fullReport.sections.find(section=>section.title==='Recorded part count summaries').table.rows}));
  assert.ok(model.sections.includes('PAT screening'));assert.ok(model.sections.includes('Site yield and timing'));assert.ok(model.sections.includes('Explicit retest counts'));assert.equal(model.sources.length,1);
  assert.equal(model.pcr.length,1);assert.deepEqual(model.pcr[0].slice(1),[1,1,8,0,0,6,0]);
  await page.getByRole('button',{name:'Create report',exact:true}).click();await page.waitForFunction(()=>window.finished||window.failure);assert.equal(await page.evaluate(()=>window.failure),undefined);
  assert.equal(await page.getByRole('link',{name:/Download semidata-report-pdf/}).count(),1);
  await page.screenshot({path:resolve(output,'document-ui.png'),fullPage:true});
  const downloaded=await page.evaluate(async()=>{const link=document.querySelector('a[download="semidata-report-pdf.pdf"]'),bytes=new Uint8Array(await(await fetch(link.href)).arrayBuffer());let raw='';for(let at=0;at<bytes.length;at+=32768)raw+=String.fromCharCode(...bytes.subarray(at,at+32768));return btoa(raw);});
  await writeFile(resolve(output,'production-report.pdf'),Buffer.from(downloaded,'base64'));
  const all=await page.evaluate(async()=>{const {createDocumentExports}=await import('./viewer-document-formats.js');window.fullCreated=await createDocumentExports(fullReport,{formats:['docx','pdf','xlsx']});const bytes=new Uint8Array(await fullCreated.files[0].file.arrayBuffer());let raw='';for(let at=0;at<bytes.length;at+=32768)raw+=String.fromCharCode(...bytes.subarray(at,at+32768));return btoa(raw);});
  await writeFile(resolve(output,'production-report.docx'),Buffer.from(all,'base64'));
  const allPdf=await page.evaluate(async()=>{const bytes=new Uint8Array(await fullCreated.files[1].file.arrayBuffer());let raw='';for(let at=0;at<bytes.length;at+=32768)raw+=String.fromCharCode(...bytes.subarray(at,at+32768));return btoa(raw);});
  await writeFile(resolve(output,'production-all-sections.pdf'),Buffer.from(allPdf,'base64'));
  const allXlsx=await page.evaluate(async()=>{const bytes=new Uint8Array(await fullCreated.files[2].file.arrayBuffer());let raw='';for(let at=0;at<bytes.length;at+=32768)raw+=String.fromCharCode(...bytes.subarray(at,at+32768));return btoa(raw);});await writeFile(resolve(output,'production-report.xlsx'),Buffer.from(allXlsx,'base64'));
  await page.getByLabel('Scope',{exact:true}).selectOption('both');
  await page.evaluate(()=>{window.finished=false;});
  await page.getByRole('button',{name:'Create report',exact:true}).click();await page.waitForFunction(()=>window.finished||window.failure);assert.equal(await page.evaluate(()=>window.failure),undefined);
  assert.equal(await page.getByRole('link',{name:/Download semidata-source-/}).count(),1);assert.equal(await page.getByRole('link',{name:/Download semidata-lot-/}).count(),1);
  assert.ok(model.sections.includes('Recorded part count summaries'));assert.ok(model.sections.includes('Cumulative device yield by test order'));assert.ok(model.sections.includes('Full catalogue capability scan'));
  checks.push('Production statistics/wafer/bin/PAT/timing/retest/PCR/datalog/device-yield/full-catalogue-Cpk report model, UI single-source plus lot batch and receipts; editable Word report');
  const batchSources=[];
  for(let i=1;i<=3;i++){
    await page.locator('#file').setInputFiles(resolve(fixtures,`report-${i}.stdf`));
    batchSources.push(await page.evaluate(async()=>{const{dataset}=await library.importFile(document.querySelector('#file').files[0]);return dataset;}));
  }
  await page.evaluate(async datasets=>{
    api.state.datasets=datasets;api.state.selection={groups:[{name:'Report lots',datasetIds:datasets.map(dataset=>dataset.id)}],attempts:'all'};
    api.query=(action,options)=>library.viewer(action,api.state.selection,options);
    document.querySelector('#tools').replaceChildren();document.querySelector('#viewer-downloads')?.remove();
    const{renderDocumentTools}=await import('./viewer-document-ui.js');await renderDocumentTools(document.querySelector('#tools'),api);
  },batchSources);
  await page.getByLabel('Scope',{exact:true}).selectOption('both');
  await page.getByLabel('Selected test statistics and Cpk ranking',{exact:true}).uncheck();await page.getByLabel('Histograms',{exact:true}).uncheck();
  await page.getByLabel('Excel summary',{exact:true}).check();
  await page.evaluate(()=>{window.finished=false;window.failure=undefined;});
  await page.getByRole('button',{name:'Create report',exact:true}).click();await page.waitForFunction(()=>window.finished||window.failure);assert.equal(await page.evaluate(()=>window.failure),undefined);
  assert.equal(await page.getByRole('link',{name:/Download semidata-source-/}).count(),6);assert.equal(await page.getByRole('link',{name:/Download semidata-lot-/}).count(),4);
  await page.getByRole('button',{name:'Download receipt',exact:true}).click();
  const batchReceipt=await page.evaluate(async()=>JSON.parse(await(await fetch(document.querySelector('a[download="report-receipt.json"]').href)).text()));
  assert.equal(batchReceipt.reports.length,5);assert.deepEqual(batchReceipt.reports.map(report=>report.provenance.sources.length),[1,1,1,2,1]);
  assert.equal(batchReceipt.files.filter(file=>file.format==='xlsx').length,5);
  assert.deepEqual(batchReceipt.reports.slice(3).map(report=>report.scope),['Lot REPORT-A','Lot REPORT-B']);
  assert.deepEqual(batchReceipt.reports.slice(3).map(report=>report.sections[0].table.rows[0][1]),[2,1]);
  await writeFile(resolve(output,'batch-receipt.json'),JSON.stringify(batchReceipt,null,2));
  const lotWorkbook=await page.evaluate(async()=>{const link=[...document.querySelectorAll('a[download]')].find(link=>/lot-.*REPORT-A.*xlsx$/.test(link.download)),bytes=new Uint8Array(await(await fetch(link.href)).arrayBuffer());let raw='';for(let at=0;at<bytes.length;at+=32768)raw+=String.fromCharCode(...bytes.subarray(at,at+32768));return btoa(raw);});await writeFile(resolve(output,'batch-lot-report.xlsx'),Buffer.from(lotWorkbook,'base64'));
  checks.push('Three-source/two-lot batch membership, lot names, source hashes, counts and five complete report receipts');
  checks.push('Excel summary workbook native literals, chart images, provenance and all five source/lot scopes');
  await page.evaluate(()=>library.close());
  await writeFile(resolve(output,'results.json'),JSON.stringify({channel,browser:browser.version(),checks,...result,model},null,2));console.log(JSON.stringify({passed:checks.length,output},null,2));
}finally{await browser?.close();await new Promise(done=>server.close(done));}
