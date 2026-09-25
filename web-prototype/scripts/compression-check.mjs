import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const repository = resolve(root, ".."), site = resolve(root, "site");
const channel = process.argv[2] ?? "chrome";
if (!["chrome", "msedge"].includes(channel)) throw new Error("Use chrome or msedge");
const output = resolve(root, "results", `compression-${channel}-${Date.now()}`);
const fixtures = resolve(output, "fixtures");
await mkdir(fixtures, { recursive: true });
function python(args) {
  const result = spawnSync(resolve(repository, ".venv/Scripts/python.exe"), args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "Fixture generator failed");
}
python([resolve(root, "scripts/make-library-fixtures.py"), fixtures]);
const generator = String.raw`
import bz2, gzip, io, json, pathlib, struct, sys, zipfile, zlib
p=pathlib.Path(sys.argv[1]); raw=(p/'golden-little.stdf').read_bytes()
def save(name,data): (p/name).write_bytes(data)
def zipped(data=raw, method=zipfile.ZIP_DEFLATED, entries=1, mode=None):
  b=io.BytesIO()
  with zipfile.ZipFile(b,'w',compression=method) as z:
    for n in range(entries):
      if mode is None: z.writestr(f'directory/{n}.stdf',data)
      else:
        info=zipfile.ZipInfo('sample.stdf'); info.create_system=3; info.external_attr=mode<<16
        z.writestr(info,data)
  return b.getvalue()
save('golden.stdf.gz',gzip.compress(raw,mtime=0)); save('golden.stdf.bz2',bz2.compress(raw))
save('gzip-concat.gz',gzip.compress(raw[:200],mtime=0)+gzip.compress(raw[200:],mtime=0))
save('bzip-concat.bz2',bz2.compress(raw[:200])+bz2.compress(raw[200:]))
for name,method in [('store',0),('deflate',8),('bzip',12)]: save(name+'.zip',zipped(method=method))
save('multiple.zip',zipped(entries=2)); save('symlink.zip',zipped(mode=0o120777)); save('fifo.zip',zipped(mode=0o010600))
b=io.BytesIO()
with zipfile.ZipFile(b,'w') as z: z.writestr('only-directory/','')
save('directory.zip',b.getvalue())
original=zipped(); central=original.index(b'PK\x01\x02')
def mutant(name, changes):
  d=bytearray(original)
  for offset,value in changes: d[offset:offset+len(value)]=value
  save(name,bytes(d))
mutant('encrypted.zip',[(6,b'\x01\x00'),(central+8,b'\x01\x00')])
mutant('crc.zip',[(14,struct.pack('<I',123)),(central+16,struct.pack('<I',123))])
mutant('local-mismatch.zip',[(8,struct.pack('<H',0))])
mutant('unsupported.zip',[(8,struct.pack('<H',99)),(central+10,struct.pack('<H',99))])
mutant('metadata-bound.zip',[(len(original)-10,struct.pack('<I',2*1024*1024))])
save('truncated.zip',original[:-4]); save('trailing.zip',original+b'junk')
for name in ['golden.stdf.gz','golden.stdf.bz2']:
  d=(p/name).read_bytes(); save('truncated-'+name,d[:-2]); save('trailing-'+name,d+b'garbage')
  bad=bytearray(d); bad[(-8 if name.endswith('gz') else 10)]^=1; save('crc-'+name,bad)
bad=bytearray((p/'golden.stdf.bz2').read_bytes()); bad[-3]^=1; save('bzip-stream-crc.bz2',bad)
bad=bytearray((p/'golden.stdf.gz').read_bytes()); bad[-4]^=1; save('gzip-size.gz',bad)
large=bytes((i*73+i//1024)%251 for i in range(3*1024*1024+123))
save('large.raw',large); save('large.bz2',bz2.compress(large)); save('large.gz',gzip.compress(large,mtime=0))
for cut in range(65500,65536):
  first=gzip.compress(large[:cut],compresslevel=0,mtime=0)
  if len(first)==65536:
    save('gzip-boundary.gz',first+gzip.compress(large[cut:],mtime=0)); break
else: raise AssertionError('No exact input-boundary gzip fixture')
save('large.zip',zipped(large)); save('large-bzip.zip',zipped(large,12))
for name,data in [('bomb.gz',gzip.compress(bytes(65536))),('bomb.bz2',bz2.compress(bytes(65536))),('bomb.zip',zipped(bytes(65536)))]: save(name,data)
# Independent xxHash64 fixture implementation for checksummed raw Zstd frames.
M=(1<<64)-1; P1=11400714785074694791; P2=14029467366897019727; P3=1609587929392839161; P4=9650029242287828579; P5=2870177450012600261
def rol(n,r): return ((n<<r)|(n>>(64-r)))&M
def rnd(a,b): return (rol((a+b*P2)&M,31)*P1)&M
def xxh(d):
  n=len(d); i=0
  if n>=32:
    v=[(P1+P2)&M,P2,0,(-P1)&M]
    while i<=n-32:
      for j in range(4): v[j]=rnd(v[j],int.from_bytes(d[i+j*8:i+j*8+8],'little'))
      i+=32
    h=sum(rol(v[j],[1,7,12,18][j]) for j in range(4))&M
    for a in v: h=((h^rnd(0,a))*P1+P4)&M
  else: h=P5
  h=(h+n)&M
  while i<=n-8: h=(rol(h^rnd(0,int.from_bytes(d[i:i+8],'little')),27)*P1+P4)&M; i+=8
  if i<=n-4: h=(rol(h^(int.from_bytes(d[i:i+4],'little')*P1&M),23)*P2+P3)&M; i+=4
  while i<n: h=(rol(h^(d[i]*P5&M),11)*P1)&M; i+=1
  h^=h>>33; h=h*P2&M; h^=h>>29; h=h*P3&M; return h^(h>>32)
assert xxh(b'')==0xef46db3751d8e999
def zstd(d, checksum=True):
  h=b'\x28\xb5\x2f\xfd'+bytes([0xa0 | (4 if checksum else 0)])+struct.pack('<I',len(d))
  for pos in range(0,len(d),131072):
    part=d[pos:pos+131072]; h+=((len(part)<<3)|(pos+len(part)==len(d))).to_bytes(3,'little')+part
  if checksum: h+=struct.pack('<I',xxh(d)&0xffffffff)
  return h
def zip_payload(payload,data=raw,method=93):
  name=b'raw.stdf'; crc=zlib.crc32(data); cs=len(payload); size=len(data)
  local=struct.pack('<IHHHHHIIIHH',0x04034b50,63,0,method,0,0,crc,cs,size,len(name),0)+name+payload
  directory=struct.pack('<IHHHHHHIIIHHHHHII',0x02014b50,63,63,0,method,0,0,crc,cs,size,len(name),0,0,0,0,0,0)+name
  return local+directory+struct.pack('<IHHHHIIH',0x06054b50,0,0,1,1,len(directory),len(local),0)
save('zstd.zip',zip_payload(zstd(raw))); save('zstd-concat.zip',zip_payload(zstd(raw[:200])+zstd(raw[200:])))
bad=bytearray(zstd(raw)); bad[-1]^=1; save('zstd-crc.zip',zip_payload(bad))
save('zstd-truncated.zip',zip_payload(zstd(raw)[:-1])); save('large-zstd.zip',zip_payload(zstd(large),large))
save('zstd-window.zip',zip_payload(b'\x28\xb5\x2f\xfd\x00\x88'+b'\x01\x00\x00'))
save('zstd-dictionary.zip',zip_payload(b'\x28\xb5\x2f\xfd\x21\x01\x00\x01\x00\x00'))
save('misnamed.gz',raw)
`;
const generatorPath = resolve(output, "fixtures.py");
await writeFile(generatorPath, generator); python([generatorPath, fixtures]);
const golden = JSON.parse(await readFile(resolve(fixtures, "expected.json"), "utf8")).files["golden-little.stdf"];
const largeHash = createHash("sha256").update(await readFile(resolve(fixtures, "large.raw"))).digest("hex");
const worker = `
import { prepareSource } from './compressed-source.js';
import { libraryError } from './dataset-schema.js';
let cancelled = false;
const leftovers = async () => {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('semidata-decompression-v1',{create:true});
  const entries=[]; for await (const [name] of root.entries()) entries.push(name); return entries;
};
self.onmessage = async ({data}) => {
  if(data.type==='cancel'){cancelled=true;return;}
  cancelled=false; let prepared, store, maxRead=0, maxWrite=0;
  const originalRead=Blob.prototype.arrayBuffer, originalSyncRead=FileReaderSync.prototype.readAsArrayBuffer, originalWrite=FileSystemSyncAccessHandle.prototype.write;
  const context={checkCancelled(){if(cancelled)throw libraryError('CANCELLED','Test cancellation');},progress(p){self.postMessage({progress:p});}};
  try {
    const blob=await (await fetch('/fixture/'+data.name)).blob();
    let file=new File([blob],data.name,{lastModified:123});
    if(data.huge) file=new (class extends File{get size(){return 2147483649;}})(['tiny'],'large.gz');
    Blob.prototype.arrayBuffer=function(){maxRead=Math.max(maxRead,this.size);if(this.size>1048576)throw Error('Test: oversized blob read');return originalRead.call(this);};
    FileReaderSync.prototype.readAsArrayBuffer=function(blob){maxRead=Math.max(maxRead,blob.size);if(blob.size>65536)throw Error('Test: oversized synchronous read');return originalSyncRead.call(this,blob);};
    FileSystemSyncAccessHandle.prototype.write=function(bytes, options){maxWrite=Math.max(maxWrite,bytes.byteLength);if(data.quota)throw new DOMException('Injected quota exhaustion','QuotaExceededError');return originalWrite.call(this,bytes,options);};
    const fn=data.small ? (await import('./compressed-source-small.js')).prepareSource : prepareSource;
    prepared=await fn(file,context);
    Blob.prototype.arrayBuffer=originalRead; FileReaderSync.prototype.readAsArrayBuffer=originalSyncRead; FileSystemSyncAccessHandle.prototype.write=originalWrite;
    const {hashFile}=await import('./import-source.js');
    const hash=await hashFile(prepared.file,{checkCancelled(){},progress(){}});
    let imported;
    if(data.import){
      const {LibraryStore}=await import('./library-store.js'); const {importSource}=await import('./import-source.js');
      store=new LibraryStore(); await store.open(); imported=await importSource(store,prepared.file,prepared.file.name,context);
    }
    const result={hash,size:prepared.file.size,name:prepared.file.name,maxRead,maxWrite,imported};
    await prepared.cleanup(); await prepared.cleanup(); prepared=null;
    await store?.close(); store=null;
    self.postMessage({ok:true,result:{...result,leftovers:await leftovers()}});
  }catch(error){
    Blob.prototype.arrayBuffer=originalRead; FileReaderSync.prototype.readAsArrayBuffer=originalSyncRead; FileSystemSyncAccessHandle.prototype.write=originalWrite;
    await prepared?.cleanup(); await store?.close();
    self.postMessage({ok:false,error:{code:error.code,message:error.message},maxRead,maxWrite,leftovers:await leftovers()});
  }
};`;
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    response.setHeader("Content-Type", "text/javascript");
    if (pathname === "/__compression-worker.js") return response.end(worker);
    if (pathname === "/compressed-source-small.js") {
      const source = await readFile(resolve(site, "compressed-source.js"), "utf8");
      return response.end(source.replace("MAX_SOURCE_BYTES, libraryError", "libraryError").replace("const CHUNK_BYTES", "const MAX_SOURCE_BYTES = 4096;\nconst CHUNK_BYTES"));
    }
    if (pathname === "/__compression.html") { response.setHeader("Content-Type", "text/html"); return response.end("<!doctype html><title>Isolated compression checks</title>"); }
    const base = pathname.startsWith("/fixture/") ? fixtures : site;
    const path = resolve(base, "." + (base === fixtures ? pathname.slice(8) : pathname));
    if (!path.startsWith(base + sep)) throw new Error("Outside root");
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm" })[extname(path)] ?? "application/octet-stream");
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end("Not found"); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const checks = [], results = [], pageErrors = [], externalRequests = [];
let context;
try {
  context = await chromium.launchPersistentContext(resolve(output, "profile"), { channel, headless: true });
  context.setDefaultTimeout(60000);
  context.on("request", (request) => { if (!request.url().startsWith(origin)) externalRequests.push(request.url()); });
  const page = await context.newPage(); page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${origin}/__compression.html`);
  async function run(name, options = {}) {
    const result = await page.evaluate(({name,options}) => new Promise((resolve, reject) => {
      const worker=new Worker('./__compression-worker.js',{type:'module'});
      const timer=setTimeout(()=>{worker.terminate();reject(Error('Compression check timed out: '+name));},60000);
      let cancelSent=false;
      worker.onerror=(event)=>{clearTimeout(timer);worker.terminate();reject(Error(event.message));};
      worker.onmessage=({data})=>{
        if(data.progress){if(options.cancel && !cancelSent && data.progress.expandedBytes>0){cancelSent=true;worker.postMessage({type:'cancel'});}return;}
        clearTimeout(timer);worker.terminate();resolve({...data,cancelSent});
      };
      worker.postMessage({name,...options});
    }), { name, options });
    results.push({ name, options, ...result });
    assert.deepEqual(result.result?.leftovers ?? result.leftovers, [], `No temporary artifacts remain after ${name}`);
    return result;
  }
  for (const name of ["golden.stdf.gz", "golden.stdf.bz2", "gzip-concat.gz", "bzip-concat.bz2", "store.zip", "deflate.zip", "bzip.zip", "zstd.zip", "zstd-concat.zip", "misnamed.gz"]) {
    const result = await run(name, { import: true });
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.error)}`);
    assert.equal(result.result.hash, golden.sourceSha256); assert.equal(result.result.size, golden.sourceBytes);
    assert.deepEqual(result.result.imported.dataset.manifest.counts, golden.counts);
    assert.equal(result.result.imported.duplicate, name !== "golden.stdf.gz");
  }
  checks.push("GZ/BZ2/ZIP STORE, DEFLATE, BZIP2 and checksummed Zstandard expand exactly; concatenated streams, misleading suffix and real SQLite import deduplication preserve one known source hash");
  for (const name of ["multiple.zip", "symlink.zip", "fifo.zip", "directory.zip", "encrypted.zip", "crc.zip", "local-mismatch.zip", "unsupported.zip", "metadata-bound.zip", "truncated.zip", "trailing.zip", "truncated-golden.stdf.gz", "trailing-golden.stdf.gz", "crc-golden.stdf.gz", "gzip-size.gz", "truncated-golden.stdf.bz2", "trailing-golden.stdf.bz2", "crc-golden.stdf.bz2", "bzip-stream-crc.bz2", "zstd-crc.zip", "zstd-truncated.zip", "zstd-window.zip", "zstd-dictionary.zip"]) {
    const result = await run(name); assert.equal(result.ok, false, `${name} must fail`);
    assert.ok(["INVALID_COMPRESSED_SOURCE", "UNSUPPORTED_COMPRESSION", "SOURCE_TOO_LARGE"].includes(result.error.code), `${name}: ${JSON.stringify(result.error)}`);
  }
  checks.push("Malformed, corrupt, truncated, encrypted, multi-entry, directory/link/special-file, oversized metadata and unsupported ZIP/Zstandard inputs fail explicitly and clean their temporary files");
  for (const name of ["large.gz", "gzip-boundary.gz", "large.bz2", "large.zip", "large-bzip.zip", "large-zstd.zip"]) {
    const result = await run(name); assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.error)}`);
    assert.equal(result.result.hash, largeHash); assert.ok(result.result.maxRead <= 1048576); assert.ok(result.result.maxWrite <= 65536);
  }
  checks.push("Multi-block 3 MiB outputs agree byte-for-byte with independent fixtures; each JavaScript blob read <=1 MiB and OPFS write <=64 KiB");
  for (const name of ["bomb.gz", "bomb.bz2", "bomb.zip"]) {
    const result = await run(name, { small: true }); assert.equal(result.ok, false); assert.equal(result.error.code, "SOURCE_TOO_LARGE");
  }
  assert.equal((await run("golden.stdf.gz", { huge: true })).error.code, "SOURCE_TOO_LARGE");
  checks.push("Test-only 4 KiB expansion cap rejects compressed bombs before excess writes; synthetic >2 GiB compressed input rejects before reading");
  for (const name of ["large.gz", "large.bz2", "large.zip", "large-bzip.zip", "large-zstd.zip"]) {
    const result = await run(name, { cancel: true }); assert.equal(result.ok, false); assert.equal(result.cancelSent, true); assert.equal(result.error.code, "CANCELLED");
  }
  assert.equal((await run("golden.stdf.gz", { quota: true })).error.code, "QUOTA_EXCEEDED");
  checks.push("Real worker cancellation in each compression path and injected OPFS quota exhaustion clean staging; no uploaded data or external requests");
  assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []);
  const evidence = { channel, passed: true, checks, results, pageErrors, externalRequests };
  await writeFile(resolve(output, "results.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ output, checks, cases: results.length }));
} catch (error) {
  await writeFile(resolve(output, "failure.json"), JSON.stringify({ error: error.stack, checks, results, pageErrors, externalRequests }, null, 2));
  throw error;
} finally { await context?.close(); await new Promise((done) => server.close(done)); }
