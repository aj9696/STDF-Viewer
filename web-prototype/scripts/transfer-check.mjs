import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspectPackage, verifyPackage, exportPackage, restorePackage } from "../site/transfer.js";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = Buffer.from("Independent STDF source fixture bytes.");
const database = Buffer.alloc(4096, 0x33);
database.write("SQLite format 3\0");
const manifest = {
  schemaVersion: 1, parserVersion: "retained-v1",
  source: { name: "fixture.stdf", relativePath: "lot/fixture.stdf", size: source.length, sha256: digest(source) },
  counts: { records: 12, measurements: 4, devices: 2, definitions: 2 },
  byteOrder: "little", coverage: { retained: ["PTR", "PIR", "PRR"] },
};

function packageBytes(headerChanges = {}, sourceBytes = source, dbBytes = database) {
  const header = Buffer.from(JSON.stringify({ formatVersion: 1, manifest,
    sourceBytes: sourceBytes.length, databaseBytes: dbBytes.length, ...headerChanges }));
  const prefix = Buffer.alloc(12);
  prefix.write("SDPKG001"); prefix.writeUInt32LE(header.length, 8);
  const content = Buffer.concat([prefix, header, sourceBytes, dbBytes]);
  return Buffer.concat([content, Buffer.from(digest(content))]);
}

const fixture = packageBytes();
const inspected = await inspectPackage(new Blob([fixture]));
assert.equal(inspected.footerOffset + 64, fixture.length);
assert.deepEqual(inspected.header.manifest, manifest);
await assert.rejects(inspectPackage(new Blob([packageBytes({ formatVersion: 2 })])), { code: "INCOMPATIBLE" });
await assert.rejects(inspectPackage(new Blob([fixture.subarray(0, -1)])), { code: "INVALID_PACKAGE" });
await assert.rejects(inspectPackage(new Blob([fixture, Buffer.from([0])])), { code: "INVALID_PACKAGE" });
await assert.rejects(inspectPackage(new Blob([packageBytes({ sourceBytes: -1 })])), { code: "INVALID_PACKAGE" });
console.log("PASS: package framing, manifest versions, sizes, truncation, and trailing bytes.");

let liveHashers = 0;
function createHasher() {
  const hash = createHash("sha256"); ++liveHashers;
  return { update: (bytes) => hash.update(bytes), finish: () => hash.digest("hex"),
    free: () => { --liveHashers; } };
}
assert.deepEqual(await verifyPackage({ file: new Blob([fixture]), createHasher, chunkBytes: 512 }), inspected.header);
assert.equal(liveHashers, 0);
const alteredSource = Buffer.from(source); alteredSource[0] ^= 1;
await assert.rejects(verifyPackage({ file: new Blob([packageBytes({}, alteredSource)]), createHasher }),
  { code: "INVALID_PACKAGE", message: "Package source digest does not match." });
const alteredPayload = Buffer.from(fixture); alteredPayload[inspected.databaseOffset + 45] ^= 1;
await assert.rejects(verifyPackage({ file: new Blob([alteredPayload]), createHasher }),
  { code: "INVALID_PACKAGE", message: "Library package checksum does not match." });
const noSqlite = Buffer.from(database); noSqlite[0] ^= 1;
await assert.rejects(verifyPackage({ file: new Blob([packageBytes({}, source, noSqlite)]), createHasher }),
  { code: "INVALID_PACKAGE", message: "Package database has no SQLite file header." });
let cancellationChecks = 0;
await assert.rejects(verifyPackage({ file: new Blob([fixture]), createHasher, chunkBytes: 512,
  checkCancelled: () => { if (++cancellationChecks === 5) throw Object.assign(new Error("Cancelled"), { code: "CANCELLED" }); } }),
  { code: "CANCELLED" });
assert.equal(liveHashers, 0);
console.log("PASS: independent source/package checksums, SQLite header, cancellation, and hasher cleanup.");

function sink({ failAt = Infinity } = {}) {
  return { chunks: [], writing: false, closed: false, aborted: false, calls: 0,
    async write(bytes) {
      assert.equal(this.writing, false, "writes must await the previous sink write");
      this.writing = true; ++this.calls;
      try {
        await new Promise((resolve) => setImmediate(resolve));
        if (this.calls >= failAt) throw new Error("Injected sink failure");
        this.chunks.push(Buffer.from(bytes));
      } finally { this.writing = false; }
    },
    async close() { assert.equal(this.writing, false); this.closed = true; },
    async abort() { this.aborted = true; },
  };
}

function fakeDb(bytes = database, targetSink) {
  return { active: false, finalized: false, statements: [], pageSize: 512,
    exec(sql) {
      this.statements.push(sql);
      if (sql === "BEGIN") { assert.equal(this.active, false); this.active = true; }
      else if (sql === "ROLLBACK") { assert.equal(this.active, true); this.active = false; }
      else assert.fail("Unexpected SQL: " + sql);
    },
    selectValue(sql) { return sql === "PRAGMA page_size" ? this.pageSize : bytes.length / this.pageSize; },
    prepare(sql) {
      assert.equal(sql, "SELECT pgno, data FROM sqlite_dbpage('main') ORDER BY pgno");
      let page = 0; const owner = this;
      return {
        step() { assert.equal(targetSink?.writing ?? false, false, "cursor advanced before sink consumed the page"); return ++page <= bytes.length / owner.pageSize; },
        get() { return page; },
        getBlob() { return new Uint8Array(bytes.buffer, bytes.byteOffset + (page - 1) * owner.pageSize, owner.pageSize); },
        finalize() { owner.finalized = true; },
      };
    },
  };
}

