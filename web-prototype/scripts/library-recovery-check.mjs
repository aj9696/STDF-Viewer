// Real browser fault tests use only this script's fresh profile and random port.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep, extname, basename } from "node:path";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const repo = resolve(root, "..");
const site = resolve(root, "site");
const output = resolve(root, "results", `library-recovery-${Date.now()}`);
const channel = process.argv[2] ?? "chrome";
const fixtureMode = process.argv[3] ?? "";
if (!["chrome", "msedge"].includes(channel) || !["", "--small"].includes(fixtureMode)) {
  throw new Error("Use chrome or msedge, optionally followed by --small");
}
const fixtures = {
  base: resolve(repo, "../semidata-evaluation.stdf"),
  large: resolve(repo, fixtureMode === "--small" ? ".venv/bench-data/benchmark-10000d-3t-retest-die.stdf" :
    ".venv/bench-data/benchmark-10000d-100t.stdf"),
  distinct: resolve(repo, ".venv/library-fixtures/golden-little.stdf"),
};
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    const path = resolve(site, "." + decodeURIComponent(new URL(request.url, "http://localhost").pathname));
    if (!path.startsWith(site + sep)) throw new Error("Outside site");
    const bytes = await readFile(path);
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
      ".wasm": "application/wasm", ".css": "text/css" })[extname(path)] ?? "application/octet-stream");
    response.end(bytes);
  } catch { response.writeHead(404); response.end("Not found"); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = { recordedAt: new Date().toISOString(), channel, origin, fixtureMode: fixtureMode || "default",
  fixtures: Object.fromEntries(Object.entries(fixtures).map(([key, path]) => [key, basename(path)])), checks: [] };
let context;
function passed(name, evidence = {}) {
  report.checks.push({ name, ...evidence });
  console.log(`PASS: ${name}`);
}
const request = (page, type, payload = {}) => page.evaluate(({ type, payload }) =>
  window.library.request(type, payload), { type, payload });
async function instrumentWorker(route, injection) {
  const response = await route.fetch();
  const body = await response.text();
  const anchor = "const store = new LibraryStore();";
  assert.equal(body.split(anchor).length, 2, "Worker fault injection anchor changed.");
  await route.fulfill({ response, body: body.replace(anchor, `${anchor}\n${injection}`) });
}
async function selectFile(page, path) {
  await page.locator("#backup-file").setInputFiles(path);
}
async function faultMode(page, mode) {
  await page.evaluate((value) => { window.faultMode = value; window.faultHit = null; }, mode);
}
async function importOutcome(page) {
  return page.evaluate(async () => {
    try { return { ok: true, result: await window.library.importFile(document.getElementById("backup-file").files[0]) }; }
    catch (error) { return { ok: false, code: error.code, message: error.message }; }
  });
}
async function reopen(page) {
  // Worker termination releases Web Locks asynchronously; tolerate only BUSY.
  for (let attempt = 0; attempt < 20; ++attempt) {
    const outcome = await page.evaluate(async () => {
      try { return { ok: true, status: await window.library.open() }; }
      catch (error) { return { ok: false, code: error.code, message: error.message }; }
    });
    if (outcome.ok) return outcome.status;
    assert.equal(outcome.code, "BUSY", outcome.message);
    await new Promise((done) => setTimeout(done, 25));
  }
  assert.fail("Worker ownership did not release after termination.");
}
async function sourceNames(page) {
  return page.evaluate(async () => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("semidata-sources-v1");
    const names = [];
    for await (const name of directory.keys()) names.push(name);
    return names.sort();
  });
}

