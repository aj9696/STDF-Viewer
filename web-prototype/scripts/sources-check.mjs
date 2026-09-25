import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_SOURCE_BYTES, inventoryFiles, inventoryDirectory, readCandidate,
  queryDirectoryPermission, reconnectDirectory, loadDirectoryHandle,
} from "../site/sources.js";
import { ImportQueue } from "../site/import-queue.js";

function file(name, contents = "stdf fixture", relativePath = "", lastModified = 12345) {
  const value = new File([contents], name, { lastModified });
  if (relativePath) Object.defineProperty(value, "webkitRelativePath", { value: relativePath });
  return value;
}
function fileHandle(value) {
  return { kind: "file", name: value.name, getFile: async () => value };
}
function directory(name, entries) {
  return { kind: "directory", name, async *values() { yield* entries; } };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const candidates = (...names) => inventoryFiles(names.map((name) => file(name))).items;
const resultFor = (value, duplicate = false) => ({ dataset: { id: value.name }, duplicate });
const withCode = (code) => (error) => error.code === code;

test("inventory admits raw/compressed formats, filters empty/large files, and sorts without a locale", () => {
  const huge = file("large.std");
  Object.defineProperty(huge, "size", { value: MAX_SOURCE_BYTES + 1 });
  const exact = file("limit.stf");
  Object.defineProperty(exact, "size", { value: MAX_SOURCE_BYTES });
  const result = inventoryFiles([file("z.std"), file("empty.stf", ""),
    file("a.STDF"), file("compressed.stdf.gz"), file("bzip.stdf.bz2"), file("bundle.zip"), file("notes.txt"), file("B.StF"), huge, exact]);
  assert.deepEqual(result.items.map((item) => item.name), ["B.StF", "a.STDF", "bundle.zip", "bzip.stdf.bz2", "compressed.stdf.gz", "limit.stf", "z.std"]);
  assert.deepEqual(result.skipped.map((item) => item.code), ["EMPTY_FILE", "FILE_TOO_LARGE", "UNSUPPORTED_EXTENSION"]);
  assert.equal(result.items[1].file.name, "a.STDF");
});

test("file-input root names are removed and nested files require explicit consent", () => {
  const inputs = [file("a.stdf", "a", "lot/a.stdf"), file("b.std", "b", "lot/sub/b.std")];
  assert.deepEqual(inventoryFiles(inputs).items.map((item) => item.relativePath), ["a.stdf"]);
  assert.equal(inventoryFiles(inputs).skipped[0].code, "SUBFOLDER_EXCLUDED");
  assert.deepEqual(inventoryFiles(inputs, { includeSubfolders: true }).items.map((item) => item.relativePath), ["a.stdf", "sub/b.std"]);
  assert.throws(() => inventoryFiles([...inputs, file("z.std", "z", "other/z.std")]), withCode("INVALID_PATH"));
});

test("inventory validates path identity, options, and a budget including rejected entries", () => {
  assert.throws(() => inventoryFiles([file("a.std"), file("a.std")]), withCode("DUPLICATE_PATH"));
  assert.equal(inventoryFiles([file("a.std"), file("A.std")]).items.length, 2);
  for (const path of ["root/../a.std", "root//a.std", "/root/a.std", "C:\\a.std"]) {
    assert.throws(() => inventoryFiles([file("a.std", "a", path)]), withCode("INVALID_PATH"));
  }
  assert.throws(() => inventoryFiles([file("a.std", "a", "root/b.std")]), withCode("INVALID_PATH"));
  for (const maxFiles of [0, -1, 1.5, 10001]) {
    assert.throws(() => inventoryFiles([], { maxFiles }), withCode("INVALID_OPTIONS"));
  }
  assert.throws(() => inventoryFiles([], { includeSubfolders: "yes" }), withCode("INVALID_OPTIONS"));
  assert.throws(() => inventoryFiles([], null), withCode("INVALID_OPTIONS"));
  assert.throws(() => inventoryFiles([file("a.txt"), file("b.txt")], { maxFiles: 1 }), withCode("INVENTORY_LIMIT"));
  assert.equal(inventoryFiles([file("a.txt")], { maxFiles: 1 }).skipped.length, 1);
});

test("directory traversal is deterministic, excludes nested folders by default, and reads no file bytes", async () => {
  const nested = directory("sub", [fileHandle(file("b.std"))]);
  const root = directory("root", [fileHandle(file("z.stdf")), nested, fileHandle(file("a.STF"))]);
  const shallow = await inventoryDirectory(root);
  assert.deepEqual(shallow.items.map((item) => item.relativePath), ["a.STF", "z.stdf"]);
  assert.equal(shallow.skipped[0].relativePath, "sub");
  const deep = await inventoryDirectory(root, { includeSubfolders: true });
  assert.deepEqual(deep.items.map((item) => item.relativePath), ["a.STF", "sub/b.std", "z.stdf"]);
  assert.equal(deep.items[1].file, undefined);
  assert.equal((await readCandidate(deep.items[1])).name, "b.std");
  await assert.rejects(inventoryDirectory(root, { maxFiles: 2 }), withCode("INVENTORY_LIMIT"));
  await assert.rejects(inventoryDirectory(root, { includeSubfolders: true, maxFiles: 3 }), withCode("INVENTORY_LIMIT"));
});

test("unreadable files are visible skips; incomplete enumeration is an error", async () => {
  const denied = { kind: "file", name: "locked.std", getFile: async () => { throw new Error("Permission denied"); } };
  const result = await inventoryDirectory(directory("root", [denied, fileHandle(file("good.stf"))]));
  assert.equal(result.items.length, 1);
  assert.equal(result.skipped[0].code, "SOURCE_UNREADABLE");
  const broken = { kind: "directory", async *values() { yield fileHandle(file("a.std")); throw new Error("Disconnected"); } };
  await assert.rejects(inventoryDirectory(broken), withCode("SOURCE_UNREADABLE"));
  await assert.rejects(inventoryDirectory(directory("root", [fileHandle(file("a.std")), fileHandle(file("a.std"))])), withCode("DUPLICATE_PATH"));
});

test("candidate reacquisition rejects size, time, and name changes; rescan sees replacement", async () => {
  let current = file("a.std", "123", "", 100);
  const handle = { kind: "file", name: current.name, getFile: async () => current };
  const root = directory("root", [handle]);
  const first = (await inventoryDirectory(root)).items[0];
  for (const replacement of [file("a.std", "1234", "", 100), file("a.std", "123", "", 101), file("b.std", "123", "", 100)]) {
    current = replacement;
    await assert.rejects(readCandidate(first), withCode("SOURCE_CHANGED"));
  }
  current = file("a.std", "replacement", "", 102);
  const refreshed = (await inventoryDirectory(root)).items[0];
  assert.equal(await readCandidate(refreshed), current);
});

test("permission checks never prompt; reconnect requests read permission only", async () => {
  const calls = [];
  const handle = { kind: "directory",
    queryPermission: async (options) => { calls.push(["query", options]); return "prompt"; },
    requestPermission: async (options) => { calls.push(["request", options]); return "granted"; },
  };
  assert.equal(await queryDirectoryPermission(handle), "prompt");
  assert.equal(calls.length, 1);
  assert.equal(await reconnectDirectory(handle), "granted");
  assert.deepEqual(calls, [["query", { mode: "read" }], ["request", { mode: "read" }]]);
  await assert.rejects(queryDirectoryPermission({ kind: "directory" }), withCode("UNSUPPORTED"));
  await assert.rejects(loadDirectoryHandle(), withCode("UNSUPPORTED"));
});

test("queue runs sequentially, reports duplicates, and continues after a file fails", async () => {
  let active = 0, maximum = 0;
  const paths = [], snapshots = [];
  const queue = new ImportQueue({
    async importFile(value, { relativePath }) {
      maximum = Math.max(maximum, ++active);
      paths.push(relativePath);
      await Promise.resolve();
      --active;
      if (value.name === "b.std") throw Object.assign(new Error("Malformed STDF"), { code: "INVALID_STDF" });
      return resultFor(value, value.name === "c.std");
    }, cancel() {},
  });
  const outcomes = await queue.run(candidates("d.std", "b.std", "c.std", "a.std"), { onProgress: (snapshot) => snapshots.push(snapshot) });
  assert.equal(maximum, 1);
  assert.deepEqual(paths, ["a.std", "b.std", "c.std", "d.std"]);
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ["ready", "failed", "duplicate", "ready"]);
  assert.deepEqual(outcomes[1].error, { code: "INVALID_STDF", message: "Malformed STDF" });
  assert.equal(snapshots[0].completed, 0);
  assert.equal(snapshots.at(-1).running, false);
  assert.equal(snapshots.at(-1).completed, 4);
  outcomes[0].dataset.id = "changed";
  assert.equal(queue.snapshot().outcomes[0].dataset.id, "a.std");
});

