import { configureDatabase, libraryError } from './dataset-schema.js';
import { loadParser } from './import-source.js';
import { VIEWER_VERSION, datasetId } from './viewer-model.js';

export const CACHE_APP_ID = 1396985942;
export const CACHE_TABLES = {
  meta: 'CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)',
  tests: 'CREATE TABLE tests(id INTEGER PRIMARY KEY,family INTEGER NOT NULL,number INTEGER NOT NULL,name TEXT NOT NULL,first_seq INTEGER NOT NULL,metadata_json TEXT NOT NULL,identity TEXT NOT NULL)',
  observations: 'CREATE TABLE observations(seq INTEGER NOT NULL,ordinal INTEGER NOT NULL,device_id INTEGER NOT NULL,test_id INTEGER NOT NULL,head INTEGER NOT NULL,site INTEGER NOT NULL,test_flags INTEGER NOT NULL,parm_flags INTEGER,raw_bits INTEGER,raw_value REAL,value REAL,low REAL,high REAL,metadata_id INTEGER NOT NULL,unit TEXT NOT NULL,pmr_index INTEGER,channel TEXT NOT NULL,PRIMARY KEY(seq,ordinal)) WITHOUT ROWID',
  pinStates: 'CREATE TABLE pinStates(seq INTEGER NOT NULL,role TEXT NOT NULL,ordinal INTEGER NOT NULL,pmr_index INTEGER,state INTEGER,PRIMARY KEY(seq,role,ordinal)) WITHOUT ROWID',
  devices: 'CREATE TABLE devices(id INTEGER PRIMARY KEY,head INTEGER NOT NULL,site INTEGER NOT NULL,prr_seq INTEGER NOT NULL,part_flags INTEGER NOT NULL,num_tests INTEGER NOT NULL,hard_bin INTEGER NOT NULL,soft_bin INTEGER NOT NULL,x INTEGER NOT NULL,y INTEGER NOT NULL,test_time INTEGER NOT NULL,part_id TEXT NOT NULL,part_text TEXT NOT NULL,wafer_id INTEGER,dut_index INTEGER NOT NULL,superseded INTEGER NOT NULL)',
  metadata: 'CREATE TABLE metadata(id INTEGER PRIMARY KEY,seq INTEGER NOT NULL,type INTEGER NOT NULL,subtype INTEGER NOT NULL,device_id INTEGER,json TEXT NOT NULL)',
  channels: 'CREATE TABLE channels(test_id INTEGER NOT NULL,unit TEXT NOT NULL,channel TEXT NOT NULL,observations INTEGER NOT NULL,failures INTEGER NOT NULL,PRIMARY KEY(test_id,unit,channel)) WITHOUT ROWID',
};
export const CACHE_INDEXES = {
  tests_identity: 'CREATE INDEX tests_identity ON tests(family,number,name,identity)',
  observations_test: 'CREATE INDEX observations_test ON observations(test_id,unit,channel,seq,ordinal)',
  observations_value: 'CREATE INDEX observations_value ON observations(test_id,unit,channel,value)',
  observations_device: 'CREATE INDEX observations_device ON observations(device_id,seq,ordinal)',
  devices_part: 'CREATE INDEX devices_part ON devices(head,site,part_id,prr_seq)',
  devices_die: 'CREATE INDEX devices_die ON devices(head,site,wafer_id,x,y,prr_seq)',
  devices_retired: 'CREATE INDEX devices_retired ON devices(superseded,id)',
  devices_superseding_parts: "CREATE INDEX devices_superseding_parts ON devices(head,site,part_id) WHERE (part_flags&1)!=0 AND part_id!=''",
  devices_sort_part: 'CREATE INDEX devices_sort_part ON devices(part_id,id)',
  devices_sort_head: 'CREATE INDEX devices_sort_head ON devices(head,id)',
  devices_sort_site: 'CREATE INDEX devices_sort_site ON devices(site,id)',
  devices_sort_hard_bin: 'CREATE INDEX devices_sort_hard_bin ON devices(hard_bin,id)',
  devices_sort_soft_bin: 'CREATE INDEX devices_sort_soft_bin ON devices(soft_bin,id)',
  devices_sort_time: 'CREATE INDEX devices_sort_time ON devices(test_time,id)',
  devices_sort_x: 'CREATE INDEX devices_sort_x ON devices(x,id)',
  devices_sort_y: 'CREATE INDEX devices_sort_y ON devices(y,id)',
  devices_sort_status: 'CREATE INDEX devices_sort_status ON devices(part_flags,id)',
  devices_sort_tests: 'CREATE INDEX devices_sort_tests ON devices(num_tests,id)',
  metadata_kind: 'CREATE INDEX metadata_kind ON metadata(type,subtype,seq)',
};
const COLUMNS = { tests: 7, observations: 17, pinStates: 5, devices: 16, metadata: 6 };
const CHUNK_BYTES = 65536, COMMIT_BYTES = 4 * 1024 * 1024;
const POLICY = 'base-units-first-defaults-explicit-retests-v1';
export const cachePath = (id) => `/viewer-v${VIEWER_VERSION}-${datasetId(id)}.sqlite3`;