const exportedSink = sink(), exportedDb = fakeDb(database, exportedSink);
const exported = await exportPackage({ db: exportedDb, sourceFile: new Blob([source]), manifest,
  createHasher, writable: exportedSink, chunkBytes: 512 });
assert.deepEqual(Buffer.concat(exportedSink.chunks), fixture);
assert.equal(exported.bytes, fixture.length);
assert.equal(exported.sha256, digest(fixture.subarray(0, -64)));
assert.equal(exportedDb.active, false); assert.equal(exportedDb.finalized, true);
assert.equal(exportedSink.closed, true); assert.equal(exportedSink.aborted, false);
assert.ok(exportedSink.chunks.every((chunk) => chunk.length <= 512));
const failedSink = sink({ failAt: 5 }), failedDb = fakeDb(database, failedSink);
await assert.rejects(exportPackage({ db: failedDb, sourceFile: new Blob([source]), manifest,
  createHasher, writable: failedSink }), /Injected sink failure/);
assert.equal(failedSink.closed, false); assert.equal(failedSink.aborted, true);
assert.equal(failedDb.active, false); assert.equal(failedDb.finalized, true);
assert.equal(liveHashers, 0);
console.log("PASS: byte-identical export, bounded writes, awaited backpressure, and failed-write cleanup.");

function fakePool(names = []) {
  return { calls: 0, chunks: [], getFileNames: () => names,
    async importDb(name, callback) {
      ++this.calls; assert.equal(names.includes(name), false);
      let bytes;
      while ((bytes = await callback()) !== undefined) {
        this.chunks.push(Buffer.from(bytes));
        await new Promise((resolve) => setImmediate(resolve));
      }
      names.push(name);
      return this.chunks.reduce((size, chunk) => size + chunk.length, 0);
    },
  };
}

const restoredSink = sink(), restoredPool = fakePool();
let verificationFinished = false;
const restoreWrite = restoredSink.write;
restoredSink.write = function (bytes) {
  assert.equal(verificationFinished, true, "restore wrote before full verification");
  return restoreWrite.call(this, bytes);
};
const restoredHeader = await restorePackage({ file: new Blob([fixture]), pool: restoredPool,
  databaseName: "/restored.sqlite3", sourceWritable: restoredSink, createHasher, chunkBytes: 512,
  onProgress: (event) => { if (event.phase === "verify" && event.completedBytes === event.totalBytes) verificationFinished = true; },
});
assert.deepEqual(restoredHeader, inspected.header);
assert.deepEqual(Buffer.concat(restoredSink.chunks), source);
assert.deepEqual(Buffer.concat(restoredPool.chunks), database);
assert.ok(restoredPool.chunks.every((chunk) => chunk.length <= 512));
assert.ok(restoredPool.chunks[0].length >= 512);
assert.equal(restoredSink.closed, true); assert.equal(restoredSink.aborted, false);
const duplicateSink = sink();
await assert.rejects(restorePackage({ file: new Blob([fixture]), pool: restoredPool,
  databaseName: "/restored.sqlite3", sourceWritable: duplicateSink, createHasher }), { code: "ALREADY_EXISTS" });
assert.equal(restoredPool.calls, 1); assert.equal(duplicateSink.calls, 0); assert.equal(duplicateSink.aborted, true);
const corruptSink = sink(), corruptPool = fakePool();
await assert.rejects(restorePackage({ file: new Blob([alteredPayload]), pool: corruptPool,
  databaseName: "/corrupt.sqlite3", sourceWritable: corruptSink, createHasher }), { code: "INVALID_PACKAGE" });
assert.equal(corruptSink.calls, 0); assert.equal(corruptPool.calls, 0); assert.equal(corruptSink.aborted, true);
assert.equal(liveHashers, 0);
console.log("PASS: source/database restore equality, complete verification before writes, and overwrite refusal.");

