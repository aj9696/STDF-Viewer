export const SCHEMA_VERSION = 1;
export const PARSER_VERSION = "retained-v1";
export const DATASET_APP_ID = 1396985924;
export const CATALOG_APP_ID = 1396985923;
export const MAX_SOURCE_BYTES = 2 * 1024 ** 3;
export const MAX_DATASETS = 1000;
export const TABLES = {
  meta: "CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  records: "CREATE TABLE records(seq INTEGER PRIMARY KEY, offset INTEGER NOT NULL, length INTEGER NOT NULL, type INTEGER NOT NULL, subtype INTEGER NOT NULL, device_id INTEGER, decoded_json TEXT)",
  definitions: "CREATE TABLE definitions(id INTEGER PRIMARY KEY, test_number INTEGER NOT NULL, name TEXT, metadata_json TEXT NOT NULL)",
  measurements: "CREATE TABLE measurements(seq INTEGER PRIMARY KEY, device_id INTEGER NOT NULL, definition_id INTEGER NOT NULL, test_number INTEGER NOT NULL, head INTEGER NOT NULL, site INTEGER NOT NULL, test_flags INTEGER NOT NULL, parm_flags INTEGER NOT NULL, result_bits INTEGER NOT NULL, result REAL)",
  devices: "CREATE TABLE devices(id INTEGER PRIMARY KEY, head INTEGER NOT NULL, site INTEGER NOT NULL, prr_seq INTEGER NOT NULL, part_flags INTEGER NOT NULL, num_tests INTEGER NOT NULL, hard_bin INTEGER NOT NULL, soft_bin INTEGER NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL, test_time INTEGER NOT NULL, part_id TEXT NOT NULL, part_text TEXT NOT NULL)",
};
export const INDEXES = {
  measurements_test: "CREATE INDEX measurements_test ON measurements(test_number,seq)",
  measurements_device: "CREATE INDEX measurements_device ON measurements(device_id,seq)",
};
export const CATALOG_TABLES = {
  datasets: "CREATE TABLE datasets(id TEXT PRIMARY KEY, source_hash TEXT NOT NULL, parser_version TEXT NOT NULL, schema_version INTEGER NOT NULL, name TEXT NOT NULL, relative_path TEXT NOT NULL, source_bytes INTEGER NOT NULL, db_bytes INTEGER NOT NULL, db_path TEXT NOT NULL UNIQUE, source_path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, status TEXT NOT NULL, manifest_json TEXT NOT NULL, UNIQUE(source_hash,parser_version,schema_version))",
  jobs: "CREATE TABLE jobs(id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, name TEXT NOT NULL, relative_path TEXT NOT NULL, source_hash TEXT, source_bytes INTEGER, db_path TEXT NOT NULL, source_path TEXT NOT NULL, dataset_id TEXT, error_code TEXT, error_message TEXT)",
};

export function libraryError(code, message) {
  return Object.assign(new Error(message), { code });
}
export function configureDatabase(sqlite3, db) {
  db.exec("PRAGMA trusted_schema=OFF");
  const rc = sqlite3.capi.sqlite3_db_config(db.pointer, sqlite3.capi.SQLITE_DBCONFIG_DEFENSIVE, 1, 0);
  if (rc !== 0) throw libraryError("STORAGE_ERROR", "Could not enable SQLite defensive mode.");
}
export function createSchema(db, appId, tables) {
  db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA cache_size=-8192");
  db.transaction(() => {
    for (const sql of Object.values(tables)) db.exec(sql);
    db.exec(`PRAGMA application_id=${appId}; PRAGMA user_version=${SCHEMA_VERSION}`);
  });
}
export function checkSchema(db, appId, tables, indexes = {}) {
  if (db.selectValue("PRAGMA application_id") !== appId || db.selectValue("PRAGMA user_version") !== SCHEMA_VERSION) {
    throw libraryError("INCOMPATIBLE", "Unsupported database format. No migration or reset was attempted.");
  }
  const expected = { ...tables, ...indexes };
  const actual = db.selectObjects("SELECT name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name");
  if (actual.length !== Object.keys(expected).length || actual.some(({ name, sql }) => expected[name] !== sql)) {
    throw libraryError("INCOMPATIBLE", "Database schema does not match the supported format.");
  }
}
export function getManifest(db) {
  const text = db.selectValue("SELECT value FROM meta WHERE key='manifest'");
  if (!text || text.length > 60000) throw libraryError("INCOMPLETE", "Dataset has no complete manifest.");
  const manifest = JSON.parse(text);
  if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.parserVersion !== PARSER_VERSION) {
    throw libraryError("INCOMPATIBLE", "Unsupported dataset/parser version.");
  }
  return manifest;
}
export function verifyDatabase(db, manifest) {
  checkSchema(db, DATASET_APP_ID, TABLES, INDEXES);
  if (db.selectValue("PRAGMA integrity_check") !== "ok") throw libraryError("CORRUPT", "SQLite integrity verification failed.");
  for (const table of ["records", "measurements", "devices", "definitions"]) {
    if (db.selectValue(`SELECT count(*) FROM ${table}`) !== manifest.counts[table]) {
      throw libraryError("CORRUPT", `Stored ${table} count differs from its manifest.`);
    }
  }
  const bad = db.selectValue("SELECT 1 FROM measurements m LEFT JOIN records r ON r.seq=m.seq LEFT JOIN devices d ON d.id=m.device_id LEFT JOIN definitions t ON t.id=m.definition_id WHERE r.seq IS NULL OR r.type!=15 OR r.subtype!=10 OR d.id IS NULL OR t.id IS NULL OR t.test_number!=m.test_number LIMIT 1");
  if (bad) throw libraryError("CORRUPT", "Measurement references do not match retained records/devices/definitions.");
  const end = db.selectValue("SELECT max(offset+length) FROM records");
  if (end !== manifest.source.size) throw libraryError("CORRUPT", "Record extent differs from the retained source size.");
}
