import { CATALOG_APP_ID, CATALOG_TABLES, DATASET_APP_ID, TABLES, INDEXES,
  PARSER_VERSION, SCHEMA_VERSION, MAX_DATASETS, configureDatabase, createSchema,
  checkSchema, getManifest, libraryError } from "./dataset-schema.js";

const CATALOG = "/catalog.sqlite3";
const LOCK = "semidata-library-v1";
const ACTIVE = "('snapshot','parsing','validating','restoring')";

export class LibraryStore {
  async open() {
    if (this.catalog) return this.status();
    if (!self.isSecureContext || !navigator.storage?.getDirectory || !navigator.locks?.request ||
        typeof FileSystemFileHandle === "undefined" || !FileSystemFileHandle.prototype.createSyncAccessHandle) {
      throw libraryError("UNSUPPORTED", "A secure browser with OPFS and Web Locks is required. No temporary fallback is used.");
    }
    await new Promise((resolve, reject) => {
      this.lockTask = navigator.locks.request(LOCK, { ifAvailable: true }, async (lock) => {
        if (!lock) return reject(libraryError("BUSY", "This library is open in another tab. Close that connection and retry."));
        await new Promise((release) => { this.releaseLock = release; resolve(); });
      });
      this.lockTask.catch(reject);
    });
    try {
      const { default: init } = await import("./sqlite/index.mjs");
      this.sqlite3 = await init();
      this.pool = await this.sqlite3.installOpfsSAHPoolVfs({
        name: "semidata-library-sahpool", directory: ".semidata-library-v1", initialCapacity: 8,
      });
      const root = await navigator.storage.getDirectory();
      this.sources = await root.getDirectoryHandle("semidata-sources-v1", { create: true });
      this.exports = await root.getDirectoryHandle("semidata-exports-v1", { create: true });
      const files = this.pool.getFileNames();
      const exists = files.includes(CATALOG);
      if (!exists && (files.length || !(await this.sources.entries().next()).done)) {
        throw libraryError("NEEDS_RECOVERY", "Catalog is missing but library artifacts remain. No replacement catalog was created.");
      }
      this.catalog = new this.pool.OpfsSAHPoolDb(CATALOG, exists ? "w" : "c");
      configureDatabase(this.sqlite3, this.catalog);
      if (!exists) createSchema(this.catalog, CATALOG_APP_ID, CATALOG_TABLES);
      checkSchema(this.catalog, CATALOG_APP_ID, CATALOG_TABLES);
      if (this.catalog.selectValue("PRAGMA quick_check") !== "ok") throw libraryError("CORRUPT", "Library catalog failed its integrity check.");
      this.catalog.exec("PRAGMA synchronous=FULL");
      this.catalog.exec({ sql: `UPDATE jobs SET status='interrupted',updated_at=?,error_code='INTERRUPTED',error_message='Previous worker stopped before publication. Retry from the original file.' WHERE status IN ${ACTIVE}`,
        bind: [new Date().toISOString()] });
      return this.status();
    } catch (error) { await this.close(); throw error; }
  }