test("source changes fail individually before import", async () => {
  const changed = file("a.std", "different size");
  const items = [{ ...candidates("a.std")[0], handle: { getFile: async () => changed }, file: undefined }, ...candidates("b.std")];
  let imports = 0;
  const queue = new ImportQueue({ importFile: async (value) => { ++imports; return resultFor(value); }, cancel() {} });
  const outcomes = await queue.run(items);
  assert.equal(outcomes[0].error.code, "SOURCE_CHANGED");
  assert.equal(outcomes[1].status, "ready");
  assert.equal(imports, 1);
});

test("cancelling an active import stops future items and rejects concurrent runs", async () => {
  const started = deferred(), operation = deferred();
  let cancellations = 0;
  const queue = new ImportQueue({
    importFile: () => { started.resolve(); return operation.promise; },
    cancel: () => { ++cancellations; operation.reject(Object.assign(new Error("Stopped"), { code: "CANCELLED" })); },
  });
  const running = queue.run(candidates("a.std", "b.std"));
  await started.promise;
  await assert.rejects(queue.run([]), withCode("QUEUE_BUSY"));
  const firstCancel = queue.cancel();
  assert.equal(queue.cancel(), firstCancel);
  await firstCancel;
  const outcomes = await running;
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ["cancelled", "pending"]);
  assert.equal(cancellations, 1);
  assert.equal(queue.snapshot().completed, 1);
  await queue.run([]);
  assert.equal(queue.snapshot().total, 0);
});