try {
  context = await chromium.launchPersistentContext(resolve(output, `profile-${channel}`), { channel, headless: true });
  report.browserVersion = context.browser().version();
  // Read-only test instrumentation identifies orphan journal names without
  // adding debug APIs to the shipped worker or changing storage behavior.
  await context.route("**/data-worker.js", (route) => instrumentWorker(route,
    "const originalStatus = store.status.bind(store); store.status = () => ({ ...originalStatus(), recoveryTestFiles: store.pool.getFileNames() });"));
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  await page.goto(`${origin}/storage.html`);
  await page.evaluate(async () => {
    const { DataLibraryClient } = await import("./data-client.js");
    window.faultMode = null;
    window.faultHit = null;
    window.library = new DataLibraryClient({ onProgress(progress) {
      if (window.faultHit) return;
      if (window.faultMode === "cancel-snapshot" && progress.phase === "snapshot") {
        window.faultHit = progress;
        void window.library.cancel();
      } else if ((window.faultMode === "terminate-parsing" && progress.phase === "parsing") ||
                 (window.faultMode === "terminate-export" && progress.phase === "export") ||
                 (window.faultMode === "terminate-restore" && progress.phase === "restore")) {
        window.faultHit = progress;
        window.library.terminate();
      }
    } });
  });
  const initialStatus = await reopen(page);
  assert.equal(initialStatus.datasets, 0);
  report.sqliteVersion = initialStatus.sqliteVersion;
  report.vfs = initialStatus.vfs;
  await selectFile(page, fixtures.base);
  const baseline = await page.evaluate(async () => {
    const importing = window.library.importFile(document.getElementById("backup-file").files[0]);
    const concurrent = await Promise.all(["open", "close"].map(async (method) => {
      try { await window.library[method](); return "unexpected success"; }
      catch (error) { return error.code; }
    }));
    return { concurrent, imported: await importing };
  });
  assert.deepEqual(baseline.concurrent, ["BUSY", "BUSY"]);
  const datasetId = baseline.imported.dataset.id;
  assert.equal(baseline.imported.dataset.source_hash, "792afbf3596d3b4b19fb861131310f42b9b712d6c039d359594cee3e2df7aa01");
  assert.equal(baseline.imported.dataset.manifest.counts.measurements, 44800);
  const baselineRows = await request(page, "readRows", { datasetId, table: "measurements", limit: 17 });
  const baselineSources = await sourceNames(page);
  const baselinePoolFiles = (await reopen(page)).poolFiles;
  const unchanged = async () => {
    const datasets = await request(page, "listDatasets");
    assert.equal(datasets.items.length, 1);
    assert.equal(datasets.items[0].id, datasetId);
    assert.equal(datasets.items[0].status, "ready");
    assert.deepEqual(await request(page, "readRows", { datasetId, table: "measurements", limit: 17 }), baselineRows);
  };
  passed("concurrent open/close reject BUSY without terminating the active import");

  await selectFile(page, fixtures.large);
  await faultMode(page, "cancel-snapshot");
  const cancelled = await importOutcome(page);
  assert.equal(cancelled.code, "CANCELLED", JSON.stringify(cancelled));
  const cancelHit = await page.evaluate(() => window.faultHit);
  assert.equal(cancelHit.phase, "snapshot");
  assert.ok(cancelHit.completedBytes < cancelHit.totalBytes);
  const cancelledJob = (await request(page, "listJobs")).items.find((job) => job.id === cancelHit.jobId);
  assert.equal(cancelledJob.status, "cancelled");
  assert.deepEqual(await sourceNames(page), baselineSources);
  assert.equal((await reopen(page)).poolFiles, baselinePoolFiles);
  await unchanged();
  passed("snapshot cancellation removes its staging and preserves the ready dataset", { cancelledAtBytes: cancelHit.completedBytes });

  await faultMode(page, "terminate-parsing");
  const interrupted = await importOutcome(page);
  assert.equal(interrupted.code, "WORKER_STOPPED", JSON.stringify(interrupted));
  const interruptedHit = await page.evaluate(() => window.faultHit);
  assert.equal(interruptedHit.phase, "parsing");
  await faultMode(page, null);
  const recoveryStatus = await reopen(page);
  assert.equal(recoveryStatus.interrupted, 1);
  const interruptedJob = (await request(page, "listJobs")).items.find((job) => job.id === interruptedHit.jobId);
  assert.equal(interruptedJob.status, "interrupted");
  assert.ok((await sourceNames(page)).includes(`${interruptedJob.id}.stdf`));
  await request(page, "discardJob", { jobId: interruptedJob.id });
  assert.equal((await request(page, "listJobs")).items.find((job) => job.id === interruptedJob.id).status, "discarded");
  assert.deepEqual(await sourceNames(page), baselineSources);
  const discardedStatus = await reopen(page);
  report.interruptedPoolInventory = discardedStatus.recoveryTestFiles;
  assert.equal(discardedStatus.poolFiles, baselinePoolFiles, JSON.stringify(discardedStatus.recoveryTestFiles));
  await unchanged();
  passed("terminated parse becomes interrupted after reopen; discard removes only its staging", { terminatedAtBytes: interruptedHit.completedBytes });

  await page.evaluate(() => window.library.close());
  const routePattern = "**/data-worker.js";
  const injectQuota = (route) => instrumentWorker(route,
    "store.publish = () => { throw new DOMException('Injected publication quota failure', 'QuotaExceededError'); };");
  await context.route(routePattern, injectQuota);
  await reopen(page);
  await selectFile(page, fixtures.distinct);
  const quota = await importOutcome(page);
  assert.equal(quota.code, "QUOTA_EXCEEDED", JSON.stringify(quota));
  const quotaJob = (await request(page, "listJobs")).items.find((job) => job.name === basename(fixtures.distinct));
  assert.equal(quotaJob.status, "failed");
  assert.equal(quotaJob.error_code, "QUOTA_EXCEEDED");
  assert.deepEqual(await sourceNames(page), baselineSources);
  assert.equal((await reopen(page)).poolFiles, baselinePoolFiles);
  await unchanged();
  await page.evaluate(() => window.library.close());
  await context.unroute(routePattern, injectQuota);
  await reopen(page);
  passed("injected publication quota failure records failure and preserves published artifacts");

  await faultMode(page, "terminate-export");
  const exportOutcome = await page.evaluate(async (id) => {
    try { await window.library.exportDataset(id); return { ok: true }; }
    catch (error) { return { ok: false, code: error.code }; }
  }, datasetId);
  assert.equal(exportOutcome.code, "WORKER_STOPPED");
  assert.equal((await page.evaluate(() => window.faultHit)).phase, "export");
  await faultMode(page, null);
  await reopen(page);
  const staleExports = await request(page, "listExports");
  assert.equal(staleExports.items.length, 1);
  await request(page, "releaseExport", { exportToken: staleExports.items[0].exportToken });
  assert.equal((await request(page, "listExports")).items.length, 0);
  assert.deepEqual(await sourceNames(page), baselineSources);
  assert.equal((await reopen(page)).poolFiles, baselinePoolFiles);
  await unchanged();
  assert.equal((await request(page, "verifyDataset", { datasetId })).verified, true);
  passed("interrupted export remains discoverable and removable without touching source/database", { orphanBytes: staleExports.items[0].bytes });

  const restoreExport = await page.evaluate(async (id) => {
    window.recoveryPackage = await window.library.exportDataset(id);
    return { bytes: window.recoveryPackage.bytes, exportToken: window.recoveryPackage.exportToken };
  }, datasetId);
  const priorJobs = new Set((await request(page, "listJobs")).items.map((job) => job.id));
  await faultMode(page, "terminate-restore");
  const restoreOutcome = await page.evaluate(async () => {
    try { await window.library.restorePackage(window.recoveryPackage.file); return { ok: true }; }
    catch (error) { return { ok: false, code: error.code }; }
  });
  assert.equal(restoreOutcome.code, "WORKER_STOPPED");
  const restoreHit = await page.evaluate(() => window.faultHit);
  assert.equal(restoreHit.phase, "restore");
  assert.ok(restoreHit.completedBytes < restoreHit.totalBytes);
  await faultMode(page, null);
  assert.equal((await reopen(page)).interrupted, 1);
  const restoreJob = (await request(page, "listJobs")).items.find((job) => !priorJobs.has(job.id) && job.kind === "restore");
  assert.equal(restoreJob.status, "interrupted");
  await request(page, "discardJob", { jobId: restoreJob.id });
  assert.equal((await request(page, "listJobs")).items.find((job) => job.id === restoreJob.id).status, "discarded");
  assert.deepEqual(await sourceNames(page), baselineSources);
  assert.equal((await reopen(page)).poolFiles, baselinePoolFiles);
  await request(page, "releaseExport", { exportToken: restoreExport.exportToken });
  assert.equal((await request(page, "listExports")).items.length, 0);
  await unchanged();
  assert.equal((await request(page, "verifyDataset", { datasetId })).verified, true);
  passed("interrupted package restore becomes recoverable and discards staging while preserving the ready dataset",
    { packageBytes: restoreExport.bytes, terminatedAtBytes: restoreHit.completedBytes });

  // Simulate equal-length source corruption inside this isolated test library.
  // The previous cases first proved the original dataset intact.
  await page.evaluate(() => window.library.close());
  const injectCorruption = (route) => instrumentWorker(route, `
    const originalOpen = store.open.bind(store);
    let sourceCorrupted = false;
    store.open = async () => {
      const status = await originalOpen();
      if (sourceCorrupted) return status;
      const dataset = store.get(${JSON.stringify(datasetId)});
      const fileHandle = await store.sources.getFileHandle(dataset.source_path);
      const before = await fileHandle.getFile();
      const access = await fileHandle.createSyncAccessHandle();
      try {
        const byte = new Uint8Array(1);
        if (access.read(byte, { at: 0 }) !== 1) throw new Error('Corruption fixture read failed');
        byte[0] ^= 1;
        if (access.write(byte, { at: 0 }) !== 1) throw new Error('Corruption fixture write failed');
        access.flush();
      } finally { access.close(); }
      sourceCorrupted = true;
      return { ...status, corruptionBeforeBytes: before.size,
        corruptionAfterBytes: (await fileHandle.getFile()).size };
    };`);
  await context.route(routePattern, injectCorruption);
  const corruptedStatus = await reopen(page);
  assert.equal(corruptedStatus.corruptionBeforeBytes, corruptedStatus.corruptionAfterBytes);
  assert.equal(corruptedStatus.corruptionBeforeBytes, baseline.imported.dataset.source_bytes);
  const corruptVerification = await page.evaluate(async (id) => {
    try { await window.library.verifyDataset(id); return { ok: true }; }
    catch (error) { return { ok: false, code: error.code }; }
  }, datasetId);
  assert.equal(corruptVerification.code, "CORRUPT");
  assert.equal((await request(page, "listDatasets")).items[0].status, "unavailable");
  const unavailableRead = await page.evaluate(async (id) => {
    try { await window.library.getDataset(id); return { ok: true }; }
    catch (error) { return { ok: false, code: error.code }; }
  }, datasetId);
  assert.equal(unavailableRead.code, "UNAVAILABLE");
  await selectFile(page, fixtures.base);
  const unavailableDuplicate = await importOutcome(page);
  assert.equal(unavailableDuplicate.code, "UNAVAILABLE", JSON.stringify(unavailableDuplicate));
  assert.equal((await request(page, "listDatasets")).items.length, 1);
  assert.equal((await request(page, "listDatasets")).items[0].status, "unavailable");
  assert.deepEqual(await sourceNames(page), baselineSources);
  assert.equal((await reopen(page)).poolFiles, baselinePoolFiles);
  await context.unroute(routePattern, injectCorruption);
  passed("same-size source corruption marks unavailable and prevents duplicate import from bypassing recovery");
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