for (const invalidManifest of [
  { ...manifest, schemaVersion: 2 }, { ...manifest, parserVersion: "future" },
  { ...manifest, counts: { ...manifest.counts, devices: 0.5 } },
  { ...manifest, counts: { ...manifest.counts, records: Number.MAX_SAFE_INTEGER + 1 } },
  { ...manifest, byteOrder: "unknown" }, { ...manifest, coverage: [] },
  { ...manifest, source: { ...manifest.source, size: source.length + 1 } },
  { ...manifest, source: { ...manifest.source, sha256: "0" } },
  { ...manifest, source: { ...manifest.source, name: "a".repeat(1025) } },
  { ...manifest, source: { ...manifest.source, relativePath: "a".repeat(4097) } },
]) {
  await assert.rejects(inspectPackage(new Blob([packageBytes({ manifest: invalidManifest })])));
}
for (const databaseBytes of [0, 511, 513, -512, Number.MAX_SAFE_INTEGER + 1]) {
  await assert.rejects(inspectPackage(new Blob([packageBytes({ databaseBytes })])), { code: "INVALID_PACKAGE" });
}
const badMagic = Buffer.from(fixture); badMagic[0] = 0;
const bigHeader = Buffer.from(fixture); bigHeader.writeUInt32LE(65537, 8);
const badJson = Buffer.from(fixture); badJson[12] = 0xff;
for (const bytes of [badMagic, bigHeader, badJson]) {
  await assert.rejects(inspectPackage(new Blob([bytes])), { code: "INVALID_PACKAGE" });
}
await assert.rejects(inspectPackage({ size: 8 * 1024 ** 3 + 1, slice() { assert.fail("oversize file read"); } }), { code: "INVALID_PACKAGE" });
for (const chunkBytes of [0, 511, 1024 * 1024 + 1, 1024.5]) {
  await assert.rejects(verifyPackage({ file: new Blob([fixture]), createHasher, chunkBytes }), { code: "INVALID_REQUEST" });
}
const badFooter = Buffer.from(fixture); badFooter[badFooter.length - 1] = 0xff;
await assert.rejects(verifyPackage({ file: new Blob([badFooter]), createHasher }), { code: "INVALID_PACKAGE" });
console.log("PASS: manifest/schema/parser versions, numeric bounds, header/footer encoding, and package/chunk caps.");

const restoreFailedSink = sink({ failAt: 1 }), neverImportPool = fakePool();
await assert.rejects(restorePackage({ file: new Blob([fixture]), pool: neverImportPool,
  databaseName: "/write-failure.sqlite3", sourceWritable: restoreFailedSink, createHasher }), /Injected sink failure/);
assert.equal(neverImportPool.calls, 0); assert.equal(restoreFailedSink.aborted, true);
const poolFailedSink = sink(), poolFailure = fakePool();
poolFailure.importDb = async (_name, callback) => { await callback(); throw new Error("Injected SQLite write failure"); };
await assert.rejects(restorePackage({ file: new Blob([fixture]), pool: poolFailure,
  databaseName: "/pool-failure.sqlite3", sourceWritable: poolFailedSink, createHasher }), /Injected SQLite write failure/);
assert.equal(poolFailedSink.closed, false); assert.equal(poolFailedSink.aborted, true);
let restoreStarted = false;
const cancelledSink = sink(), cancelledPool = fakePool();
await assert.rejects(restorePackage({ file: new Blob([fixture]), pool: cancelledPool,
  databaseName: "/cancelled.sqlite3", sourceWritable: cancelledSink, createHasher,
  onProgress: (event) => { if (event.phase === "restore") restoreStarted = true; },
  checkCancelled: () => { if (restoreStarted) throw Object.assign(new Error("Cancelled"), { code: "CANCELLED" }); },
}), { code: "CANCELLED" });
assert.equal(cancelledPool.calls, 0); assert.equal(cancelledSink.closed, false); assert.equal(cancelledSink.aborted, true);
const outerTransactionDb = fakeDb(); outerTransactionDb.active = true;
await assert.rejects(exportPackage({ db: outerTransactionDb, sourceFile: new Blob([source]), manifest,
  createHasher, writable: sink() }));
assert.equal(outerTransactionDb.active, true, "export must not roll back a transaction it did not start");
const mismatchedSink = sink(), mismatchedDb = fakeDb();
await assert.rejects(exportPackage({ db: mismatchedDb, sourceFile: new Blob([alteredSource]), manifest,
  createHasher, writable: mismatchedSink }), { code: "INVALID_PACKAGE" });
assert.equal(mismatchedDb.active, false); assert.equal(mismatchedSink.aborted, true);
assert.equal(liveHashers, 0);
console.log("PASS: restore write failures/cancellation, source verification, and owned transaction cleanup.");

const largerSource = Buffer.alloc(160 * 1024 + 19, 0xab);
const largerManifest = { ...manifest, source: { ...manifest.source, size: largerSource.length, sha256: digest(largerSource) } };
const largerBytes = packageBytes({ manifest: largerManifest }, largerSource);
let maxRead = 0;
const fileWithReadBudget = (bytes) => ({ size: bytes.length, slice(start, end) {
  maxRead = Math.max(maxRead, end - start);
  assert.ok(end - start <= 65536, "reader exceeded its fixed budget");
  return new Blob([bytes.subarray(start, end)]);
} });
const largerSink = sink(), largerPool = fakePool();
await restorePackage({ file: fileWithReadBudget(largerBytes), pool: largerPool,
  databaseName: "/larger.sqlite3", sourceWritable: largerSink, createHasher });
assert.equal(maxRead, 65536);
assert.deepEqual(Buffer.concat(largerSink.chunks), largerSource);
assert.ok(largerSink.chunks.every((chunk) => chunk.length <= 65536));
assert.equal(liveHashers, 0);
console.log("PASS: source larger than transfer buffer restores through bounded reads and writes.");