test("cancelling before import or during acquisition does not call the storage client", async () => {
  let imports = 0, cancellations = 0;
  const queue = new ImportQueue({ importFile: async (value) => { ++imports; return resultFor(value); }, cancel: () => { ++cancellations; } });
  const outcomes = await queue.run(candidates("a.std"), { onProgress: () => { queue.cancel(); } });
  assert.equal(outcomes[0].status, "pending");
  const waiting = deferred(), reading = deferred();
  const item = candidates("a.std")[0];
  item.handle = { getFile: () => { reading.resolve(); return waiting.promise; } };
  const running = queue.run([item, ...candidates("b.std")]);
  await reading.promise;
  await queue.cancel();
  waiting.resolve(item.file);
  assert.deepEqual((await running).map((outcome) => outcome.status), ["cancelled", "pending"]);
  assert.equal(imports, 0);
  assert.equal(cancellations, 0);
});

test("completed imports win cancellation races; a failed cancellation is not a false cancelled outcome", async () => {
  const started = deferred(), operation = deferred();
  const queue = new ImportQueue({
    importFile: () => { started.resolve(); return operation.promise; },
    cancel: () => { throw new Error("Cannot cancel this commit"); },
  });
  const running = queue.run(candidates("a.std", "b.std"));
  await started.promise;
  await assert.rejects(queue.cancel(), /Cannot cancel this commit/);
  operation.resolve(resultFor(file("a.std")));
  assert.deepEqual((await running).map((outcome) => outcome.status), ["ready", "pending"]);
});

test("mutating or throwing observers cannot corrupt outcomes", async () => {
  const queue = new ImportQueue({ importFile: async (value) => resultFor(value), cancel() {} });
  const prior = console.error;
  let warnings = 0;
  console.error = () => { ++warnings; };
  try {
    const outcomes = await queue.run(candidates("a.std"), { onProgress: (snapshot) => {
      snapshot.outcomes[0].status = "failed";
      throw new Error("Render failed");
    } });
    assert.equal(outcomes[0].status, "ready");
    assert.equal(queue.snapshot().outcomes[0].status, "ready");
    assert.equal(warnings, 4);
  } finally { console.error = prior; }
});

test("a new run started by the completion callback cannot replace the previous result", async () => {
  const queue = new ImportQueue({ importFile: async (value) => resultFor(value), cancel() {} });
  let next;
  const outcomes = await queue.run(candidates("a.std"), { onProgress: (snapshot) => {
    if (!snapshot.running) next = queue.run(candidates("b.std"));
  } });
  assert.equal(outcomes[0].dataset.id, "a.std");
  assert.equal((await next)[0].dataset.id, "b.std");
});

test("a late cancellation cannot cross into a new run", async () => {
  const operation = deferred(), started = deferred();
  let cancellations = 0, next;
  const queue = new ImportQueue({
    importFile: (value) => value.name === "a.std" ? (started.resolve(), operation.promise) : resultFor(value),
    cancel: () => { ++cancellations; },
  });
  const first = queue.run(candidates("a.std"), { onProgress: (snapshot) => {
    if (!snapshot.running) next = queue.run(candidates("b.std"));
  } });
  await started.promise;
  operation.resolve(resultFor(file("a.std")));
  await queue.cancel();
  assert.equal((await first)[0].status, "ready");
  assert.equal((await next)[0].status, "ready");
  assert.equal(cancellations, 0);
});

test("invalid client, queue inputs, and import results fail explicitly", async () => {
  assert.throws(() => new ImportQueue({}), withCode("INVALID_CLIENT"));
  const queue = new ImportQueue({ importFile: async () => ({ dataset: {}, duplicate: "yes" }), cancel() {} });
  await assert.rejects(queue.run({}), withCode("INVALID_ITEMS"));
  await assert.rejects(queue.run([], { onProgress: true }), withCode("INVALID_ITEMS"));
  const result = await queue.run(candidates("a.std"));
  assert.equal(result[0].status, "failed");
  assert.equal(result[0].error.code, "INVALID_RESULT");
});
