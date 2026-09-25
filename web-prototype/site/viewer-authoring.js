import { readRecord, patchRecord, encodeRecord, RECORD_SCHEMAS, joinBytes } from './stdf-encode.js';
import { datasetId, validateSelection, invalid } from './viewer-model.js';
import { loadParser, hashFile } from './import-source.js';
import { ensureViewerCache } from './viewer-cache.js';
import { ZipWriter, TextReader } from './vendor/compression.js';
import { EDITABLE_RECORD_FIELDS as editable } from './stdf-edit-policy.js';
import { metadataEffects, createTestSummaryCounters, validateSummaryScope } from './authoring-metadata.js';

export const AUTHORING_DIRECTORY = 'semidata-authoring-exports-v1';
export const AUTHORING_TOKEN = /^[0-9a-f-]{36}\.(stdf|zip|json|atdf)$/;
const encoder = new TextEncoder(), MAX_PLAN = 1024 * 1024, MAX_CHANGES = 10000;
const pause = () => new Promise((done) => setTimeout(done, 0));
const directory = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(AUTHORING_DIRECTORY, { create:true });
const jsonBytes = (v) => encoder.encode(JSON.stringify(v));
const safeName = (name) => String(name).replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,100)||'source';
function member(message,id) {
  datasetId(id);
  if(message.selection&&!validateSelection(message.selection).groups.some((g)=>g.datasetIds.includes(id)))invalid('Source is outside the selected workspace.');
}
async function recordAt(opened,seq) {
  if(!Number.isSafeInteger(seq)||seq<1)invalid('Record sequence must be a positive integer.');
  const row=opened.db.selectObject('SELECT * FROM records WHERE seq=?',[seq]);if(!row)invalid('Record is absent from this source.');
  return {...row,bytes:new Uint8Array(await opened.file.slice(row.offset,row.offset+row.length).arrayBuffer())};
}
async function* records(opened,context) {
  const stmt=opened.db.prepare('SELECT seq,offset,length,type,subtype,device_id FROM records ORDER BY seq');let block=new Uint8Array(),start=0;
  try { while(stmt.step()) {context.checkCancelled();const r=stmt.get({});if(r.offset<start||r.offset+r.length>start+block.length){start=r.offset;block=new Uint8Array(await opened.file.slice(start,start+Math.max(65536,r.length)).arrayBuffer());}
    yield {...r,bytes:block.subarray(r.offset-start,r.offset-start+r.length)};
    if(r.seq%2048===0){context.progress({phase:'authoring',records:r.seq,totalRecords:opened.manifest.counts.records});await pause();}
  }}finally{stmt.finalize();}
}
function validateEnvelope(options) {
  if(!options||typeof options!=='object'||Array.isArray(options))invalid('Provide an edit request.');
  if(jsonBytes(options).length>MAX_PLAN)invalid('Edit plan exceeds 1 MiB.');
  if(typeof options.reason!=='string'||!options.reason.trim()||options.reason.length>500)invalid('Describe the reason for this derived revision (1–500 characters).');
  for(const key of ['edits','insertRecords','deleteSeqs','deleteDevices'])if(options[key]!==undefined&&(!Array.isArray(options[key])||options[key].length>MAX_CHANGES))invalid('An edit plan supports at most 10,000 changes.');
  if((options.edits?.length??0)+(options.insertRecords?.length??0)+(options.deleteSeqs?.length??0)+(options.deleteDevices?.length??0)>MAX_CHANGES)invalid('An edit plan supports at most 10,000 changes.');
}
/** Reject uncertain ownership and removal of declarations needed by survivors. */
async function validateDeviceDeletes(opened,ids,editedDevices,context) {
  const removed=new Set(ids),closed=new Set(),active=new Map(),first=new Map();
  if(removed.size!==ids.length||ids.some((id)=>!Number.isSafeInteger(id)||id<1))invalid('Choose distinct positive PIR sequence IDs to remove.');
  for(const id of ids){if(editedDevices.has(id))invalid('An attempt cannot be edited and removed in one revision.');const d=opened.db.selectObject('SELECT id,prr_seq FROM devices WHERE id=?',[id]);if(!d)invalid('Removed attempt is absent from this source.');const pir=await recordAt(opened,id),prr=await recordAt(opened,d.prr_seq);if(pir.type!==5||pir.subtype!==10||pir.device_id!==id||prr.type!==5||prr.subtype!==20||prr.device_id!==id)invalid('Attempt ownership is incomplete; removal is unsafe.');}
  for await(const r of records(opened,context)){
    if(r.bytes[2]!==r.type||r.bytes[3]!==r.subtype)invalid('Record index disagrees with the source.');
    if(r.type===5&&r.subtype===10){const key=`${r.bytes[4]}/${r.bytes[5]}`;if(active.has(key)||r.device_id!==r.seq)invalid('Overlapping or unowned PIR prevents attempt removal.');active.set(key,r.seq);}
    else if(r.type===5&&r.subtype===20){const key=`${r.bytes[4]}/${r.bytes[5]}`,id=active.get(key);if(id===undefined||r.device_id!==id)invalid('Orphan or misowned PRR prevents attempt removal.');active.delete(key);if(removed.has(id))closed.add(id);}
    else if(r.type===15&&[10,15,20].includes(r.subtype)){
      const key=`${r.bytes[8]}/${r.bytes[9]}`,id=active.get(key),defaultsOnly=r.subtype===10&&id===undefined&&(r.bytes[10]&16)!==0&&r.bytes[11]===0;
      if(defaultsOnly?r.device_id!==null:id===undefined||r.device_id!==id)invalid('Orphan or misowned test result prevents attempt removal.');
      const number=new DataView(r.bytes.buffer,r.bytes.byteOffset+4,4).getUint32(0,opened.manifest.byteOrder==='little'),test=`${r.subtype}/${number}`;
      if(!first.has(test)){if(first.size>=20000)invalid('Attempt removal supports at most 20,000 test identities.');first.set(test,removed.has(r.device_id));}
      else if(first.get(test)&&!removed.has(r.device_id))invalid(`Cannot remove the first declaration of test ${number}: surviving results may inherit its metadata.`);
    }else if(r.device_id!==null)invalid('An unsupported owned record prevents attempt removal.');
  }
  if(active.size||closed.size!==removed.size)invalid('Unmatched attempt records prevent removal.');
  return ids.slice();
}
/** Revalidates caller-supplied plans against immutable bytes, not their before values. */
async function preview(opened,options,context) {
  validateEnvelope(options);const edits=[],seen=new Set(),devices=new Set();
  for(const input of options.edits??[]) {
    context.checkCancelled();const r=await recordAt(opened,input.seq),d=readRecord(r.bytes,opened.manifest.byteOrder);
    if(!editable[d.name]?.includes(input.field))invalid(`Editing ${d.name}.${input.field} is unsupported.`);
    const key=`${input.seq}:${input.field}:${input.ordinal??''}`;if(seen.has(key))invalid('Each record field/result ordinal can be edited only once per revision.');seen.add(key);
    if(input.field==='PART_FLG'&&(!Number.isInteger(input.value)||input.value<0||input.value>255||((input.value^d.values.PART_FLG)&~24)))invalid('Only PRR pass/fail and unknown-outcome bits can be changed; retest and abnormal flags are preserved.');
    if(d.name==='MPR'&&(!Number.isInteger(input.ordinal)||input.ordinal<0))invalid('Choose an MPR result ordinal.');
    if(d.name!=='MPR'&&input.ordinal!==undefined)invalid('Only MPR result edits accept an ordinal.');
    if(['HBIN_PF','SBIN_PF'].includes(input.field)&&!['P','F',' '].includes(input.value))invalid('Bin outcome must be P, F, or a space for unknown.');
    patchRecord(r.bytes,[input],opened.manifest.byteOrder);
    const before=input.ordinal===undefined?d.values[input.field]:d.values[input.field]?.[input.ordinal];
    edits.push({seq:input.seq,name:d.name,field:input.field,value:input.value,...(input.ordinal===undefined?{}:{ordinal:input.ordinal}),before:Number.isFinite(before)||typeof before==='string'?before:typeof before==='number'?String(before):null});
    if(r.device_id)devices.add(r.device_id);
  }
  let remap=null,remapped=0;
  if(options.remap) {
    const r=options.remap;if(!['soft','hard'].includes(r.kind)||!['pass','fail','preserve'].includes(r.outcome)||![r.from,r.to].every((n)=>Number.isInteger(n)&&n>=0&&n<=65535))invalid('Choose a bin kind, numbers 0–65535, and explicit outcome.');
    remap={kind:r.kind,from:r.from,to:r.to,outcome:r.outcome};
    remapped=opened.db.selectValue(`SELECT count(*) FROM devices WHERE ${r.kind==='soft'?'soft_bin':'hard_bin'}=?`,[r.from]);
  }
  const insertRecords=[];
  for(const r of options.insertRecords??[]) {
    if(!['HBR','SBR','DTR'].includes(r?.name))invalid('Only bin definitions and DTR notes can be inserted.');
    if(!r.fields||typeof r.fields!=='object')invalid('Inserted record fields are missing.');
    const f={...r.fields};if(['HBR','SBR'].includes(r.name)){const p=r.name==='HBR'?'HBIN':'SBIN';if(f[`${p}_CNT`]!==undefined&&f[`${p}_CNT`]!==0)invalid('Bin counts are computed from parts.');f[`${p}_CNT`]=0;if(!['P','F',' '].includes(f[`${p}_PF`]))invalid('Bin outcome must be P, F, or a space.');validateSummaryScope(f);}
    encodeRecord(r.name,f,opened.manifest.byteOrder);insertRecords.push({name:r.name,fields:f});
  }
  const deleteSeqs=[];
  for(const seq of options.deleteSeqs??[]) {const r=await recordAt(opened,seq),d=readRecord(r.bytes,opened.manifest.byteOrder);if(!['SBR','HBR','TSR','DTR'].includes(d.name))invalid('Only optional bin, test summary and note records can be deleted.');if(deleteSeqs.includes(seq)||edits.some((e)=>e.seq===seq))invalid('A record cannot be deleted twice or edited and deleted.');deleteSeqs.push(seq);}
  const deleteDevices=options.deleteDevices?.length?await validateDeviceDeletes(opened,options.deleteDevices,devices,context):[];
  if(edits.some(e=>e.name==='TSR')&&(deleteDevices.length||edits.some(e=>['PTR','MPR'].includes(e.name))))invalid('TSR records are removed when results or attempts change; apply summary edits in a separate revision.');
  const effects=await metadataEffects(opened,edits,insertRecords,deleteSeqs,context);
  if(edits.length+insertRecords.length+deleteSeqs.length+deleteDevices.length+effects.relatedEdits.length>MAX_CHANGES)invalid('The revision and its related wafer-reference changes exceed 10,000 changes.');
  if(remap){const column=remap.kind==='soft'?'soft_bin':'hard_bin',field=remap.kind==='soft'?'SOFT_BIN':'HARD_BIN';for(const id of deleteDevices)if(opened.db.selectValue(`SELECT ${column} FROM devices WHERE id=?`,[id])===remap.from)remapped--;for(const e of edits)if(e.name==='PRR'&&e.field===field)remapped+=Number(e.value===remap.from)-Number(e.before===remap.from);}
  const plan={format:'semidata-edit-plan',version:1,datasetId:opened.dataset.id,sourceSha256:opened.manifest.source.sha256,createdAt:options.createdAt??new Date().toISOString(),reason:options.reason.trim(),edits,remap,insertRecords,deleteSeqs,deleteDevices,...effects};
  if(typeof plan.createdAt!=='string'||!Number.isFinite(Date.parse(plan.createdAt)))invalid('Invalid revision timestamp.');
  if(jsonBytes(plan).length>MAX_PLAN)invalid('Normalized edit plan exceeds 1 MiB.');
  return {plan,changes:edits.length+insertRecords.length+deleteSeqs.length+deleteDevices.length+effects.relatedEdits.length,affectedDevices:devices.size,deletedDevices:deleteDevices.length,remappedDevices:remapped,
    warnings:['Original files are unchanged.','Changed values preserve original test flags; use explicit reclassification to change part outcomes.','Derived part/bin/wafer summaries are recomputed from recorded attempts; unavailable retest and functional counts are marked unknown.','TSR records are removed when measurements or attempt membership change.',...(effects.rebuiltSummaries.length?['Retargeted TSR execution/failure/alarm counts are rebuilt. Their timing and result aggregates are marked invalid; unavailable verdicts produce an unknown failure count.']:[])]};
}
function editMap(plan) {const map=new Map();for(const e of [...plan.edits,...(plan.relatedEdits??[])]){if(!map.has(e.seq))map.set(e.seq,[]);map.get(e.seq).push(e);}return map;}
function adjusted(record,plan,map,order) {
  let bytes=map.has(record.seq)?patchRecord(record.bytes,map.get(record.seq),order):record.bytes;
  if(record.type===5&&record.subtype===20&&plan.remap){const f=readRecord(bytes,order).values,r=plan.remap,key=r.kind==='soft'?'SOFT_BIN':'HARD_BIN';if(f[key]===r.from){const edits=[{field:key,value:r.to}];if(r.outcome!=='preserve')edits.push({field:'PART_FLG',value:(f.PART_FLG&~24)|(r.outcome==='fail'?8:0)});bytes=patchRecord(bytes,edits,order);}}
  return bytes;
}
const emptyCounts=()=>({part:0,good:0,abort:0});
function addCount(c,f){c.part++;if((f.PART_FLG&28)===0)c.good++;if(f.PART_FLG&4)c.abort++;}
function countPatch(c){return [{field:'PART_CNT',value:c.part},{field:'RTST_CNT',value:4294967295},{field:'ABRT_CNT',value:c.abort},{field:'GOOD_CNT',value:c.good},{field:'FUNC_CNT',value:4294967295}];}
async function summaries(opened,plan,map,context) {
  const scopes=new Map(),wafers=new Map(),active=new Map(),attempts=new Map(),bins=new Map(),removed=new Set(plan.deleteDevices??[]),tests=createTestSummaryCounters(plan.rebuiltSummaries);
  const count=(key,f)=>{if(!scopes.has(key))scopes.set(key,emptyCounts());addCount(scopes.get(key),f);};
  for await(const r of records(opened,context)){
    if(removed.has(r.device_id))continue;
    tests.observe(r,opened.manifest.byteOrder);
    if(r.type===2&&r.subtype===10){const f=readRecord(r.bytes,opened.manifest.byteOrder).values;active.set(f.HEAD_NUM,r.seq);wafers.set(r.seq,emptyCounts());}
    if(r.type===5&&r.subtype===10){const f=readRecord(r.bytes,opened.manifest.byteOrder).values;attempts.set(`${f.HEAD_NUM}/${f.SITE_NUM}`,active.get(f.HEAD_NUM));}
    if(r.type===5&&r.subtype===20){const f=readRecord(adjusted(r,plan,map,opened.manifest.byteOrder),opened.manifest.byteOrder).values;
      for(const key of new Set([`${f.HEAD_NUM}/${f.SITE_NUM}`,`${f.HEAD_NUM}/255`,'255/255']))count(key,f);
      const key=`${f.HEAD_NUM}/${f.SITE_NUM}`,wafer=attempts.get(key);if(wafer!==undefined)addCount(wafers.get(wafer),f);attempts.delete(key);
      for(const kind of ['hard','soft'])for(const scope of new Set([`${f.HEAD_NUM}/${f.SITE_NUM}`,`${f.HEAD_NUM}/255`,'255/255'])){const n=kind==='hard'?f.HARD_BIN:f.SOFT_BIN,k=`${kind}/${scope}/${n}`;bins.set(k,(bins.get(k)??0)+1);}
      if(scopes.size+bins.size+wafers.size>200000)invalid('Derived summary exceeds 200,000 scoped bins/wafer records.');
    }
    if(r.type===2&&r.subtype===20){const f=readRecord(r.bytes,opened.manifest.byteOrder).values;active.delete(f.HEAD_NUM);}
  }
  return {scopes,wafers,bins,tests};
}
function withMissingCounts(bytes,edits,order) {
  // Counts are optional tails in PCR. Populate preceding count fields explicitly.
  const d=readRecord(bytes,order),values={...d.values};for(const e of edits)values[e.field]=e.value;
  const s=RECORD_SCHEMAS[d.name],last=s.fields.findLastIndex(([n])=>Object.hasOwn(values,n));
  for(let i=0;i<=last;i++){const [n,t]=s.fields[i];if(!Object.hasOwn(values,n)){if(t==='Cn')values[n]='';else if(['RTST_CNT','ABRT_CNT','GOOD_CNT','FUNC_CNT'].includes(n))values[n]=4294967295;else invalid(`Cannot reconstruct omitted ${d.name}.${n}.`);}}
  return encodeRecord(d.name,values,order);
}
async function* derivedBytes(opened,plan,context) {
  const order=opened.manifest.byteOrder,map=editMap(plan),totals=await summaries(opened,plan,map,context),deleted=new Set(plan.deleteSeqs),removed=new Set(plan.deleteDevices??[]),active=new Map();
  const measurementChanged=removed.size>0||plan.edits.some((e)=>['PTR','MPR'].includes(e.name));let hadPcr=false;
  for await(const r of records(opened,context)) {
    if(removed.has(r.device_id)||deleted.has(r.seq)||(measurementChanged&&r.type===10&&r.subtype===30))continue;
    let bytes=adjusted(r,plan,map,order);
    if(r.type===10&&r.subtype===30){const counters=totals.tests.forSequence(r.seq);if(counters)bytes=withMissingCounts(bytes,Object.entries(counters).map(([field,value])=>({field,value})),order);}
    if(r.type===2&&r.subtype===10){const f=readRecord(bytes,order).values;active.set(f.HEAD_NUM,r.seq);}
    if(r.type===1&&r.subtype===30){hadPcr=true;const f=readRecord(bytes,order).values;bytes=withMissingCounts(bytes,countPatch(totals.scopes.get(`${f.HEAD_NUM}/${f.SITE_NUM}`)??emptyCounts()),order);}
    if(r.type===2&&r.subtype===20){const f=readRecord(bytes,order).values;bytes=withMissingCounts(bytes,countPatch(totals.wafers.get(active.get(f.HEAD_NUM))??emptyCounts()),order);active.delete(f.HEAD_NUM);}
    if(r.type===1&&[40,50].includes(r.subtype)){const f=readRecord(bytes,order).values,p=r.subtype===40?'HBIN':'SBIN',kind=r.subtype===40?'hard':'soft';bytes=patchRecord(bytes,[{field:`${p}_CNT`,value:totals.bins.get(`${kind}/${f.HEAD_NUM}/${f.SITE_NUM}/${f[`${p}_NUM`]}`)??0}],order);}
    if(r.type===1&&r.subtype===20){
      if(!hadPcr){const c=totals.scopes.get('255/255')??emptyCounts();yield encodeRecord('PCR',{HEAD_NUM:255,SITE_NUM:255,PART_CNT:c.part,RTST_CNT:4294967295,ABRT_CNT:c.abort,GOOD_CNT:c.good,FUNC_CNT:4294967295},order);}
      for(const record of plan.insertRecords){const f={...record.fields};if(['HBR','SBR'].includes(record.name)){const p=record.name==='HBR'?'HBIN':'SBIN',kind=record.name==='HBR'?'hard':'soft';f[`${p}_CNT`]=totals.bins.get(`${kind}/${f.HEAD_NUM}/${f.SITE_NUM}/${f[`${p}_NUM`]}`)??0;}yield encodeRecord(record.name,f,order);}
    }
    yield bytes;
    if(r.seq===1)yield encodeRecord('ATR',{MOD_TIM:Math.floor(Date.parse(plan.createdAt)/1000),CMD_LINE:`SemiData revision ${plan.reason.replace(/[^\x20-\x7e]/g,'?')}`.slice(0,255)},order);
  }
}
async function makeOutput(extension,context,produce) {
  const dir=await directory(),token=`${crypto.randomUUID()}.${extension}`,handle=await dir.getFileHandle(token,{create:true});let writable,complete=false,bytes=0;
  try {writable=await handle.createWritable();const sink={async write(chunk){context.checkCancelled();bytes+=chunk.byteLength;if(bytes>16*1024**3)invalid('Output exceeds 16 GiB.');await writable.write(chunk);}};
    const receipt=await produce(sink);context.checkCancelled();await writable.close();writable=null;const file=await handle.getFile();complete=true;return {file,filename:token,token,kind:'authoring',receipt};
  }finally{await writable?.abort().catch(()=>{});if(!complete)await dir.removeEntry(token).catch(()=>{});}
}
async function validatePlan(opened,input,context) {
  if(input.format!=='semidata-edit-plan'||input.version!==1||input.datasetId!==opened.dataset.id||input.sourceSha256!==opened.manifest.source.sha256)invalid('Edit plan does not match this source.');
  return (await preview(opened,input,context)).plan;
}
async function writeStdf(opened,plan,sink,context) {
  const runtime=await loadParser(),parser=plan?new runtime.RetainedParserV2():null;let buffered=[],size=0,total=0;
  try {
    const flush=async()=>{if(!size)return;total+=size;if(total>2*1024**3)invalid('Derived STDF exceeds the 2 GiB source limit.');const bytes=joinBytes(buffered);parser?.push(bytes);await sink.write(bytes);buffered=[];size=0;};
    if(!plan){for(let pos=0;pos<opened.file.size;pos+=65536){await sink.write(new Uint8Array(await opened.file.slice(pos,pos+65536).arrayBuffer()));if(pos%1048576===0)await pause();}}
    else for await(const bytes of derivedBytes(opened,plan,context)){buffered.push(bytes);size+=bytes.length;if(size>=65536)await flush();}
    await flush();const validation=parser?JSON.parse(parser.finish()):null;return {validation,sourceSha256:opened.manifest.source.sha256,revision:plan,originalUnchanged:true};
  }finally{parser?.free();}
}
async function exportStdf(store,message,context) {
  const options=message.options??{};member(message,options.datasetId);const opened=await store.access(options.datasetId);
  try {const plan=options.plan?await validatePlan(opened,options.plan,context):null;
    if(await hashFile(opened.file,context)!==opened.manifest.source.sha256)invalid('Original source checksum no longer matches.');
    const result=await makeOutput('stdf',context,(sink)=>writeStdf(opened,plan,sink,context));result.filename=`${safeName(opened.manifest.source.name).replace(/\.(stdf|std|stf)$/i,'')}${plan?'-derived':''}.stdf`;return result;
  }finally{opened.db.close();}
}
function asStream(iterator,context) {return new ReadableStream({async pull(controller){try{context.checkCancelled();const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(next.value);}catch(error){controller.error(error);await iterator.return?.();}},async cancel(){await iterator.return?.();}});}
const csvCell=(v)=>{let s=v==null?'':String(v);if(typeof v==='string'&&/^[\s]*[=+@-]|^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
async function* csvRows(store,id,plan,context) {
  const cache=await ensureViewerCache(store,id,context),db=new store.pool.OpfsSAHPoolDb(cache.path,'r'),map=plan?editMap(plan):new Map(),removed=new Set(plan?.deleteDevices??[]);
  const headers=['record','ordinal','device','family','test','name','head','site','partId','hardBin','softBin','partFlags','value','unit','low','high','testFlags','parameterFlags','rawBits','channel'];
  const stmt=db.prepare('SELECT o.*,t.family,t.number,t.name,d.part_id,d.hard_bin,d.soft_bin,d.part_flags,d.prr_seq FROM observations o JOIN tests t ON t.id=o.test_id JOIN devices d ON d.id=o.device_id ORDER BY o.seq,o.ordinal');
  try {yield encoder.encode('\uFEFF'+headers.map(csvCell).join(',')+'\r\n');let count=0;
    while(stmt.step()){context.checkCancelled();const r=stmt.get({});if(removed.has(r.device_id))continue;for(const e of map.get(r.seq)??[])if((e.field==='RESULT'||e.field==='RTN_RSLT'&&e.ordinal===r.ordinal)){r.value=Math.fround(e.value);const b=new ArrayBuffer(4),v=new DataView(b);v.setFloat32(0,r.value,true);r.raw_bits=v.getUint32(0,true);}
      for(const e of map.get(r.prr_seq)??[]){const key={HARD_BIN:'hard_bin',SOFT_BIN:'soft_bin',PART_FLG:'part_flags',PART_ID:'part_id'}[e.field];if(key)r[key]=e.value;}
      if(plan?.remap){const m=plan.remap,key=m.kind==='soft'?'soft_bin':'hard_bin';if(r[key]===m.from){r[key]=m.to;if(m.outcome!=='preserve')r.part_flags=(r.part_flags&~24)|(m.outcome==='fail'?8:0);}}
      yield encoder.encode([r.seq,r.ordinal,r.device_id,r.family,r.number,r.name,r.head,r.site,r.part_id,r.hard_bin,r.soft_bin,r.part_flags,r.value,r.unit,r.low,r.high,r.test_flags,r.parm_flags,r.raw_bits,r.channel].map(csvCell).join(',')+'\r\n');if(++count%1024===0)await pause();
    }
  }finally{stmt.finalize();db.close();}
}
async function* jsonRecords(opened,plan,context) {
  yield encoder.encode('{"format":"semidata-records","version":1,"source":'+JSON.stringify(opened.manifest.source)+',"revision":'+JSON.stringify(plan)+',"records":[');
  const runtime=await loadParser();let index=0,offset=0;
  const iterator=plan?derivedBytes(opened,plan,context):(async function*(){for await(const r of records(opened,context))yield r.bytes;})();
  for await(const bytes of iterator){const decoded=JSON.parse(runtime.decode_record(bytes,opened.manifest.byteOrder));yield encoder.encode((index?',':'')+JSON.stringify({seq:++index,offset,length:bytes.length,...decoded,rawHex:Array.from(bytes,(b)=>b.toString(16).padStart(2,'0')).join('')}));offset+=bytes.length;}
  yield encoder.encode(']}');
}
async function convert(store,message,context) {
  const options=message.options??{},ids=options.datasetIds,formats=options.formats;
  if(!Array.isArray(ids)||!ids.length||ids.length>8||new Set(ids).size!==ids.length)invalid('Choose one to eight distinct sources.');ids.forEach((id)=>member(message,id));
  if(!Array.isArray(formats)||!formats.length||new Set(formats).size!==formats.length||formats.some((f)=>!['csv','json','stdf','original'].includes(f)))invalid('Supported conversion formats are CSV, record JSON, original STDF and derived STDF.');
  const result=await makeOutput('zip',context,async(sink)=>{
    const zip=new ZipWriter(new WritableStream({write:(b)=>sink.write(b)}),{level:0,zip64:true,useWebWorkers:false,bufferedWrite:false,preventClose:true}),receipt={format:'semidata-conversion',version:1,createdAt:new Date().toISOString(),files:[]};
    try {for(const [i,id] of ids.entries()) {const opened=await store.access(id);try {
      const plan=options.plans?.[id]?await validatePlan(opened,options.plans[id],context):null;
      if(await hashFile(opened.file,context)!==opened.manifest.source.sha256)invalid('Original source checksum no longer matches.');
      for(const format of formats){context.checkCancelled();const name=`${i+1}-${safeName(opened.manifest.source.name)}${format==='original'?'-original':plan?'-derived':''}.${format==='original'?'stdf':format}`;
        if(format==='original')await zip.add(name,opened.file.stream(),{level:0});
        else if(format==='stdf') {const saved=await exportStdf(store,{...message,options:{datasetId:id,plan}},context);try{await zip.add(name,saved.file.stream(),{level:0});}finally{await(await directory()).removeEntry(saved.token);}}
        else await zip.add(name,asStream(format==='csv'?csvRows(store,id,plan,context):jsonRecords(opened,plan,context),context),{level:0});
        receipt.files.push({datasetId:id,sourceSha256:opened.manifest.source.sha256,name,format,derived:!!plan&&format!=='original',status:'complete'});
      }
      if(plan)await zip.add(`${i+1}-revision.json`,new TextReader(JSON.stringify(plan,null,2)),{level:0});
      context.progress({phase:'convert',completedSources:i+1,totalSources:ids.length});
    }finally{opened.db.close();}}
    await zip.add('receipt.json',new TextReader(JSON.stringify(receipt,null,2)),{level:0});await zip.close();return receipt;
    }catch(error){await zip.close().catch(()=>{});throw error;}
  });result.filename='semidata-conversion.zip';return result;
}
export async function runViewerAuthoring(store,message,context) {
  const options=message.options??{};
  if(message.action==='release'){const token=options.token??message.token;if(typeof token!=='string'||!AUTHORING_TOKEN.test(token))invalid('Invalid authored-output token.');try{await(await directory()).removeEntry(token);}catch(e){if(e.name!=='NotFoundError')throw e;}return {released:true};}
  if(message.action==='export')return exportStdf(store,message,context);
  if(message.action==='convert')return convert(store,message,context);
  if(message.action==='importAtdf'){const {importAtdf}=await import('./atdf-import.js');return importAtdf(store,options,context);}
  if(['atdfSources','atdfOriginal'].includes(message.action)){member(message,options.datasetId);const {atdfSources}=await import('./atdf-import.js');return atdfSources(store,options,context,message.action==='atdfOriginal');}
  if(!['preview','edit'].includes(message.action))invalid('Unknown authoring action.');
  member(message,options.datasetId);const opened=await store.access(options.datasetId);
  try {const result=await preview(opened,options,context);if(message.action==='edit'){
    const saved=await makeOutput('json',context,async(sink)=>{await sink.write(jsonBytes(result.plan));return {sourceSha256:result.plan.sourceSha256,changes:result.changes};});return {...result,...saved,filename:'revision.json',revisionId:saved.token};
  }return result;}finally{opened.db.close();}
}