  async close() {
    try { this.catalog?.close(); this.catalog = null; this.pool?.pauseVfs(); }
    finally { this.releaseLock?.(); this.releaseLock = null; await this.lockTask; }
    return { closed: true };
  }
  status() {
    return { sqliteVersion: this.sqlite3.version.libVersion, schemaVersion: SCHEMA_VERSION,
      parserVersion: PARSER_VERSION, vfs: this.pool.vfsName, poolCapacity: this.pool.getCapacity(),
      poolFiles: this.pool.getFileCount(), sqliteMemoryBytes: this.sqlite3.wasm.heap8u().byteLength,
      datasets: this.catalog.selectValue("SELECT count(*) FROM datasets"),
      interrupted: this.catalog.selectValue("SELECT count(*) FROM jobs WHERE status='interrupted'") };
  }
  list(table, { offset = 0, limit = 50 } = {}) {
    if (!["datasets", "jobs"].includes(table) || !Number.isInteger(offset) || offset < 0 ||
        !Number.isInteger(limit) || limit < 1 || limit > 100) throw libraryError("INVALID_REQUEST", "Invalid library page.");
    const rows = this.catalog.selectObjects(`SELECT * FROM ${table} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`, [limit + 1, offset]);
    return { items: rows.slice(0, limit).map((row) => this.present(row)), nextOffset: rows.length > limit ? offset + limit : null };
  }
  present(row) {
    if (!row) return null;
    const { manifest_json, db_path, source_path, ...item } = row;
    return manifest_json ? { ...item, manifest: JSON.parse(manifest_json) } : item;
  }
  get(id) {
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw libraryError("INVALID_REQUEST", "Invalid dataset ID.");
    const row = this.catalog.selectObject("SELECT * FROM datasets WHERE id=?", [id]);
    if (!row) throw libraryError("NOT_FOUND", "Dataset is not in this library.");
    return row;
  }
  async access(id) {
    const dataset = this.get(id);
    if (dataset.status !== "ready") throw libraryError("UNAVAILABLE", "Dataset is marked unavailable. Recover it in a separate library from a verified package; this entry was preserved.");
    let db;
    try {
      if (!this.pool.getFileNames().includes(dataset.db_path)) throw new Error("Database file is missing");
      const file = await (await this.sources.getFileHandle(dataset.source_path)).getFile();
      if (file.size !== dataset.source_bytes) throw new Error("Source snapshot size has changed");
      db = new this.pool.OpfsSAHPoolDb(dataset.db_path, "r");
      configureDatabase(this.sqlite3, db);
      checkSchema(db, DATASET_APP_ID, TABLES, INDEXES);
      const manifest = getManifest(db);
      if (JSON.stringify(manifest) !== dataset.manifest_json) throw new Error("Dataset manifest differs from catalog");
      return { dataset, db, file, manifest };
    } catch (error) {
      db?.close();
      this.catalog.exec({ sql: "UPDATE datasets SET status='unavailable' WHERE id=?", bind: [id] });
      throw libraryError("UNAVAILABLE", `Dataset needs recovery: ${error.message}. Its catalog entry was preserved.`);
    }
  }
  async duplicate(hash) {
    const row = this.catalog.selectObject("SELECT * FROM datasets WHERE source_hash=? AND parser_version=? AND schema_version=?", [hash, PARSER_VERSION, SCHEMA_VERSION]);
    if (!row) return null;
    const opened = await this.access(row.id);
    opened.db.close();
    return this.present(row);
  }
  async createJob(kind, name, relativePath, size) {
    if (this.catalog.selectValue("SELECT count(*) FROM datasets") >= MAX_DATASETS ||
        this.catalog.selectValue("SELECT count(*) FROM jobs") >= 10000) {
      throw libraryError("LIBRARY_LIMIT", "Evaluation limit reached (1,000 datasets or 10,000 jobs). Export data before changing libraries.");
    }
    await this.pool.reserveMinimumCapacity(this.pool.getFileCount() + 6);
    const id = crypto.randomUUID(), time = new Date().toISOString();
    const job = { id, dbPath: `/dataset-${id}.sqlite3`, sourcePath: `${id}.stdf`, name, relativePath, size };
    this.catalog.exec({ sql: "INSERT INTO jobs(id,kind,status,created_at,updated_at,name,relative_path,source_bytes,db_path,source_path) VALUES(?,?,?,?,?,?,?,?,?,?)",
      bind: [id, kind, kind === "restore" ? "restoring" : "snapshot", time, time, name, relativePath, size, job.dbPath, job.sourcePath] });
    return job;
  }
  updateJob(job, status, error = null) {
    this.catalog.exec({ sql: "UPDATE jobs SET status=?,updated_at=?,error_code=?,error_message=? WHERE id=?",
      bind: [status, new Date().toISOString(), error?.code ?? null, error?.message?.slice(0, 2000) ?? null, job.id] });
  }
  publish(job, manifest, databaseBytes) {
    const id = job.id, time = new Date().toISOString();
    this.catalog.transaction(() => {
      this.catalog.exec({ sql: "INSERT INTO datasets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        bind: [id, manifest.source.sha256, PARSER_VERSION, SCHEMA_VERSION, job.name, job.relativePath,
          manifest.source.size, databaseBytes, job.dbPath, job.sourcePath, time, "ready", JSON.stringify(manifest)] });
      this.catalog.exec({ sql: "UPDATE jobs SET status='ready',updated_at=?,source_hash=?,dataset_id=? WHERE id=?",
        bind: [time, manifest.source.sha256, id, job.id] });
    });
    return this.present(this.get(id));
  }
  async cleanup(job) {
    // Call only for this job's known unpublished artifacts after DB handles close.
    if (this.catalog.selectValue("SELECT 1 FROM datasets WHERE id=?", [job.id])) return;
    this.pool.unlink(job.dbPath);
    this.pool.unlink(`${job.dbPath}-journal`);
    try { await this.sources.removeEntry(job.sourcePath); } catch (error) { if (error.name !== "NotFoundError") throw error; }
  }
}
