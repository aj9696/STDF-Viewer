import { libraryError, configureDatabase, getManifest, verifyDatabase, checkSchema, DATASET_APP_ID, TABLES, INDEXES } from "./dataset-schema.js";
import { importSource, loadParser, hashFile } from "./import-source.js";

async function withDataset(store, id, callback) {
  const opened = await store.access(id);
  try { return await callback(opened); } finally { opened.db.close(); }
}
async function exportDataset(store, id, context) {
  const { exportPackage } = await import("./transfer.js");
  const { Sha256Hasher } = await loadParser();
  return withDataset(store, id, async ({ db, file, manifest }) => {
    let retainedExports = 0;
    for await (const entry of store.exports.values()) {
      if (++retainedExports >= 10000) throw libraryError("LIBRARY_LIMIT", "Release temporary exports before creating more packages.");
    }
    const name = `${crypto.randomUUID()}.sdlibrary`;
    const handle = await store.exports.getFileHandle(name, { create: true });
    try {
      const result = await exportPackage({ db, sourceFile: file, manifest,
        createHasher: () => new Sha256Hasher(), writable: await handle.createWritable(),
        onProgress: (event) => context.progress(event), checkCancelled: () => context.checkCancelled() });
      return { ...result, file: await handle.getFile(), filename: `${manifest.source.name}.sdlibrary`, exportToken: name };
    } catch (error) { await store.exports.removeEntry(name).catch(() => {}); throw error; }
  });
}
async function restoreDataset(store, file, context) {
  if (!(file instanceof File)) throw libraryError("INVALID_REQUEST", "Select a portable .sdlibrary package.");
  const transfer = await import("./transfer.js");
  const { Sha256Hasher } = await loadParser();
  const hooks = { createHasher: () => new Sha256Hasher(),
    onProgress: (event) => context.progress(event), checkCancelled: () => context.checkCancelled() };
  // Verify before duplicate detection: even duplicate packages must be intact.
  const { manifest } = await transfer.verifyPackage({ file, ...hooks });
  const duplicate = await store.duplicate(manifest.source.sha256);
  if (duplicate) return { dataset: duplicate, duplicate: true };
  const job = await store.createJob("restore", manifest.source.name, manifest.source.relativePath, manifest.source.size);
  let db;
  try {
    const sourceHandle = await store.sources.getFileHandle(job.sourcePath, { create: true });
    await transfer.restorePackage({ file, pool: store.pool, databaseName: job.dbPath,
      sourceWritable: await sourceHandle.createWritable(), ...hooks });
    db = new store.pool.OpfsSAHPoolDb(job.dbPath, "r");
    configureDatabase(store.sqlite3, db);
    checkSchema(db, DATASET_APP_ID, TABLES, INDEXES);
    const storedManifest = getManifest(db);
    if (JSON.stringify(storedManifest) !== JSON.stringify(manifest)) throw libraryError("CORRUPT", "Package and database manifests differ.");
    verifyDatabase(db, manifest);
    const size = db.selectValue("PRAGMA page_count") * db.selectValue("PRAGMA page_size");
    db.close(); db = null;
    context.checkCancelled();
    return { dataset: store.publish(job, manifest, size), duplicate: false };
  } catch (error) {
    db?.close();
    try { store.updateJob(job, error.code === "CANCELLED" ? "cancelled" : "failed", error); } catch { /* Recovery records interruption. */ }
    await store.cleanup(job).catch(() => {});
    throw error;
  }
}

export async function runOperation(store, message, context) {
  switch (message.type) {
    case "importFile": return importSource(store, message.file, message.relativePath ?? message.file?.name, context);
    case "exportDataset": return exportDataset(store, message.datasetId, context);
    case "restorePackage": return restoreDataset(store, message.file, context);
    case "readRows": return withDataset(store, message.datasetId, ({ db }) => {
      const keys = { records: "seq", measurements: "seq", devices: "id", definitions: "id" };
      const key = Object.hasOwn(keys, message.table) ? keys[message.table] : null;
      const after = message.after ?? 0, limit = message.limit ?? 100;
      if (!key || !Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
        throw libraryError("INVALID_REQUEST", "Choose a known table, nonnegative cursor, and page size 1–1000.");
      }
      const rows = db.selectObjects(`SELECT * FROM ${message.table} WHERE ${key}>? ORDER BY ${key} LIMIT ?`, [after, limit + 1]);
      const items = rows.slice(0, limit);
      if (JSON.stringify(items).length > 2 * 1024 * 1024) throw libraryError("PAGE_TOO_LARGE", "Request fewer rows; this page exceeds 2 MiB.");
      return { items, nextAfter: rows.length > limit ? items.at(-1)[key] : null };
    });
    case "readRecord": return withDataset(store, message.datasetId, async ({ db, file }) => {
      if (!Number.isSafeInteger(message.seq) || message.seq < 1) throw libraryError("INVALID_REQUEST", "Record sequence must be positive.");
      const record = db.selectObject("SELECT * FROM records WHERE seq=?", [message.seq]);
      if (!record) throw libraryError("NOT_FOUND", "Record not found.");
      if (record.offset < 0 || record.length < 4 || record.length > 65539 || record.offset + record.length > file.size) throw libraryError("CORRUPT", "Record points outside the source.");
      return { record, bytes: await file.slice(record.offset, record.offset + record.length).arrayBuffer() };
    });
    case "verifyDataset": return withDataset(store, message.datasetId, async ({ db, file, manifest }) => {
      verifyDatabase(db, manifest);
      const sha256 = await hashFile(file, context);
      if (sha256 !== manifest.source.sha256) throw libraryError("CORRUPT", "Source snapshot checksum differs from its manifest.");
      return { verified: true, sha256, counts: manifest.counts, verifiedAt: new Date().toISOString() };
    });
    case "discardJob": {
      const row = store.catalog.selectObject("SELECT * FROM jobs WHERE id=?", [String(message.jobId)]);
      if (!row || !["failed", "cancelled", "interrupted", "discarded"].includes(row.status)) {
        throw libraryError("INVALID_REQUEST", "Only a known incomplete job can be discarded.");
      }
      await store.cleanup({ id: row.id, dbPath: row.db_path, sourcePath: row.source_path });
      store.updateJob({ id: row.id }, "discarded");
      return { discarded: true };
    }
    case "listExports": {
      const offset = message.offset ?? 0, limit = message.limit ?? 50;
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw libraryError("INVALID_REQUEST", "Invalid export inventory page.");
      const names = [];
      for await (const [name, handle] of store.exports.entries()) {
        if (handle.kind === "file" && /^[0-9a-f-]{36}\.sdlibrary$/.test(name)) names.push(name);
        if (names.length > 10000) throw libraryError("LIBRARY_LIMIT", "Temporary export inventory exceeds its evaluation limit.");
      }
      names.sort();
      const items = [];
      for (const name of names.slice(offset, offset + limit)) {
        const file = await (await store.exports.getFileHandle(name)).getFile();
        items.push({ exportToken: name, bytes: file.size, lastModified: file.lastModified });
      }
      return { items, nextOffset: names.length > offset + limit ? offset + limit : null };
    }
    case "releaseExport": {
      if (typeof message.exportToken !== "string" || !/^[0-9a-f-]{36}\.sdlibrary$/.test(message.exportToken)) throw libraryError("INVALID_REQUEST", "Invalid export token.");
      await store.exports.removeEntry(message.exportToken);
      return { released: true };
    }
    default: throw libraryError("INVALID_REQUEST", "Unknown library operation.");
  }
}
