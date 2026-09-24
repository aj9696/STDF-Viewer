export const SCHEMA_VERSION = 1;
export const PARSER_VERSION = "retained-v1";
export const DATASET_APP_ID = 1396985924;
export const CATALOG_APP_ID = 1396985923;
export const MAX_SOURCE_BYTES = 2 * 1024 ** 3;
export const MAX_DATASETS = 1000;
export const TABLES = {
  meta: "CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(typeof(value)='text' AND length(value)<=60000))",
  records: "CREATE TABLE records(seq INTEGER PRIMARY KEY CHECK(seq>0), offset INTEGER NOT NULL CHECK(typeof(offset)='integer' AND offset>=0), length INTEGER NOT NULL CHECK(typeof(length)='integer' AND length BETWEEN 4 AND 65539), type INTEGER NOT NULL CHECK(type BETWEEN 0 AND 255), subtype INTEGER NOT NULL CHECK(subtype BETWEEN 0 AND 255), device_id INTEGER CHECK(device_id IS NULL OR (typeof(device_id)='integer' AND device_id>0)), decoded_json TEXT CHECK(decoded_json IS NULL OR (typeof(decoded_json)='text' AND length(decoded_json)<=131072)))",
  definitions: "CREATE TABLE definitions(id INTEGER PRIMARY KEY CHECK(id>0), test_number INTEGER NOT NULL CHECK(test_number BETWEEN 0 AND 4294967295), name TEXT CHECK(name IS NULL OR (typeof(name)='text' AND length(name)<=1024)), metadata_json TEXT NOT NULL CHECK(typeof(metadata_json)='text' AND length(metadata_json)<=16384))",
  measurements: "CREATE TABLE measurements(seq INTEGER PRIMARY KEY CHECK(seq>0), device_id INTEGER NOT NULL CHECK(device_id>0), definition_id INTEGER NOT NULL CHECK(definition_id>0), test_number INTEGER NOT NULL CHECK(test_number BETWEEN 0 AND 4294967295), head INTEGER NOT NULL CHECK(head BETWEEN 0 AND 255), site INTEGER NOT NULL CHECK(site BETWEEN 0 AND 255), test_flags INTEGER NOT NULL CHECK(test_flags BETWEEN 0 AND 255), parm_flags INTEGER NOT NULL CHECK(parm_flags BETWEEN 0 AND 255), result_bits INTEGER NOT NULL CHECK(result_bits BETWEEN 0 AND 4294967295), result REAL CHECK(result IS NULL OR typeof(result) IN ('real','integer')))",
  devices: "CREATE TABLE devices(id INTEGER PRIMARY KEY CHECK(id>0), head INTEGER NOT NULL CHECK(head BETWEEN 0 AND 255), site INTEGER NOT NULL CHECK(site BETWEEN 0 AND 255), prr_seq INTEGER NOT NULL CHECK(prr_seq>id), part_flags INTEGER NOT NULL CHECK(part_flags BETWEEN 0 AND 255), num_tests INTEGER NOT NULL CHECK(typeof(num_tests)='integer' AND num_tests BETWEEN 0 AND 65535), hard_bin INTEGER NOT NULL CHECK(typeof(hard_bin)='integer' AND hard_bin BETWEEN 0 AND 65535), soft_bin INTEGER NOT NULL CHECK(typeof(soft_bin)='integer' AND soft_bin BETWEEN 0 AND 65535), x INTEGER NOT NULL CHECK(typeof(x)='integer' AND x BETWEEN -32768 AND 32767), y INTEGER NOT NULL CHECK(typeof(y)='integer' AND y BETWEEN -32768 AND 32767), test_time INTEGER NOT NULL CHECK(typeof(test_time)='integer' AND test_time BETWEEN 0 AND 4294967295), part_id TEXT NOT NULL CHECK(typeof(part_id)='text' AND length(part_id)<=1024), part_text TEXT NOT NULL CHECK(typeof(part_text)='text' AND length(part_text)<=1024))",
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
  // Bound the SQL projection before copying untrusted TEXT into the JS heap.
  const text = db.selectValue("SELECT value FROM meta WHERE key='manifest' AND typeof(value)='text' AND length(value)<=60000");
  if (!text || text.length > 60000) throw libraryError("INCOMPLETE", "Dataset has no complete manifest.");
  const manifest = JSON.parse(text);
  if (manifest?.schemaVersion !== SCHEMA_VERSION || manifest.parserVersion !== PARSER_VERSION ||
      !manifest.counts || !["records", "measurements", "devices", "definitions"].every((key) => Number.isSafeInteger(manifest.counts[key]) && manifest.counts[key] >= 0) ||
      !manifest.source || !Number.isSafeInteger(manifest.source.size) || manifest.source.size < 1 || manifest.source.size > MAX_SOURCE_BYTES) {
    throw libraryError("INCOMPATIBLE", "Unsupported dataset/parser version.");
  }
  return manifest;
}
export function verifyDatabase(db, manifest) {
  checkSchema(db, DATASET_APP_ID, TABLES, INDEXES);
  if (db.selectValue("PRAGMA integrity_check") !== "ok") throw libraryError("CORRUPT", "SQLite integrity verification failed.");
  // Validate values explicitly: integrity_check in a particular SQLite build
  // must not be the only enforcement of an untrusted package's scalar contract.
  const integerColumns = {
    records: ["seq", "offset", "length", "type", "subtype"],
    definitions: ["id", "test_number"],
    measurements: ["seq", "device_id", "definition_id", "test_number", "head", "site", "test_flags", "parm_flags", "result_bits"],
    devices: ["id", "head", "site", "prr_seq", "part_flags", "num_tests", "hard_bin", "soft_bin", "x", "y", "test_time"],
  };
  const invalidValues = {
    records: "typeof(device_id) NOT IN ('null','integer') OR (device_id IS NOT NULL AND device_id<=0) OR typeof(decoded_json) NOT IN ('null','text') OR length(decoded_json)>131072 OR seq<=0 OR offset<0 OR length NOT BETWEEN 4 AND 65539 OR type NOT BETWEEN 0 AND 255 OR subtype NOT BETWEEN 0 AND 255",
    definitions: "typeof(name) NOT IN ('null','text') OR length(name)>1024 OR typeof(metadata_json)!='text' OR length(metadata_json)>16384 OR id<=0 OR test_number NOT BETWEEN 0 AND 4294967295",
    measurements: "typeof(result) NOT IN ('null','integer','real') OR seq<=0 OR device_id<=0 OR definition_id<=0 OR test_number NOT BETWEEN 0 AND 4294967295 OR head NOT BETWEEN 0 AND 255 OR site NOT BETWEEN 0 AND 255 OR test_flags NOT BETWEEN 0 AND 255 OR parm_flags NOT BETWEEN 0 AND 255 OR result_bits NOT BETWEEN 0 AND 4294967295",
    devices: "typeof(part_id)!='text' OR length(part_id)>1024 OR typeof(part_text)!='text' OR length(part_text)>1024 OR id<=0 OR prr_seq<=id OR head NOT BETWEEN 0 AND 255 OR site NOT BETWEEN 0 AND 255 OR part_flags NOT BETWEEN 0 AND 255 OR num_tests NOT BETWEEN 0 AND 65535 OR hard_bin NOT BETWEEN 0 AND 65535 OR soft_bin NOT BETWEEN 0 AND 65535 OR x NOT BETWEEN -32768 AND 32767 OR y NOT BETWEEN -32768 AND 32767 OR test_time NOT BETWEEN 0 AND 4294967295",
  };
  for (const table of ["records", "measurements", "devices", "definitions"]) {
    if (db.selectValue(`SELECT count(*) FROM ${table}`) !== manifest.counts[table]) {
      throw libraryError("CORRUPT", `Stored ${table} count differs from its manifest.`);
    }
    const predicates = integerColumns[table].map((column) => `typeof(${column})!='integer'`);
    if (db.selectValue(`SELECT 1 FROM ${table} WHERE ${predicates.join(" OR ")} OR ${invalidValues[table]} LIMIT 1`)) {
      throw libraryError("CORRUPT", `Stored ${table} values violate the retained data contract.`);
    }
  }
  const bad = db.selectValue("SELECT 1 FROM measurements m LEFT JOIN records r ON r.seq=m.seq LEFT JOIN devices d ON d.id=m.device_id LEFT JOIN definitions t ON t.id=m.definition_id WHERE r.seq IS NULL OR r.type!=15 OR r.subtype!=10 OR r.device_id IS NOT m.device_id OR d.id IS NULL OR t.id IS NULL OR t.test_number!=m.test_number OR m.head!=d.head OR m.site!=d.site OR m.seq<=d.id OR m.seq>=d.prr_seq LIMIT 1");
  if (bad) throw libraryError("CORRUPT", "Measurement references do not match retained records/devices/definitions.");
  const badDevice = db.selectValue("SELECT 1 FROM devices d LEFT JOIN records pir ON pir.seq=d.id LEFT JOIN records prr ON prr.seq=d.prr_seq WHERE pir.seq IS NULL OR pir.type!=5 OR pir.subtype!=10 OR prr.seq IS NULL OR prr.type!=5 OR prr.subtype!=20 OR pir.device_id IS NOT d.id OR prr.device_id IS NOT d.id LIMIT 1");
  if (badDevice) throw libraryError("CORRUPT", "Device attempts do not match their PIR/PRR records.");
  const badSpan = db.selectValue("SELECT 1 FROM records r LEFT JOIN records previous ON previous.seq=r.seq-1 WHERE (r.seq=1 AND r.offset!=0) OR (r.seq>1 AND (previous.seq IS NULL OR r.offset!=previous.offset+previous.length)) LIMIT 1");
  if (badSpan || db.selectValue("SELECT max(seq) FROM records") !== manifest.counts.records || db.selectValue("SELECT count(*) FROM meta") !== 1) {
    throw libraryError("CORRUPT", "Source record sequence or offsets are not contiguous.");
  }
  const end = db.selectValue("SELECT max(offset+length) FROM records");
  if (end !== manifest.source.size) throw libraryError("CORRUPT", "Record extent differs from the retained source size.");
}
