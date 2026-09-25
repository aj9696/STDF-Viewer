// Full retained-import and portable-recovery qualification. Uses isolated profiles.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep, extname } from "node:path";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const site = resolve(root, "site");
const channel = process.argv[2] ?? "chrome";
if (!["chrome", "msedge"].includes(channel)) throw new Error("Use chrome or msedge");
const output = resolve(root, "results", `library-benchmark-${Date.now()}`);
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    const path = resolve(site, "." + decodeURIComponent(new URL(request.url, "http://localhost").pathname));
    if (!path.startsWith(site + sep)) throw new Error("Outside site");
    const bytes = await readFile(path);
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".css": "text/css" })[extname(path)] ?? "application/octet-stream");
    response.end(bytes);
  } catch { response.writeHead(404); response.end("Not found"); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const request = (page, type, payload = {}) => page.evaluate(({ type, payload }) => window.library.request(type, payload), { type, payload });
async function attach(page) {
  await page.goto(`${origin}/storage.html`);
  await page.exposeFunction("reportPhase", (phase) => console.log(`${new Date().toISOString()} ${phase}`));
  await page.evaluate(async () => {
    const { DataLibraryClient } = await import("./data-client.js");
    let lastPhase;
    window.library = new DataLibraryClient({ onProgress: ({ phase }) => {
      if (phase !== lastPhase) { lastPhase = phase; void window.reportPhase(phase); }
    } });
  });
  return page.evaluate(() => window.library.open());
}
async function sample(page, dataset, sourcePath) {
  const samples = [];
  const source = sourcePath ? await open(sourcePath, "r") : null;
  try {
    for (const after of [0, Math.floor(dataset.manifest.counts.records / 2), dataset.manifest.counts.records - 15]) {
      const rows = await request(page, "readRows", { datasetId: dataset.id, table: "measurements", after, limit: 3 });
      for (const row of rows.items) {
        const record = await page.evaluate(async ({ datasetId, seq }) => {
          const result = await window.library.readRecord(datasetId, seq);
          return { record: result.record, bytes: Array.from(new Uint8Array(result.bytes)) };
        }, { datasetId: dataset.id, seq: row.seq });
        const bytes = Buffer.from(record.bytes);
        assert.equal(bytes[2], 15); assert.equal(bytes[3], 10);
        assert.equal(bytes.readUInt32LE(4), row.test_number);
        assert.equal(bytes[8], row.head); assert.equal(bytes[9], row.site);
        assert.equal(bytes[10], row.test_flags); assert.equal(bytes[11], row.parm_flags);
        assert.equal(bytes.readUInt32LE(12), row.result_bits);
        if (source) {
          const original = Buffer.alloc(bytes.length);
          const { bytesRead } = await source.read(original, 0, original.length, record.record.offset);
          assert.equal(bytesRead, bytes.length); assert.deepEqual(original, bytes);
        }
        samples.push({ row, record: record.record, bytes: record.bytes });
      }
    }
  } finally { await source?.close(); }
  assert.equal(samples.length, 9);
  return samples;
}
const report = { recordedAt: new Date().toISOString(), channel, methodology: "One sequential trial per size. Isolated persistent browser profiles; durable SQLite writes, exact source snapshot, indexes and validation included. WASM allocation is not browser RSS or JavaScript peak memory. Restore performs package/source hashing and full database validation.", trials: [] };
let context, restoredContext;
try {
  for (const duts of [10000, 100000]) {
    const sourcePath = resolve(root, `../.venv/bench-data/benchmark-${duts}d-100t.stdf`);
    const expected = JSON.parse(await readFile(`${sourcePath}.json`, "utf8"));
    console.log(`Starting ${expected.ptr_records} measurements`);
    context = await chromium.launchPersistentContext(resolve(output, `import-${duts}`), { channel, headless: true });
    report.browserVersion = context.browser().version();
    const page = await context.newPage();
    const status = await attach(page);
    const storageBefore = await page.evaluate(async () => ({ estimate: await navigator.storage.estimate(), persisted: await navigator.storage.persisted() }));
    await page.locator("#backup-file").setInputFiles(sourcePath);
    const imported = await page.evaluate(() => window.library.importFile(document.getElementById("backup-file").files[0]));
    assert.equal(imported.dataset.source_hash, expected.sha256);
    assert.equal(imported.dataset.manifest.counts.measurements, expected.ptr_records);
    assert.equal(imported.dataset.manifest.counts.devices, expected.duts);
    const samples = await sample(page, imported.dataset, sourcePath);
    const storageAfterImport = await page.evaluate(() => navigator.storage.estimate());
    console.log(`Import: ${(imported.metrics.totalMs / 1000).toFixed(2)} seconds`);
    const exportStarted = performance.now();
    const backup = await page.evaluate(async (datasetId) => {
      window.backup = await window.library.exportDataset(datasetId);
      return { bytes: window.backup.bytes, sha256: window.backup.sha256, exportToken: window.backup.exportToken };
    }, imported.dataset.id);
    const exportMs = performance.now() - exportStarted;
    const downloadEvent = page.waitForEvent("download", { timeout: 120000 });
    await page.evaluate(() => {
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(window.backup.file); anchor.download = "dataset.sdlibrary"; anchor.click();
    });
    const packagePath = resolve(output, `benchmark-${duts}.sdlibrary`);
    await (await downloadEvent).saveAs(packagePath);
    await request(page, "releaseExport", { exportToken: backup.exportToken });
    await context.close(); context = null;
    console.log(`Export: ${(exportMs / 1000).toFixed(2)} seconds; ${backup.bytes} bytes`);
    restoredContext = await chromium.launchPersistentContext(resolve(output, `restore-${duts}`), { channel, headless: true });
    const restoredPage = await restoredContext.newPage();
    await attach(restoredPage);
    await restoredPage.locator("#backup-file").setInputFiles(packagePath);
    const restoreStarted = performance.now();
    const restored = await restoredPage.evaluate(() => window.library.restorePackage(document.getElementById("backup-file").files[0]));
    const restoreMs = performance.now() - restoreStarted;
    assert.equal(restored.duplicate, false);
    assert.deepEqual(restored.dataset.manifest, imported.dataset.manifest);
    assert.deepEqual(await sample(restoredPage, restored.dataset), samples);
    const verification = await request(restoredPage, "verifyDataset", { datasetId: restored.dataset.id });
    assert.equal(verification.verified, true);
    const restoredStatus = await restoredPage.evaluate(() => window.library.open());
    const storageAfterRestore = await restoredPage.evaluate(() => navigator.storage.estimate());
    report.trials.push({ expected, status, imported, backup, exportMs, restoreMs, samples, verification, restoredStatus,
      storageBefore, storageAfterImport, storageAfterRestore });
    await writeFile(resolve(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(`Restore: ${(restoreMs / 1000).toFixed(2)} seconds; full integrity/source verification passed`);
    await restoredContext.close(); restoredContext = null;
  }
  console.log(`Evidence: ${output}`);
} catch (error) {
  report.failure = String(error.stack ?? error);
  await writeFile(resolve(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
  throw error;
} finally { await context?.close(); await restoredContext?.close(); server.close(); }
