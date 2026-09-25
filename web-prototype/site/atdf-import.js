import { AtdfDecoder } from './atdf-codec.js';
import { joinBytes } from './stdf-encode.js';
import { loadParser, hashFile, importSource } from './import-source.js';
import { invalid } from './viewer-model.js';

const MAX_BYTES=2*1024**3, encoder=new TextEncoder();
const pause=()=>new Promise((done)=>setTimeout(done,0));
export async function atdfSources(store,options,context,download=false) {
  const opened=await store.access(options.datasetId);let dir;
  try {try{dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('semidata-atdf-originals-v1');}catch(e){if(e.name==='NotFoundError'){if(download)invalid('No saved ATDF input matches this dataset and token.');return {items:[]};}throw e;}
    const items=[];let count=0;
    for await(const [name,handle]of dir.entries()){
      context.checkCancelled();if(handle.kind!=='file'||!(/^[0-9a-f-]{36}\.json$/).test(name))continue;if(++count>1000)invalid('ATDF provenance inventory exceeds 1,000 receipts.');
      const file=await handle.getFile();if(file.size>16384)continue;let receipt;try{receipt=JSON.parse(await file.text());}catch{continue;}
      if(receipt.format!=='semidata-atdf-provenance'||receipt.version!==1||receipt.convertedSha256!==opened.manifest.source.sha256||typeof receipt.originalToken!=='string'||!(/^[0-9a-f-]{36}\.atdf$/).test(receipt.originalToken))continue;
      if(download&&receipt.originalToken===options.originalToken){const original=await(await dir.getFileHandle(receipt.originalToken)).getFile();if(await hashFile(original,context)!==receipt.originalSha256)invalid('Saved ATDF checksum does not match its receipt.');return {file:original,filename:receipt.originalName,receipt};}
      items.push(receipt);
    }
    if(download)invalid('No saved ATDF input matches this dataset and token.');return {items};
  }finally{opened.db.close();}
}
/** Preserve input ASCII independently; the retained library remains STDF-only. */
export async function importAtdf(store,options,context) {
  const {file,utcOffsetMinutes=0}=options;
  if(!(file instanceof File)||!file.size||file.size>MAX_BYTES||!/\.atdf$/i.test(file.name))invalid('Choose a nonempty .atdf file up to 2 GiB.');
  const decoder=new AtdfDecoder({utcOffsetMinutes}),root=await navigator.storage.getDirectory();
  const originals=await root.getDirectoryHandle('semidata-atdf-originals-v1',{create:true}),staging=await root.getDirectoryHandle('semidata-atdf-staging-v1',{create:true});
  const id=crypto.randomUUID(),originalToken=id+'.atdf',receiptToken=id+'.json',stdfToken=id+'.stdf';
  let sourceWrite,stdfWrite,parser,published=false;const runtime=await loadParser();
  try {
    const original=await originals.getFileHandle(originalToken,{create:true});sourceWrite=await original.createWritable();
    for(let pos=0;pos<file.size;pos+=1048576){context.checkCancelled();await sourceWrite.write(await file.slice(pos,pos+1048576).arrayBuffer());await pause();}
    await sourceWrite.close();sourceWrite=null;const source=await original.getFile(),originalSha256=await hashFile(source,context);
    const output=await staging.getFileHandle(stdfToken,{create:true});stdfWrite=await output.createWritable();parser=new runtime.RetainedParserV2();
    let bytes=0,buffer=[],buffered=0;
    const flush=async()=>{if(!buffered)return;context.checkCancelled();const chunk=joinBytes(buffer);bytes+=chunk.length;if(bytes>MAX_BYTES)invalid('Converted STDF exceeds 2 GiB.');parser.push(chunk);await stdfWrite.write(chunk);buffer=[];buffered=0;};
    const append=async(records)=>{for(const record of records){buffer.push(record);buffered+=record.length;if(buffered>=65536)await flush();}};
    for(let pos=0;pos<source.size;pos+=65536){context.checkCancelled();const input=new Uint8Array(await source.slice(pos,pos+65536).arrayBuffer());
      if(input.some((v)=>v>127))invalid('ATDF input must be ASCII.');const text=new TextDecoder().decode(input);await append(decoder.push(text));
      context.progress({phase:'atdf-conversion',completedBytes:pos+input.length,totalBytes:source.size});await pause();}
    await append(decoder.finish());await flush();const validation=JSON.parse(parser.finish());context.checkCancelled();await stdfWrite.close();stdfWrite=null;
    const converted=await output.getFile(),convertedSha256=await hashFile(converted,context);
    const receipt={format:'semidata-atdf-provenance',version:1,originalName:file.name,originalToken,originalSha256,originalBytes:source.size,convertedSha256,convertedBytes:converted.size,utcOffsetMinutes,records:decoder.records,createdAt:new Date().toISOString(),note:'Canonical STDF is retained by the library; original ATDF is preserved separately and is not included in .sdworkspace v1.'};
    // Write provenance before publication. Even an interruption after import
    // leaves the input and its conversion receipt intact.
    const receiptHandle=await originals.getFileHandle(receiptToken,{create:true}),w=await receiptHandle.createWritable();try{await w.write(encoder.encode(JSON.stringify(receipt,null,2)));context.checkCancelled();await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}
    const named=new File([converted],file.name.replace(/\.atdf$/i,'.stdf'),{type:'application/octet-stream'});
    const result=await importSource(store,named,named.name,context);published=true;
    return {...result,atdf:{...receipt,receiptToken,validation},originalFile:source,originalFilename:file.name};
  }finally{parser?.free();await sourceWrite?.abort().catch(()=>{});await stdfWrite?.abort().catch(()=>{});await staging.removeEntry(stdfToken).catch(()=>{});
    if(!published){await originals.removeEntry(originalToken).catch(()=>{});await originals.removeEntry(receiptToken).catch(()=>{});}}
}
