import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url)), site = resolve(root, 'site');
const output = resolve(root, 'results', `library-metadata-${Date.now()}`);
await mkdir(output, { recursive: true });
const channel = process.argv[2] ?? 'chrome';
if (!['chrome', 'msedge'].includes(channel)) throw new Error('Use chrome or msedge');

// Independent, tiny STDF V4 headers. No app decoder supplies expected values.
function fixture({ name, big = false, startTime = 1792324800, part = 'A-100', lot = 'LOT-1', mir = true }) {
  const u16 = (value) => { const b = Buffer.alloc(2); b[big ? 'writeUInt16BE' : 'writeUInt16LE'](value); return b; };
  const u32 = (value) => { const b = Buffer.alloc(4); b[big ? 'writeUInt32BE' : 'writeUInt32LE'](value); return b; };
  const cn = (value) => Buffer.concat([Buffer.from([Buffer.byteLength(value)]), Buffer.from(value)]);
  const record = (type, subtype, body) => Buffer.concat([u16(body.length), Buffer.from([type, subtype]), body]);
  const records = [record(0, 10, Buffer.from([big ? 1 : 2, 4]))];
  if (mir) {
    const fields = [lot, part, 'BENCH-1', 'TESTER', 'FT', 'R3', 'SUB-2'];
    records.push(record(1, 10, Buffer.concat([u32(startTime), u32(startTime), Buffer.from([1, 80, 32, 32]), u16(65535), Buffer.from([32]), ...fields.map(cn)])));
  }
  records.push(record(5, 10, Buffer.from([1, 1])));
  records.push(record(5, 20, Buffer.concat([Buffer.from([1, 1, 0]), u16(0), u16(1), u16(1), u16(32768), u16(32768), u32(20), cn(name), cn(''), Buffer.from([0])])));
  records.push(record(1, 20, Buffer.concat([u32(startTime + 1), Buffer.from([32]), cn(''), cn('')])));
  return Buffer.concat(records);
}

const server = createServer(async (request, response) => {
  try {
    const path = resolve(site, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!path.startsWith(site + sep)) throw new Error('Outside site');
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' })[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const checks = [];

async function attach(profile) {
  browser = await chromium.launchPersistentContext(resolve(output, profile), { channel, headless: true });
  const page = await browser.newPage();
  await page.goto(`${origin}/storage.html`);
  await page.evaluate(async () => {
    const { DataLibraryClient } = await import('./data-client.js');
    window.library = new DataLibraryClient(); await window.library.open();
  });
  return page;
}
const importFile = (page, name, bytes) => page.evaluate(async ({ name, bytes }) => window.library.importFile(new File([new Uint8Array(bytes)], name)), { name, bytes: [...bytes] });

// Test-only worker opens the isolated profile after the public client releases its lock.
async function inspect(page, action, datasetId = null) {
  await page.evaluate(() => window.library.close());
  const result = await page.evaluate(async ({ action, datasetId }) => {
    const code = `
      import { LibraryStore } from '${location.origin}/library-store.js';
      import { hydrateDatasetMetadata } from '${location.origin}/library-metadata.js';
      self.onmessage = async ({data}) => {
        const store = new LibraryStore();
        try {
          await store.open(); let result;
          if(data.action==='legacy') {
            const row=store.get(data.datasetId), db=new store.pool.OpfsSAHPoolDb(row.db_path,'w');
            const manifest=JSON.parse(row.manifest_json); manifest.parserVersion='retained-v1';
            try{db.exec({sql:"UPDATE meta SET value=? WHERE key='manifest'",bind:[JSON.stringify(manifest)]});}finally{db.close();}
            store.catalog.exec({sql:'UPDATE datasets SET parser_version=?,manifest_json=? WHERE id=?',bind:['retained-v1',JSON.stringify(manifest),data.datasetId]});
            result={legacy:true};
          } else if(data.action==='unavailable'||data.action==='ready') {
            store.catalog.exec({sql:'UPDATE datasets SET status=? WHERE id=?',bind:[data.action,data.datasetId]}); result={changed:true};
          } else {
            let accesses=0; const access=store.access.bind(store);
            store.access=async(...args)=>{accesses++; if(data.action==='cache-only') throw new Error('Cache hit must not open retained data'); return access(...args);};
            result=await hydrateDatasetMetadata(store,store.list('datasets',{limit:100}),{checkCancelled(){}});
            result.accesses=accesses;
            result.poolFiles=store.pool.getFileNames();
          }
          await store.close(); postMessage({result});
        }catch(error){await store.close().catch(()=>{});postMessage({error:String(error.stack??error)});}
      };`;
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })), worker = new Worker(url, { type: 'module' });
    try {
      return await new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.result);
        worker.onerror = (error) => reject(new Error(error.message)); worker.postMessage({ action, datasetId });
      });
    } finally { worker.terminate(); URL.revokeObjectURL(url); }
  }, { action, datasetId });
  await page.evaluate(() => window.library.open());
  return result;
}