function checkCache(db, source) {
  if (db.selectValue('PRAGMA application_id') !== CACHE_APP_ID || db.selectValue('PRAGMA user_version') !== VIEWER_VERSION) return null;
  const expected = { ...CACHE_TABLES, ...CACHE_INDEXES };
  const actual = db.selectObjects('SELECT name,sql FROM sqlite_schema WHERE sql IS NOT NULL');
  if (actual.length !== Object.keys(expected).length || actual.some((row) => expected[row.name] !== row.sql)) return null;
  const json = db.selectValue("SELECT value FROM meta WHERE key='manifest' AND length(value)<=65536");
  if (!json) return null;
  const manifest = JSON.parse(json);
  return manifest.version === VIEWER_VERSION && manifest.policy === POLICY && manifest.parserVersion === 'viewer-v1' &&
    manifest.sha256 === source.source_hash && manifest.sourceBytes === source.source_bytes ? manifest : null;
}

/** Returns only a validated completed cache; raw retained data is never modified. */
export async function ensureViewerCache(store, id, context) {
  const opened = await store.access(id);
  const { dataset, file } = opened;
  opened.db.close();
  const path = cachePath(id);
  if (store.pool.getFileNames().includes(path)) {
    let existing;
    try {
      existing = new store.pool.OpfsSAHPoolDb(path, 'r');
      configureDatabase(store.sqlite3, existing);
      const manifest = checkCache(existing, dataset);
      if (manifest) return { path, dataset: store.present(dataset), manifest, reused: true };
    } catch { /* A disposable index can be rebuilt from its immutable source. */ }
    finally { existing?.close(); }
    store.pool.unlink(path);
    store.pool.unlink(`${path}-journal`);
  }
  context.checkCancelled();
  await store.pool.reserveMinimumCapacity(store.pool.getFileCount() + 4);
  const runtime = await loadParser();
  if (!runtime.ViewerParser) throw libraryError('INCOMPATIBLE', 'Viewer parser assets are missing. Rebuild the browser WASM package.');
  let db, parser, hasher;
  const statements = {}, families = new Map(), counts = { tests: 0, observations: 0, pinStates: 0, devices: 0, metadata: 0 };
  const started = performance.now();
  try {
    db = new store.pool.OpfsSAHPoolDb(path, 'c');
    configureDatabase(store.sqlite3, db);
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA cache_size=-8192');
    db.transaction(() => {
      for (const sql of [...Object.values(CACHE_TABLES), ...Object.values(CACHE_INDEXES)]) db.exec(sql);
      db.exec(`PRAGMA application_id=${CACHE_APP_ID}; PRAGMA user_version=${VIEWER_VERSION}`);
    });
    for (const [table, columns] of Object.entries(COLUMNS)) statements[table] = db.prepare(`INSERT INTO ${table} VALUES(${Array(columns).fill('?').join(',')})`);
    const replacePart = db.prepare('UPDATE devices SET superseded=1 WHERE head=? AND site=? AND part_id=? AND prr_seq<?');
    const replaceDie = db.prepare('UPDATE devices SET superseded=1 WHERE head=? AND site=? AND wafer_id=? AND x=? AND y=? AND prr_seq<?');
    statements.replacePart = replacePart; statements.replaceDie = replaceDie;
    const writeBatch = (batch) => {
      if (batch.version !== 1) throw libraryError('INCOMPATIBLE', 'Unsupported viewer batch format.');
      for (const row of batch.tests) families.set(row[0], row[1]);
      for (const table of Object.keys(COLUMNS)) {
        for (const original of batch[table]) {
          let row = original;
          if (table === 'tests') row = [...row, JSON.parse(row[5]).identity ?? 'resolved'];
          if (table === 'observations') {
            const family = families.get(row[3]);
            if (!family) throw libraryError('CORRUPT', 'Observation has no decoded test identity.');
            const channel = family === 15 ? row[15] === null ? `result:${row[1]}` : `pmr:${row[15]}` : '';
            row = [...row, channel];
            // FTR deliberately plots the raw status byte, never a physical value.
            if (family === 20) row[10] = row[6];
          } else if (table === 'devices') {
            if ((row[4] & 1) && row[11] !== '') {
              replacePart.bind([row[1], row[2], row[11], row[3]]).step(); replacePart.reset();
            }
            if ((row[4] & 2) && row[13] !== null && row[8] !== -32768 && row[9] !== -32768) {
              replaceDie.bind([row[1], row[2], row[13], row[8], row[9], row[3]]).step(); replaceDie.reset();
            }
            row = [...row, 0, 0];
          }
          statements[table].bind(row).step(); statements[table].reset(); counts[table]++;
        }
      }
    };
    parser = new runtime.ViewerParser(); hasher = new runtime.Sha256Hasher();
    db.exec('BEGIN');
    let sinceCommit = 0;
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      context.checkCancelled();
      const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
      hasher.update(bytes);
      let batch = JSON.parse(parser.push(bytes));
      writeBatch(batch);
      while (batch.pending) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        context.checkCancelled(); batch = JSON.parse(parser.drain()); writeBatch(batch);
      }
      sinceCommit += bytes.length;
      if (sinceCommit >= COMMIT_BYTES) { db.exec('COMMIT; BEGIN'); sinceCommit = 0; }
      context.progress({ phase: 'viewer-index', datasetId: id, completedBytes: offset + bytes.length, totalBytes: file.size });
    }
    const summary = JSON.parse(parser.finish());
    const sha256 = hasher.finish();
    if (sha256 !== dataset.source_hash || summary.bytes !== file.size) throw libraryError('CORRUPT', 'Saved source checksum differs from its import.');
    for (const table of ['tests', 'observations', 'devices', 'metadata']) {
      if (counts[table] !== summary[table]) throw libraryError('CORRUPT', `Viewer ${table} count does not match its decoder.`);
    }
    for (const statement of Object.values(statements)) statement.finalize();
    for (const name of Object.keys(statements)) delete statements[name];
    db.exec('COMMIT');
    context.checkCancelled();
    context.progress({ phase: 'viewer-finalize', datasetId: id, completedBytes: file.size, totalBytes: file.size });
    // Rank PIR sequence rather than PRR completion: multi-site attempts may finish out of order.
    const attempts = db.prepare('SELECT id FROM devices ORDER BY id'), rank = db.prepare('UPDATE devices SET dut_index=? WHERE id=?');
    try {
      let ordinal = 0; db.exec('BEGIN');
      while (attempts.step()) {
        rank.bind([++ordinal, attempts.get(0)]).step(); rank.reset();
        if (ordinal % 4096 === 0) {
          db.exec('COMMIT; BEGIN');
          await new Promise((resolve) => setTimeout(resolve, 0)); context.checkCancelled();
        }
      }
      db.exec('COMMIT');
    } finally { attempts.finalize(); rank.finalize(); }
    db.exec('INSERT INTO channels SELECT test_id,unit,channel,COUNT(*),SUM(CASE WHEN (test_flags&192)=128 THEN 1 ELSE 0 END) FROM observations GROUP BY test_id,unit,channel');
    if (db.selectValue('SELECT 1 FROM observations o LEFT JOIN tests t ON t.id=o.test_id LEFT JOIN devices d ON d.id=o.device_id LEFT JOIN metadata m ON m.id=o.metadata_id WHERE t.id IS NULL OR d.id IS NULL OR m.id IS NULL OR o.head!=d.head OR o.site!=d.site LIMIT 1')) throw libraryError('CORRUPT', 'Viewer observation references failed validation.');
    const manifest = { version: VIEWER_VERSION, policy: POLICY, parserVersion: summary.parserVersion,
      sha256, sourceBytes: file.size, counts, byteOrder: summary.byteOrder, recordCounts: summary.recordCounts,
      warnings: summary.warnings, builtAt: new Date().toISOString(), buildMs: performance.now() - started,
      parserMemoryBytes: parser.memory_bytes() };
    db.exec({ sql: "INSERT INTO meta VALUES('manifest',?)", bind: [JSON.stringify(manifest)] });
    db.close(); db = null;
    return { path, dataset: store.present(dataset), manifest, reused: false };
  } catch (error) {
    for (const statement of Object.values(statements)) statement.finalize();
    db?.close(); db = null;
    store.pool.unlink(path); store.pool.unlink(`${path}-journal`);
    throw libraryError(error.name === 'QuotaExceededError' ? 'QUOTA_EXCEEDED' : error.code ?? 'VIEWER_INDEX_FAILED', String(error.message ?? error));
  } finally { parser?.free(); hasher?.free(); }
}
