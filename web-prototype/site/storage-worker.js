// Isolated BL-1 probe: no STDF records or production-library schema live here.
const DATABASE = "/probe.sqlite3";
const RESTORE = "/restore.sqlite3";
const LOCK = "semidata-storage-proof-v1";
const APPLICATION_ID = 1396985936;
const MAX_BYTES = 1024 * 1024;
const TABLE_SQL = "CREATE TABLE probe(id INTEGER PRIMARY KEY CHECK(id=1), " +
  "note TEXT NOT NULL CHECK(length(note) BETWEEN 1 AND 200), saved_at TEXT NOT NULL)";
let sqlite3, pool, db, releaseLock, lockTask;
let handling = false;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

async function acquireOwnership() {
  await new Promise((resolve, reject) => {
    lockTask = navigator.locks.request(LOCK, { ifAvailable: true }, async (lock) => {
      if (!lock) return reject(Object.assign(new Error(
        "Storage is open in another tab. Close its storage connection and retry."), { code: "BUSY" }));
      await new Promise((release) => { releaseLock = release; resolve(); });
    });
    lockTask.catch(reject);
  });
}

function configure(connection) {
  connection.exec("PRAGMA trusted_schema=OFF");
  sqlite3.capi.sqlite3_db_config(connection.pointer,
    sqlite3.capi.SQLITE_DBCONFIG_DEFENSIVE, 1, 0);
}

function validate(connection) {
  if (connection.selectValue("PRAGMA application_id") !== APPLICATION_ID ||
      connection.selectValue("PRAGMA user_version") !== 1) {
    fail("INCOMPATIBLE", "This is not a supported version of the storage probe. No data was replaced.");
  }
  const schema = connection.selectObjects("SELECT type, name, sql FROM sqlite_schema ORDER BY name");
  if (schema.length !== 1 || schema[0].type !== "table" ||
      schema[0].name !== "probe" || schema[0].sql !== TABLE_SQL) {
    fail("INCOMPATIBLE", "Unexpected probe schema. No data was replaced.");
  }
  const size = connection.selectValue("PRAGMA page_size") * connection.selectValue("PRAGMA page_count");
  if (size > MAX_BYTES) fail("INCOMPATIBLE", "The storage proof is limited to a 1 MiB database.");
  if (connection.selectValue("PRAGMA quick_check") !== "ok") {
    fail("STORAGE_ERROR", "The probe failed its integrity check. Keep a copy for recovery.");
  }
  const rows = connection.selectObjects("SELECT id, note, saved_at FROM probe LIMIT 2");
  const row = rows[0] ?? null;
  if (rows.length > 1 || (row && (row.id !== 1 || typeof row.note !== "string" ||
      row.note.length < 1 || row.note.length > 200 || typeof row.saved_at !== "string" ||
      !Number.isFinite(Date.parse(row.saved_at))))) {
    fail("INCOMPATIBLE", "Invalid probe row. No data was replaced.");
  }
  return row;
}

function report() {
  return {
    row: validate(db), sqliteVersion: sqlite3.version.libVersion, vfs: pool.vfsName,
    wasmMemoryBytes: sqlite3.wasm.heap8u().byteLength,
    poolCapacity: pool.getCapacity(), poolFiles: pool.getFileCount(),
    pageSize: db.selectValue("PRAGMA page_size"), pageCount: db.selectValue("PRAGMA page_count"),
  };
}

async function open() {
  if (db) return report();
  if (!self.isSecureContext || !navigator.storage?.getDirectory || !navigator.locks?.request ||
      typeof FileSystemFileHandle === "undefined" ||
      !FileSystemFileHandle.prototype.createSyncAccessHandle) {
    fail("UNSUPPORTED", "Persistent storage requires a secure browser with OPFS and Web Locks. No temporary database was created.");
  }
  await acquireOwnership();
  try {
    if (!sqlite3) {
      const { default: init } = await import("./sqlite/index.mjs");
      sqlite3 = await init();
    }
    if (pool) await pool.unpauseVfs();
    else pool = await sqlite3.installOpfsSAHPoolVfs({
      name: "semidata-proof-sahpool", directory: ".semidata-storage-proof-v1", initialCapacity: 6,
    });
    const exists = pool.getFileNames().includes(DATABASE);
    db = new pool.OpfsSAHPoolDb(DATABASE, exists ? "w" : "c");
    configure(db);
    if (!exists) db.transaction(() => {
      db.exec(TABLE_SQL);
      db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1`);
    });
    validate(db);
    db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL");
    return report();
  } catch (error) {
    await close();
    throw error;
  }
}

async function close() {
  try { db?.close(); db = undefined; pool?.pauseVfs(); }
  finally { releaseLock?.(); releaseLock = undefined; await lockTask; }
  return { closed: true };
}

function writeRow(row) {
  db.transaction(() => {
    db.exec({ sql: "INSERT INTO probe(id,note,saved_at) VALUES(1,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET note=excluded.note,saved_at=excluded.saved_at",
    bind: [row.note, row.saved_at] });
  });
  return report();
}

async function restore(bytes) {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 512 || bytes.byteLength > MAX_BYTES) {
    fail("INVALID_BACKUP", "Select a probe SQLite backup between 512 bytes and 1 MiB.");
  }
  let candidate;
  try {
    pool.unlink(RESTORE); // Only the reserved staging name; never the live probe.
    pool.importDb(RESTORE, bytes);
    candidate = new pool.OpfsSAHPoolDb(RESTORE, "r");
    configure(candidate);
    const row = validate(candidate);
    if (!row) fail("INVALID_BACKUP", "The backup has no saved probe row.");
    // Import validation finishes before anything in the live database changes.
    return writeRow(row);
  } catch (error) {
    if (error.code) throw error;
    fail("INVALID_BACKUP", `Backup could not be restored: ${error.message}`);
  } finally {
    candidate?.close();
    pool.unlink(RESTORE);
  }
}

async function dispatch(message) {
  if (message.type === "open") return open();
  if (message.type === "close") return close();
  if (!db) fail("NOT_OPEN", "Open the storage proof first.");
  switch (message.type) {
    case "read": return report();
    case "write": {
      if (typeof message.note !== "string" || message.note.length < 1 || message.note.length > 200) {
        fail("INVALID_REQUEST", "The probe note must contain 1–200 characters.");
      }
      return writeRow({ note: message.note, saved_at: new Date().toISOString() });
    }
    case "export": {
      if (!validate(db)) fail("INVALID_REQUEST", "Save a note before exporting a probe backup.");
      return { bytes: pool.exportFile(DATABASE).buffer };
    }
    case "restore": return restore(message.bytes);
    default: fail("INVALID_REQUEST", "Unknown storage operation.");
  }
}

self.onmessage = async ({ data: message }) => {
  const id = message?.id;
  if (handling) {
    self.postMessage({ version: 1, id, ok: false, error: { code: "BUSY", message: "A storage operation is already running." } });
    return;
  }
  handling = true;
  try {
    if (message?.version !== 1 || !Number.isSafeInteger(id) || id < 1 || typeof message.type !== "string") {
      fail("INVALID_REQUEST", "Unsupported storage message or protocol version.");
    }
    const result = await dispatch(message);
    self.postMessage({ version: 1, id, ok: true, result }, result?.bytes ? [result.bytes] : []);
  } catch (error) {
    self.postMessage({ version: 1, id, ok: false,
      error: { code: error.code ?? "STORAGE_ERROR", message: String(error.message ?? error) } });
  } finally { handling = false; }
};