try {
  let page = await attach('initial');
  const a = (await importFile(page, 'legacy-le.stdf', fixture({ name: 'A' }))).dataset;
  const b = (await importFile(page, 'modern-be.stdf', fixture({ name: 'B', big: true, startTime: 0, part: 'B-200', lot: '' }))).dataset;
  const c = (await importFile(page, 'no-labels.stdf', fixture({ name: 'C', startTime: 0, part: '', lot: '' }))).dataset;
  await inspect(page, 'legacy', a.id);
  const inventory = await page.evaluate(() => window.library.listDatasets({ limit: 100 }));
  const aMeta = inventory.items.find((item) => item.id === a.id).test_metadata;
  assert.deepEqual(aMeta, { startTime: 1792324800, partNumber: 'A-100', lotId: 'LOT-1', sublotId: 'SUB-2', program: 'FT', revision: 'R3', tester: 'BENCH-1', status: 'recorded', warning: null });
  const bMeta = inventory.items.find((item) => item.id === b.id).test_metadata;
  assert.equal(bMeta.startTime, null); assert.equal(bMeta.partNumber, 'B-200'); assert.equal(bMeta.lotId, '');
  assert.equal(inventory.items.find((item) => item.id === c.id).test_metadata.partNumber, '');
  checks.push('Retained-v1 LE and retained-v2 BE headers; absent dates/lot/part number stay unknown.');
  const reused = await inspect(page, 'cache-only');
  assert.equal(reused.accesses, 0); assert.deepEqual(reused.items.find((item) => item.id === a.id).test_metadata, aMeta);
  assert.ok(reused.poolFiles.every((name) => !name.includes('/viewer-')));
  checks.push('Persistent cache reused across worker restart without dataset access or viewer caches.');
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory(), handle = await root.getFileHandle('semidata-library-metadata-v1.json');
    const cache = JSON.parse(await (await handle.getFile()).text()); cache.entries[0].signature = 'stale';
    const writable = await handle.createWritable(); await writable.write(JSON.stringify(cache)); await writable.close();
  });
  assert.equal((await inspect(page, 'hydrate')).accesses, 1);
  checks.push('Stale source identity rebuilds only its own metadata entry.');
  await inspect(page, 'unavailable', a.id);
  let current = (await page.evaluate(() => window.library.listDatasets({ limit: 100 }))).items.find((item) => item.id === a.id);
  assert.equal(current.test_metadata.status, 'unavailable');
  await inspect(page, 'ready', a.id);
  current = (await page.evaluate(() => window.library.listDatasets({ limit: 100 }))).items.find((item) => item.id === a.id);
  assert.deepEqual(current.test_metadata, aMeta);
  checks.push('An unavailable source does not expose stale labels and can recover.');
  const portable = await page.evaluate(async (id) => {
    const result = await window.library.exportDataset(id);
    const bytes = [...new Uint8Array(await result.file.arrayBuffer())];
    await window.library.request('releaseExport', { exportToken: result.exportToken });
    return bytes;
  }, a.id);
  await page.evaluate(() => window.library.close()); await browser.close(); browser = null;
  page = await attach('restored');
  const restored = await page.evaluate(async (bytes) => window.library.restorePackage(new File([new Uint8Array(bytes)], 'legacy.sdlibrary')), portable);
  assert.equal(restored.dataset.parser_version, 'retained-v1');
  assert.deepEqual((await page.evaluate(() => window.library.listDatasets())).items[0].test_metadata, aMeta);
  checks.push('A legacy portable package restores into a fresh library and gains header metadata.');
  await page.evaluate(() => window.library.close());
  await writeFile(resolve(output, 'evidence.json'), JSON.stringify({ channel, checks }, null, 2));
  console.log(JSON.stringify({ channel, checks, output }, null, 2));
} finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
