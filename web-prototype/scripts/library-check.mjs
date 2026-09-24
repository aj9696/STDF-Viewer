import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep, extname } from "node:path";
import { chromium } from "playwright-core";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const site = resolve(root, "site");
const output = resolve(root, "results", `library-${Date.now()}`);
await mkdir(output, { recursive: true });
const repository = resolve(root, "..");
const fixtureDirectory = resolve(output, "fixtures");
function runPython(script, ...args) {
  const result = spawnSync(resolve(repository, ".venv/Scripts/python.exe"),
    [resolve(root, "scripts", script), ...args], { encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || `${script} failed`);
}
runPython("make-library-fixtures.py", fixtureDirectory);
const goldenFixtures = JSON.parse(await readFile(resolve(fixtureDirectory, "expected.json"), "utf8"));
const server = createServer(async (request, response) => {
  try {
    const path = resolve(site, "." + decodeURIComponent(new URL(request.url, "http://localhost").pathname));
    if (!path.startsWith(site + sep)) throw new Error("Outside site");
    const bytes = await readFile(path);
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".css": "text/css" })[extname(path)] ?? "application/octet-stream");
    response.end(bytes);
  } catch { response.writeHead(404); response.end("Not found"); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const channel = process.argv[2] ?? "chrome";
if (!["chrome", "msedge"].includes(channel)) throw new Error("Use chrome or msedge");
const profile = resolve(output, `profile-${channel}`);
let context;
const checks = [];
const rejectedPackages = [];
const rejectedSources = [];
const goldenImports = [];
async function attach(page) {
  await page.goto(`${origin}/storage.html`);
  await page.evaluate(async () => {
    const { DataLibraryClient } = await import("./data-client.js");
    window.library = new DataLibraryClient({ onProgress: (progress) => { window.lastProgress = progress; } });
  });
}
const request = (page, type, payload = {}) => page.evaluate(({ type, payload }) => window.library.request(type, payload), { type, payload });
const columns = {
  records: ["seq", "offset", "length", "type", "subtype", "device_id"],
  measurements: ["seq", "device_id", "definition_id", "test_number", "head", "site", "test_flags", "parm_flags", "result_bits", "result"],
  devices: ["id", "head", "site", "prr_seq", "part_flags", "num_tests", "hard_bin", "soft_bin", "x", "y", "test_time", "part_id", "part_text"],
};
async function verifyGolden(page, dataset, filename) {
  const expected = goldenFixtures.files[filename];
  assert.deepEqual(dataset.manifest.counts, expected.counts);
  assert.equal(dataset.source_hash, expected.sourceSha256);
  assert.equal(dataset.source_bytes, expected.sourceBytes);
  assert.equal(dataset.manifest.byteOrder, expected.byteOrder);
  assert.deepEqual(dataset.manifest.coverage.indexed_only, expected.indexedOnlyCounts);
  for (const [table, names] of Object.entries(columns)) {
    const { items, nextAfter } = await request(page, "readRows", { datasetId: dataset.id, table, limit: 1000 });
    assert.equal(nextAfter, null);
    const rows = items.map((row) => names.map((name) => row[name]));
    const wanted = expected[table].map((row) => [...row]).sort((a, b) => a[0] - b[0]);
    // SQLite REAL canonicalizes signed zero. The exact sign remains result_bits.
    if (table === "measurements") for (const row of wanted) if (row[9] === 0) row[9] = 0;
    assert.deepEqual(rows, wanted, `${filename}: ${table}`);
    if (table === "records") {
      for (const [seq, subset] of Object.entries(expected.decodedMetadataSubset)) {
        const decoded = JSON.parse(items[Number(seq) - 1].decoded_json);
        for (const [name, value] of Object.entries(subset)) assert.deepEqual(decoded[name], value, `${filename}: ${seq}.${name}`);
      }
    }
  }
  const definitions = (await request(page, "readRows", { datasetId: dataset.id, table: "definitions", limit: 1000 })).items;
  assert.deepEqual(definitions.map((row) => [row.id, row.test_number, row.name, JSON.parse(row.metadata_json).RAW_TAIL_HEX]), expected.definitions);
  assert.equal(JSON.parse(definitions[1].metadata_json).TEST_TXT, null);
  assert.equal(JSON.parse(definitions[2].metadata_json).TEST_TXT, "");
  assert.equal(JSON.parse(definitions[0].metadata_json).RES_SCAL, -3);
  const source = await readFile(resolve(fixtureDirectory, filename));
  for (const [seq, offset, length] of expected.records) {
    const bytes = await page.evaluate(async ({ datasetId, seq }) => {
      const result = await window.library.readRecord(datasetId, seq);
      return Array.from(new Uint8Array(result.bytes));
    }, { datasetId: dataset.id, seq });
    assert.deepEqual(bytes, [...source.subarray(offset, offset + length)], `${filename}: raw record ${seq}`);
  }
  assert.equal((await request(page, "verifyDataset", { datasetId: dataset.id })).verified, true);
  goldenImports.push({ filename, datasetId: dataset.id, sourceSha256: dataset.source_hash, counts: dataset.manifest.counts });
}
async function expectRejectedFile(page, filePath, operation) {
  await page.locator("#backup-file").setInputFiles(filePath);
  return page.evaluate(async (operation) => {
    const started = performance.now();
    let timer;
    try {
      const attempt = window.library[operation](document.getElementById("backup-file").files[0])
        .then(() => ({ accepted: true }), (error) => ({ accepted: false, code: error.code, message: error.message }));
      const deadline = new Promise((resolve) => {
        timer = setTimeout(() => { window.library.terminate(); resolve({ timedOut: true }); }, 15000);
      });
      return { ...await Promise.race([attempt, deadline]), elapsedMs: performance.now() - started };
    } finally { clearTimeout(timer); }
  }, operation);
}
async function checkMaliciousPackages(page, packageDirectory, variants, destination) {
  const before = (await request(page, "listDatasets")).items.map((row) => row.id);
  for (const [filename, fixture] of Object.entries(variants)) {
    const result = await expectRejectedFile(page, resolve(packageDirectory, filename), "restorePackage");
    assert.equal(result.timedOut, undefined, `${filename}: metadata/schema checks timed out`);
    assert.equal(result.accepted, false, `${filename}: invalid package was accepted`);
    const expectedCode = fixture.expectedRejectionStage === "schema" ? "INCOMPATIBLE" :
      fixture.expectedRejectionStage === "manifest" ? "INCOMPLETE" : "CORRUPT";
    assert.equal(result.code, expectedCode, `${filename}: wrong rejection stage: ${result.message}`);
    assert.deepEqual((await request(page, "listDatasets")).items.map((row) => row.id), before);
    rejectedPackages.push({ filename, destination, ...result });
  }
}
try {
  context = await chromium.launchPersistentContext(profile, { channel, headless: true });
  const page = await context.newPage();
  await attach(page);
  const status = await page.evaluate(() => window.library.open());
  assert.equal(status.datasets, 0);
  assert.equal(status.schemaVersion, 1);
  assert.deepEqual(await request(page, "listDatasets"), { items: [], nextOffset: null });
  const second = await context.newPage();
  await attach(second);
  await assert.rejects(second.evaluate(() => window.library.open()), /another tab/);
  await page.evaluate(() => window.library.close());
  assert.equal((await second.evaluate(() => window.library.open())).datasets, 0);
  await second.evaluate(() => window.library.close());
  await second.close();
  await page.evaluate(() => window.library.open());
  checks.push("catalog create, reopen, exclusive ownership and retry");
  await assert.rejects(request(page, "listDatasets", { limit: 1001 }), /Invalid library page/);
  checks.push("bounded catalog pagination");
  await page.locator("#backup-file").setInputFiles(resolve(root, "../../semidata-evaluation.stdf"));
  const jobsBeforeInvalidPath = (await request(page, "listJobs")).items.length;
  const invalidPath = await page.evaluate(async () => {
    try {
      await window.library.importFile(document.getElementById("backup-file").files[0], { relativePath: "" });
      return { accepted: true };
    } catch (error) { return { accepted: false, code: error.code, message: error.message }; }
  });
  assert.equal(invalidPath.accepted, false);
  assert.equal(invalidPath.code, "INVALID_SOURCE");
  assert.equal((await request(page, "listJobs")).items.length, jobsBeforeInvalidPath);
  checks.push("empty relative path rejected before creating an import job");
  const imported = await page.evaluate(() => window.library.importFile(document.getElementById("backup-file").files[0]));
  assert.equal(imported.dataset.manifest.counts.measurements, 44800);
  assert.equal(imported.dataset.manifest.counts.devices, 2240);
  assert.equal(imported.dataset.source_hash, "792afbf3596d3b4b19fb861131310f42b9b712d6c039d359594cee3e2df7aa01");
  const datasetId = imported.dataset.id;
  const measurements = await request(page, "readRows", { datasetId, table: "measurements", limit: 17 });
  assert.equal(measurements.items.length, 17);
  assert.ok(measurements.nextAfter > 0);
  const nextRows = await request(page, "readRows", { datasetId, table: "measurements", after: measurements.nextAfter, limit: 17 });
  assert.ok(nextRows.items[0].seq > measurements.items.at(-1).seq);
  const duplicate = await page.evaluate(() => {
    const file = document.getElementById("backup-file").files[0];
    return window.library.importFile(new File([file], "renamed.stdf"));
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.dataset.id, datasetId);
  assert.equal((await request(page, "listDatasets")).items.length, 1);
  checks.push("STDF.io retained import, known source hash/counts, pagination and content deduplication");
  await page.locator("#backup-file").evaluate((input) => { input.multiple = true; });
  await page.locator("#backup-file").setInputFiles([
    resolve(fixtureDirectory, "golden-little.stdf"), resolve(fixtureDirectory, "truncated.stdf"),
    resolve(fixtureDirectory, "golden-big.stdf"),
  ]);
  const queueRun = await page.evaluate(async () => {
    const { inventoryFiles } = await import("./sources.js");
    const { ImportQueue } = await import("./import-queue.js");
    const [little, malformed, big] = document.getElementById("backup-file").files;
    const files = [new File([little], "01-good.stdf"), new File([malformed], "02-invalid.stdf"),
      new File([little], "03-renamed-duplicate.stdf"), new File([big], "04-big.stdf")];
    const inventory = inventoryFiles(files);
    const queue = new ImportQueue(window.library);
    const snapshots = [];
    const outcomes = await queue.run(inventory.items, { onProgress: (snapshot) => {
      snapshots.push({ activeIndex: snapshot.activeIndex, completed: snapshot.completed, running: snapshot.running });
    } });
    return { outcomes, snapshots, final: queue.snapshot(), skipped: inventory.skipped };
  });
  assert.deepEqual(queueRun.outcomes.map((item) => item.status), ["ready", "failed", "duplicate", "ready"]);
  assert.deepEqual(queueRun.skipped, []);
  assert.equal(queueRun.final.running, false);
  assert.equal(queueRun.final.completed, 4);
  assert.equal(queueRun.outcomes[2].dataset.id, queueRun.outcomes[0].dataset.id);
  assert.equal((await request(page, "listDatasets")).items.length, 3);
  await verifyGolden(page, queueRun.outcomes[0].dataset, "golden-little.stdf");
  await verifyGolden(page, queueRun.outcomes[3].dataset, "golden-big.stdf");
  checks.push("real sequential ImportQueue continues after invalid input and recognizes renamed duplicates");
  checks.push("independent LE/BE goldens: every record offset/raw byte, measurement/device tuple, declaration and decoded metadata subset");
  for (const [filename, fixture] of Object.entries(goldenFixtures.invalidFiles)) {
    const rejected = await expectRejectedFile(page, resolve(fixtureDirectory, filename), "importFile");
    assert.equal(rejected.timedOut, undefined);
    assert.equal(rejected.accepted, false, filename);
    assert.equal((await request(page, "listDatasets")).items.length, 3);
    rejectedSources.push({ filename, reason: fixture.reason, ...rejected });
  }
  checks.push("missing MRR, truncated payload, unmatched site and trailing bytes fail without publishing a dataset");
  const verification = await request(page, "verifyDataset", { datasetId });
  assert.equal(verification.verified, true);
  const backup = await page.evaluate(async (datasetId) => {
    window.packageResult = await window.library.exportDataset(datasetId);
    return { bytes: window.packageResult.bytes, sha256: window.packageResult.sha256, exportToken: window.packageResult.exportToken };
  }, datasetId);
  const downloadEvent = page.waitForEvent("download");
  await page.evaluate(() => {
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(window.packageResult.file);
    anchor.download = "evaluation.sdlibrary";
    anchor.click();
  });
  const download = await downloadEvent;
  const packagePath = resolve(output, "evaluation.sdlibrary");
  await download.saveAs(packagePath);
  assert.equal((await request(page, "listExports")).items.length, 1);
  await request(page, "releaseExport", { exportToken: backup.exportToken });
  assert.equal((await request(page, "listExports")).items.length, 0);
  const maliciousDirectory = resolve(output, "malicious-packages");
  runPython("package-fixtures.py", packagePath, maliciousDirectory);
  const maliciousFixtures = JSON.parse(await readFile(resolve(maliciousDirectory, "package-fixtures.json"), "utf8"));
  assert.equal(Object.keys(maliciousFixtures.variants).length, 10);
  await checkMaliciousPackages(page, maliciousDirectory, maliciousFixtures.variants, "same-source-already-ready");
  assert.equal((await request(page, "verifyDataset", { datasetId })).verified, true);
  checks.push("ten checksum-valid malicious packages reject before same-source duplicate return; existing ready data remains verified");
  const restoredContext = await chromium.launchPersistentContext(resolve(output, `restore-${channel}`), { channel, headless: true });
  try {
    const restoredPage = await restoredContext.newPage();
    await attach(restoredPage);
    await restoredPage.evaluate(() => window.library.open());
    await checkMaliciousPackages(restoredPage, maliciousDirectory, maliciousFixtures.variants, "fresh-destination");
    assert.equal((await request(restoredPage, "listDatasets")).items.length, 0);
    await restoredPage.locator("#backup-file").setInputFiles(packagePath);
    const restored = await restoredPage.evaluate(() => window.library.restorePackage(document.getElementById("backup-file").files[0]));
    assert.equal(restored.duplicate, false);
    assert.deepEqual(restored.dataset.manifest, imported.dataset.manifest);
    assert.deepEqual((await request(restoredPage, "readRows", { datasetId: restored.dataset.id, table: "measurements", limit: 17 })).items, measurements.items);
    checks.push("disk-backed package export, fresh-profile restore and exact sample rows");
    checks.push("ten checksum-valid malicious packages reject in a fresh profile, followed by successful valid restoration");
  } finally { await restoredContext.close(); }
  await context.close();
  context = await chromium.launchPersistentContext(profile, { channel, headless: true });
  const restartedPage = await context.newPage();
  await attach(restartedPage);
  await restartedPage.evaluate(() => window.library.open());
  assert.equal((await request(restartedPage, "getDataset", { datasetId })).source_hash, imported.dataset.source_hash);
  assert.equal((await request(restartedPage, "listDatasets")).items.length, 3);
  checks.push("full browser restart reopens retained STDF without original file selection");
  const report = { recordedAt: new Date().toISOString(), browserVersion: context.browser().version(), channel, checks,
    status, imported, backup, goldenImports, rejectedSources, rejectedPackages, queueStatuses: queueRun.outcomes.map((item) => item.status) };
  await writeFile(resolve(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Evidence: ${output}`);
} finally { await context?.close(); server.close(); }
