import { MAX_SOURCE_BYTES, DATASET_APP_ID, TABLES, INDEXES, PARSER_VERSION, SCHEMA_VERSION,
  createSchema, configureDatabase, verifyDatabase, libraryError } from "./dataset-schema.js";

const INPUT_BYTES = 64 * 1024;
const COPY_BYTES = 1024 * 1024;
const TRANSACTION_BYTES = 4 * 1024 * 1024;
let parserRuntime;
export function loadParser() {
  return parserRuntime ??= import("./pkg/parser.js").then(async (runtime) => { await runtime.default(); return runtime; });
}
export async function hashFile(file, context, phase = "verify-source") {
  const { Sha256Hasher } = await loadParser();
  const hasher = new Sha256Hasher();
  try {
    for (let offset = 0; offset < file.size; offset += COPY_BYTES) {
      context.checkCancelled();
      hasher.update(new Uint8Array(await file.slice(offset, offset + COPY_BYTES).arrayBuffer()));
      context.progress({ phase, completedBytes: Math.min(offset + COPY_BYTES, file.size), totalBytes: file.size });
    }
    return hasher.finish();
  } finally { hasher.free(); }
}
function checkFile(file, relativePath) {
  if (!(file instanceof File) || file.size < 1 || file.size > MAX_SOURCE_BYTES ||
      !/\.(stdf|std|stf)$/i.test(file.name) || file.name.length > 1024 ||
      typeof relativePath !== "string" || relativePath.length < 1 || relativePath.length > 4096) {
    throw libraryError("INVALID_SOURCE", "Choose a raw .stdf/.std/.stf file up to 2 GiB with a valid relative path.");
  }
}

