import { MAX_DATASETS } from './dataset-schema.js';

const CACHE_FILE = 'semidata-library-metadata-v1.json';
const MAX_CACHE_BYTES = 4 * 1024 * 1024;
const HEADER_RECORD_LIMIT = 4096;
const empty = (status, warning = null) => ({ startTime: null, partNumber: '', lotId: '', sublotId: '', program: '', revision: '', tester: '', status, warning });
const text = (value) => typeof value === 'string' ? value.trim().slice(0, 255) : '';
const signature = (item) => JSON.stringify([item.source_hash, item.parser_version, item.schema_version, item.source_bytes]);
const yieldWorker = () => new Promise((resolve) => setTimeout(resolve, 0));

/** MIR START_T is a source start time in UTC seconds, not an import/device time. */
export function metadataFromMir(mir) {
  if (!mir || typeof mir !== 'object' || Array.isArray(mir)) return empty('unavailable', 'The MIR header could not be read.');
  return { startTime: Number.isInteger(mir.START_T) && mir.START_T > 0 && mir.START_T <= 4294967295 ? mir.START_T : null,
    partNumber: text(mir.PART_TYP), lotId: text(mir.LOT_ID), sublotId: text(mir.SBLOT_ID), program: text(mir.JOB_NAM),
    revision: text(mir.JOB_REV), tester: text(mir.NODE_NAM) || text(mir.TSTR_TYP), status: 'recorded', warning: null };
}

/** Read the indexed record prefix only. Never build a viewer cache or scan measurements. */
export async function readHeaderMetadata(db, context) {
  let after = 0;
  while (after < HEADER_RECORD_LIMIT) {
    context.checkCancelled();
    const rows = db.selectObjects(`SELECT seq,type,subtype,device_id,
      CASE WHEN type=1 AND subtype=10 THEN substr(decoded_json,1,131073) END AS header
      FROM records WHERE seq>? AND seq<=? ORDER BY seq LIMIT 64`, [after, HEADER_RECORD_LIMIT]);
    for (const row of rows) {
      after = row.seq;
      if (row.type === 1 && row.subtype === 10) {
        try { return metadataFromMir(JSON.parse(row.header)); }
        catch { return empty('unavailable', 'The MIR header could not be read.'); }
      }
      if (row.device_id !== null || row.type === 5 || row.type === 15) return empty('not-recorded');
    }
    if (rows.length < 64) return empty('not-recorded');
    await yieldWorker();
  }
  return empty('unavailable', 'No MIR header was found in the first 4,096 records.');
}

function validCachedMetadata(value) {
  return value && ['recorded', 'not-recorded'].includes(value.status) && value.warning === null &&
    (value.startTime === null || Number.isInteger(value.startTime) && value.startTime > 0 && value.startTime <= 4294967295) &&
    ['partNumber', 'lotId', 'sublotId', 'program', 'revision', 'tester'].every((key) => typeof value[key] === 'string' && value[key].length <= 255);
}

async function metadataCache(store) {
  if (store.headerMetadataCache) return store.headerMetadataCache;
  const cache = { root: null, entries: new Map() };
  try {
    cache.root = await navigator.storage.getDirectory();
    const file = await (await cache.root.getFileHandle(CACHE_FILE)).getFile();
    if (file.size <= MAX_CACHE_BYTES) {
      const saved = JSON.parse(await file.text());
      if (saved?.version === 1 && Array.isArray(saved.entries) && saved.entries.length <= MAX_DATASETS) {
        for (const entry of saved.entries) {
          if (typeof entry?.id === 'string' && /^[0-9a-f-]{36}$/.test(entry.id) && typeof entry.signature === 'string' &&
              entry.signature.length <= 256 && validCachedMetadata(entry.metadata)) cache.entries.set(entry.id, entry);
        }
      }
    }
  } catch { /* This disposable cache is rebuilt from retained headers. */ }
  store.headerMetadataCache = cache;
  return cache;
}

async function saveCache(cache) {
  if (!cache.root) return;
  let writable;
  try {
    const payload = JSON.stringify({ version: 1, entries: [...cache.entries.values()].slice(-MAX_DATASETS) });
    if (new TextEncoder().encode(payload).byteLength > MAX_CACHE_BYTES) return;
    writable = await (await cache.root.getFileHandle(CACHE_FILE, { create: true })).createWritable();
    await writable.write(payload); await writable.close();
  } catch { await writable?.abort().catch(() => {}); /* Cache failure must not hide saved files. */ }
}

/** Add bounded, local metadata to a dataset page. Dataset/package formats stay unchanged. */
export async function hydrateDatasetMetadata(store, page, context) {
  const cache = await metadataCache(store);
  let dirty = false;
  for (const item of page.items) {
    context.checkCancelled();
    if (item.status !== 'ready') { item.test_metadata = empty('unavailable', 'The saved file needs recovery.'); continue; }
    const key = signature(item), cached = cache.entries.get(item.id);
    if (cached?.signature === key) { item.test_metadata = cached.metadata; continue; }
    let opened;
    try {
      opened = await store.access(item.id);
      item.test_metadata = await readHeaderMetadata(opened.db, context);
    } catch (error) {
      if (error.code === 'CANCELLED') throw error;
      item.test_metadata = empty('unavailable', 'The saved header is unavailable. Retry after recovery.');
      item.status = store.get(item.id).status;
    } finally { opened?.db.close(); }
    if (validCachedMetadata(item.test_metadata)) {
      cache.entries.set(item.id, { id: item.id, signature: key, metadata: item.test_metadata }); dirty = true;
    }
    // Let cancellation reach the worker between files, including very small files.
    await yieldWorker();
  }
  context.checkCancelled();
  if (dirty) await saveCache(cache);
  return page;
}
