// Browser source/handle checks use only this script's fresh profile and fixtures.
// OPFS handle permission is not evidence for native OS folder-picker prompts.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const site = resolve(root, "site"), repo = resolve(root, "..");
const channel = process.argv[2] ?? "chrome";
if (!["chrome", "msedge"].includes(channel)) throw new Error("Use chrome or msedge");
const golden = await readFile(resolve(repo, ".venv/library-fixtures/golden-little.stdf"));
assert.ok(golden.length > 0 && golden.length < 65536, "Generate the small library golden fixtures first.");
const output = resolve(root, "results", `sources-${channel}-${Date.now()}`);
const profile = resolve(output, "profile"), fallback = resolve(output, "fallback-fixture");
await mkdir(resolve(fallback, "nested"), { recursive: true });
await writeFile(resolve(fallback, "a.stdf"), golden);
await writeFile(resolve(fallback, "z.STD"), golden);
await writeFile(resolve(fallback, "nested", "deep.stf"), golden);
await writeFile(resolve(fallback, "notes.txt"), "Not an STDF source.\n");

const server = createServer(async (request, response) => {
  try {
    const path = resolve(site, "." + decodeURIComponent(new URL(request.url, "http://localhost").pathname));
    if (!path.startsWith(site + sep)) throw new Error("Outside site");
    const content = await readFile(path);
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
      ".css": "text/css", ".wasm": "application/wasm" })[extname(path)] ?? "application/octet-stream");
    response.end(content);
  } catch { response.writeHead(404); response.end("Not found"); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = { recordedAt: new Date().toISOString(), channel, origin, checks: [],
  limitations: ["Native OS directory-picker UI and permission grants/denials are not automated or qualified by this test.",
    "The saved handle originates in OPFS; it exercises browser serialization and read APIs, not native filesystem permission persistence."] };
let context;
function passed(name, evidence = {}) {
  report.checks.push({ ...evidence, name });
  console.log(`PASS: ${name}`);
}
async function pageReady() {
  const page = await context.newPage();
  await page.goto(`${origin}/foundation.html`);
  await page.waitForFunction(() => document.getElementById("folder-status").textContent || document.getElementById("storage-status").textContent.includes("Origin:"));
  return page;
}

try {
  context = await chromium.launchPersistentContext(profile, { channel, headless: true });
  report.browserVersion = context.browser().version();
  const page = await pageReady();
  const inventory = await page.evaluate(async (goldenBytes) => {
    const api = await import("./sources.js");
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("source-inventory-fixture", { create: true });
    const nested = await directory.getDirectoryHandle("nested", { create: true });
    const write = async (parent, name, value) => {
      const sink = await (await parent.getFileHandle(name, { create: true })).createWritable();
      await sink.write(value); await sink.close();
    };
    for (const name of ["z.std", "a.STDF"]) await write(directory, name, Uint8Array.from(goldenBytes));
    await write(nested, "deep.stf", Uint8Array.from(goldenBytes));
    await write(directory, "notes.txt", "Not an STDF source.");
    const shallow = await api.inventoryDirectory(directory);
    const deep = await api.inventoryDirectory(directory, { includeSubfolders: true });
    const permission = await api.queryDirectoryPermission(directory);
    await api.saveDirectoryHandle(directory);
    const saved = await api.loadDirectoryHandle();
    return {
      shallow: shallow.items.map((item) => item.relativePath),
      skipped: shallow.skipped.map((item) => ({ path: item.relativePath, code: item.code })),
      deep: deep.items.map((item) => item.relativePath), permission,
      savedName: saved.name, savedKind: saved.kind,
      sameEntry: await directory.isSameEntry(saved),
    };
  }, Array.from(golden));
  assert.deepEqual(inventory.shallow, ["a.STDF", "z.std"]);
  assert.deepEqual(inventory.deep, ["a.STDF", "nested/deep.stf", "z.std"]);
  assert.deepEqual(inventory.skipped, [{ path: "nested", code: "SUBFOLDER_EXCLUDED" }, { path: "notes.txt", code: "UNSUPPORTED_EXTENSION" }]);
  assert.equal(inventory.permission, "granted");
  assert.equal(inventory.sameEntry, true);
  assert.equal(inventory.savedKind, "directory");
  assert.equal(inventory.savedName, "source-inventory-fixture");
  passed("real OPFS directory inventory, explicit subfolders, read permission and IndexedDB handle round-trip", inventory);

  const rescan = await page.evaluate(async () => {
    const api = await import("./sources.js");
    const directory = await api.loadDirectoryHandle();
    const before = await api.inventoryDirectory(directory);
    const candidate = before.items.find((item) => item.name === "a.STDF");
    const original = await api.readCandidate(candidate);
    const sink = await candidate.handle.createWritable();
    await sink.write(new Blob([original, "x"])); await sink.close();
    let changedCode;
    try { await api.readCandidate(candidate); } catch (error) { changedCode = error.code; }
    const added = await (await directory.getFileHandle("new.stdf", { create: true })).createWritable();
    await added.write("fixture metadata only"); await added.close();
    await directory.removeEntry("z.std");
    const after = await api.inventoryDirectory(directory, { includeSubfolders: true });
    let limitCode;
    try { await api.inventoryDirectory(directory, { maxFiles: 1 }); } catch (error) { limitCode = error.code; }
    return { changedCode, limitCode, previousSize: candidate.size,
      nextSize: after.items.find((item) => item.name === "a.STDF").size,
      paths: after.items.map((item) => item.relativePath) };
  });
  assert.equal(rescan.changedCode, "SOURCE_CHANGED");
  assert.equal(rescan.limitCode, "INVENTORY_LIMIT");
  assert.equal(rescan.nextSize, rescan.previousSize + 1);
  assert.deepEqual(rescan.paths, ["a.STDF", "nested/deep.stf", "new.stdf"]);
  passed("real File reacquisition detects modification; explicit rescan sees additions/deletions and enforces entry budget", rescan);

  await context.close(); context = null;
  context = await chromium.launchPersistentContext(profile, { channel, headless: true });
  const restarted = await pageReady();
  await restarted.waitForFunction(() => document.getElementById("folder-status").textContent.includes("Remembered folder: source-inventory-fixture"));
  const persisted = await restarted.evaluate(async () => {
    const api = await import("./sources.js"), handle = await api.loadDirectoryHandle();
    return { kind: handle.kind, name: handle.name, permission: await api.queryDirectoryPermission(handle),
      paths: (await api.inventoryDirectory(handle, { includeSubfolders: true })).items.map((item) => item.relativePath),
      inventoryText: document.getElementById("inventory-summary").textContent };
  });
  assert.equal(persisted.kind, "directory");
  assert.equal(persisted.name, "source-inventory-fixture");
  assert.equal(persisted.permission, "granted");
  assert.deepEqual(persisted.paths, rescan.paths);
  assert.equal(persisted.inventoryText, "No inventory.");
  passed("actual browser process restart preserves IndexedDB directory handle without auto-inventory", persisted);

  await restarted.locator("#directory-files").setInputFiles(fallback);
  await restarted.waitForFunction(() => document.getElementById("status").textContent === "Review sources complete");
  assert.match(await restarted.locator("#inventory-summary").innerText(), /2 importable files.*2 skipped/);
  assert.equal(await restarted.locator("#rescan-directory").isDisabled(), true);
  assert.equal(await restarted.locator("#import-files").isDisabled(), true, "Inventory alone must not open or import into the library.");
  const selected = await restarted.locator("#directory-files").evaluate((input) =>
    Array.from(input.files, (file) => file.webkitRelativePath).sort());
  assert.equal(selected.length, 4);
  assert.ok(selected.every((path) => path.startsWith("fallback-fixture/")));
  await restarted.locator("#include-subfolders").check();
  await restarted.waitForFunction(() => document.getElementById("status").textContent === "Review subfolder selection complete");
  assert.match(await restarted.locator("#inventory-summary").innerText(), /3 importable files.*1 skipped/);
  assert.match(await restarted.locator("#inventory-table").innerText(), /nested\/deep.stf/);
  passed("actual webkitdirectory input through console preserves relative paths and requires subfolder opt-in", { selected });

  await restarted.locator("#reconnect-directory").click();
  await restarted.waitForFunction(() => document.getElementById("status").textContent === "Reconnect folder complete");
  assert.match(await restarted.locator("#source-description").innerText(), /source-inventory-fixture/);
  assert.equal(await restarted.locator("#rescan-directory").isDisabled(), false);
  assert.match(await restarted.locator("#inventory-table").innerText(), /new.stdf/);
  await restarted.locator("#rescan-directory").click();
  await restarted.waitForFunction(() => document.getElementById("status").textContent === "Rescan folder complete");
  passed("console reconnect/rescan works for a previously granted OPFS handle without native permission prompts");
  assert.equal(await restarted.evaluate(async () => {
    const api = await import("./sources.js");
    await api.clearDirectoryHandle();
    return await api.loadDirectoryHandle();
  }), null);
  passed("forgetting a directory handle commits through real IndexedDB");
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = { message: error.message, stack: error.stack };
  throw error;
} finally {
  await writeFile(resolve(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`Evidence: ${output}`);
  await context?.close();
  await new Promise((done) => server.close(done));
}