export async function importSource(store, file, relativePath, context) {
  checkFile(file, relativePath);
  const started = performance.now();
  const runtime = await loadParser();
  const job = await store.createJob("import", file.name, relativePath, file.size);
  let db, sourceHandle, parser;
  const statements = {};
  const metrics = { sourceBytes: file.size, parseMs: 0, writeMs: 0, inputBytes: INPUT_BYTES, copyBytes: COPY_BYTES };
  try {
    const snapshotStarted = performance.now();
    const snapshot = await store.sources.getFileHandle(job.sourcePath, { create: true });
    sourceHandle = await snapshot.createSyncAccessHandle();
    const hasher = new runtime.Sha256Hasher();
    let sourceHash;
    try {
      for (let offset = 0; offset < file.size; offset += COPY_BYTES) {
        context.checkCancelled();
        const bytes = new Uint8Array(await file.slice(offset, offset + COPY_BYTES).arrayBuffer());
        if (bytes.length !== Math.min(COPY_BYTES, file.size - offset)) throw libraryError("SOURCE_CHANGED", "Source ended while copying. Rescan and retry.");
        if (sourceHandle.write(bytes, { at: offset }) !== bytes.length) throw libraryError("STORAGE_ERROR", "Snapshot write was incomplete.");
        hasher.update(bytes);
        context.progress({ phase: "snapshot", jobId: job.id, completedBytes: offset + bytes.length, totalBytes: file.size });
      }
      sourceHandle.flush();
      sourceHash = hasher.finish();
    } finally { hasher.free(); sourceHandle.close(); sourceHandle = null; }
    const sourceFile = await snapshot.getFile();
    if (sourceFile.size !== file.size) throw libraryError("STORAGE_ERROR", "Snapshot size differs from the source.");
    metrics.snapshotMs = performance.now() - snapshotStarted;
    store.catalog.exec({ sql: "UPDATE jobs SET source_hash=? WHERE id=?", bind: [sourceHash, job.id] });
    const duplicate = await store.duplicate(sourceHash);
    if (duplicate) {
      store.updateJob(job, "duplicate");
      store.catalog.exec({ sql: "UPDATE jobs SET dataset_id=? WHERE id=?", bind: [duplicate.id, job.id] });
      await store.cleanup(job);
      return { dataset: duplicate, duplicate: true, metrics: { ...metrics, totalMs: performance.now() - started } };
    }
    context.checkCancelled();
    store.updateJob(job, "parsing");
    db = new store.pool.OpfsSAHPoolDb(job.dbPath, "c");
    configureDatabase(store.sqlite3, db);
    createSchema(db, DATASET_APP_ID, TABLES);
    for (const [table, columns] of [["records", 7], ["definitions", 4], ["measurements", 10], ["devices", 13]]) {
      statements[table] = db.prepare(`INSERT INTO ${table} VALUES(${Array(columns).fill("?").join(",")})`);
    }
    parser = new runtime.RetainedParser();
    db.exec("BEGIN");
    let sinceCommit = 0, lastProgress = 0;
    for (let offset = 0; offset < sourceFile.size; offset += INPUT_BYTES) {
      context.checkCancelled();
      const bytes = new Uint8Array(await sourceFile.slice(offset, offset + INPUT_BYTES).arrayBuffer());
      const parseStart = performance.now();
      const batch = JSON.parse(parser.push(bytes));
      metrics.parseMs += performance.now() - parseStart;
      const writeStart = performance.now();
      for (const table of ["definitions", "records", "measurements", "devices"]) {
        const statement = statements[table];
        for (const row of batch[table]) { statement.bind(row).step(); statement.reset(); }
      }
      sinceCommit += bytes.length;
      if (sinceCommit >= TRANSACTION_BYTES) { db.exec("COMMIT; BEGIN"); sinceCommit = 0; }
      metrics.writeMs += performance.now() - writeStart;
      if (performance.now() - lastProgress > 100 || offset === 0) {
        context.progress({ phase: "parsing", jobId: job.id, completedBytes: offset + bytes.length, totalBytes: file.size });
        lastProgress = performance.now();
      }
    }
    const summary = JSON.parse(parser.finish());
    metrics.parserMemoryBytes = parser.memory_bytes();
    db.exec("COMMIT");
    for (const statement of Object.values(statements)) statement.finalize();
    for (const key of Object.keys(statements)) delete statements[key];
    const validationStarted = performance.now();
    store.updateJob(job, "validating");
    context.progress({ phase: "validating", jobId: job.id, completedBytes: file.size, totalBytes: file.size });
    await new Promise((resolve) => setTimeout(resolve, 0));
    context.checkCancelled();
    for (const sql of Object.values(INDEXES)) db.exec(sql);
    const manifest = { schemaVersion: SCHEMA_VERSION, parserVersion: PARSER_VERSION,
      source: { name: file.name, relativePath, size: file.size, sha256: sourceHash },
      counts: { records: summary.records, measurements: summary.measurements, devices: summary.devices, definitions: summary.definitions },
      byteOrder: summary.byte_order, coverage: summary.coverage };
    db.exec({ sql: "INSERT INTO meta VALUES('manifest',?)", bind: [JSON.stringify(manifest)] });
    verifyDatabase(db, manifest);
    const databaseBytes = db.selectValue("PRAGMA page_count") * db.selectValue("PRAGMA page_size");
    metrics.validationMs = performance.now() - validationStarted;
    metrics.databaseBytes = databaseBytes;
    metrics.sqliteMemoryBytes = store.sqlite3.wasm.heap8u().byteLength;
    db.close(); db = null;
    context.progress({ phase: "publishing", jobId: job.id, completedBytes: file.size, totalBytes: file.size });
    await new Promise((resolve) => setTimeout(resolve, 0));
    context.checkCancelled();
    const dataset = store.publish(job, manifest, databaseBytes);
    return { dataset, duplicate: false, metrics: { ...metrics, totalMs: performance.now() - started } };
  } catch (error) {
    for (const statement of Object.values(statements)) statement.finalize();
    db?.close(); db = null; sourceHandle?.close(); sourceHandle = null;
    const failure = libraryError(error.name === "QuotaExceededError" ? "QUOTA_EXCEEDED" : (error.code ?? "IMPORT_FAILED"), String(error.message ?? error));
    // Preserve diagnostics even when cleanup is impossible (for example a full disk).
    try { store.updateJob(job, failure.code === "CANCELLED" ? "cancelled" : "failed", failure); } catch { /* Reopen marks this job interrupted. */ }
    try { await store.cleanup(job); } catch { /* Known staging remains associated with the failed job. */ }
    throw failure;
  } finally { parser?.free(); }
}
