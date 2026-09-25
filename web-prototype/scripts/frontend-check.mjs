import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

// All source data is synthetic. Browser profiles and evidence stay under ignored results/.
const root = fileURLToPath(new URL("../", import.meta.url));
const repository = resolve(root, "..");
const site = resolve(root, "site");
const channel = process.argv[2] ?? "chrome";
if (!["chrome", "msedge"].includes(channel)) throw new Error("Use chrome or msedge");
const output = resolve(root, "results", `frontend-${channel}-${Date.now()}`);
const fixtureDirectory = resolve(output, "fixtures");
await mkdir(output, { recursive: true });
const generated = spawnSync(resolve(repository, ".venv/Scripts/python.exe"),
  [resolve(root, "scripts/make-library-fixtures.py"), fixtureDirectory], { encoding: "utf8" });
if (generated.status !== 0) throw new Error(generated.stderr || generated.error?.message || "Fixture generation failed");
const fixtures = JSON.parse(await readFile(resolve(fixtureDirectory, "expected.json"), "utf8"));
let cancellationPath = resolve(repository, ".venv/bench-data/benchmark-10000d-100t.stdf");
try { await access(cancellationPath); }
catch {
  cancellationPath = resolve(fixtureDirectory, "cancel-10000d-100t.stdf");
  const result = spawnSync(resolve(repository, ".venv/Scripts/python.exe"),
    [resolve(repository, "benchmarks/generate.py"), "--duts", "10000", "--tests", "100", "--output", cancellationPath], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "Cancellation fixture generation failed");
}
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
const checks = [];
const pageErrors = [];
const profiles = [];
let activePage;

async function launch(name) {
  const context = await chromium.launchPersistentContext(resolve(output, name), {
    channel, headless: true, viewport: { width: 1440, height: 1000 },
  });
  context.setDefaultTimeout(15000);
  context.on("page", (page) => {
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("dialog", async (dialog) => { pageErrors.push(`Unexpected browser dialog: ${dialog.message()}`); await dialog.dismiss(); });
  });
  profiles.push(context);
  return context;
}
async function ready(page) {
  await page.waitForFunction(() => !document.querySelector("#add-file")?.disabled);
}
async function countRows(page, expected) {
  await page.waitForFunction((count) => document.querySelectorAll("#dataset-rows tr[data-id]").length === count, expected);
}
async function dialogOpen(page, id, expected = true) {
  await page.waitForFunction(({ id, expected }) => document.getElementById(id)?.open === expected, { id, expected });
}
async function expectDatasetFocus(page, id, className) {
  await page.waitForFunction(({ id, className }) => document.activeElement?.dataset.datasetId === id &&
    document.activeElement.classList.contains(className), { id, className });
}
async function choose(page, file) {
  await page.locator("#add-file").click();
  await dialogOpen(page, "import-dialog");
  await page.locator("#source-file").setInputFiles(file);
  await page.waitForFunction(() => !document.querySelector("#start-import").disabled);
}
async function importFile(page, file, { capture = false } = {}) {
  await choose(page, file);
  if (capture) await screenshot(page, "import-ready.png");
  await page.locator("#start-import").click();
  await page.locator("#open-imported").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#open-imported").disabled);
}
async function dismissImport(page) {
  await page.locator("#close-import").click();
  await dialogOpen(page, "import-dialog", false);
  await ready(page);
}
async function dropFiles(page, files) {
  await page.locator("#drop-zone").evaluate((target, entries) => {
    const transfer = new DataTransfer();
    for (const { name, bytes } of entries) transfer.items.add(new File([new Uint8Array(bytes)], name));
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, files);
}
async function screenshot(page, name) {
  await page.screenshot({ path: resolve(output, name), fullPage: true, animations: "disabled" });
}
async function assertNoOverflow(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth,
    overflowing: [...document.querySelectorAll("body *")].filter((node) => node.getBoundingClientRect().right > innerWidth)
      .slice(0, 20).map((node) => ({ tag: node.tagName, id: node.id, className: node.getAttribute("class"),
        right: node.getBoundingClientRect().right, width: node.getBoundingClientRect().width })) }));
  assert.ok(sizes.scroll <= sizes.width, `Whole-page overflow at ${width}px: ${JSON.stringify(sizes)}`);
}

// Only this separate profile receives mocked responses. Production modules and real
// import assertions above/below continue to use the actual WASM/SQLite worker.
function catalogFixtureModule() {
  return `
const mode = new URL(location.href).searchParams.get("fixture");
window.frontendFixtureCalls = [];
const rows = Array.from({ length: 123 }, (_, index) => {
  const name = "lot-" + String(index).padStart(3, "0") + ".stdf";
  const source = { name, relativePath: "wafer-" + index + "/" + name, size: 500 + index, sha256: "a".repeat(64) };
  return { id: "00000000-0000-4000-8000-" + String(index).padStart(12, "0"), name,
    relative_path: source.relativePath, source_bytes: source.size, source_hash: source.sha256,
    db_bytes: 32768, parser_version: "retained-v1", schema_version: 1, status: "ready",
    created_at: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
    manifest: { schemaVersion: 1, parserVersion: "retained-v1", source, byteOrder: "little",
      counts: { records: 18, measurements: 6, devices: 3, definitions: 4 },
      coverage: { indexed_only: { "15/20": 1 }, limitations: ["Test-only catalog fixture: raw records remain indexed."] } } };
});
export class DataLibraryClient {
  constructor() { this.worker = null; }
  async open() {
    if (mode === "unsupported" || mode === "open-error") {
      throw Object.assign(new Error(mode === "unsupported" ? "This browser does not support local storage." : "Library catalog failed its integrity check."),
        { code: mode === "unsupported" ? "UNSUPPORTED" : "CORRUPT" });
    }
    this.worker = {};
    return { datasets: rows.length, interrupted: 0 };
  }
  async listDatasets({ offset = 0, limit = 50 } = {}) {
    window.frontendFixtureCalls.push({ offset, limit });
    return { items: rows.slice(offset, offset + limit), nextOffset: offset + limit < rows.length ? offset + limit : null };
  }
  async getDataset(id) {
    const row = rows.find((item) => item.id === id);
    if (mode === "delayed-detail") await new Promise((resolve) => { window.frontendReleaseDetail = resolve; });
    if (mode === "unavailable") {
      row.status = "unavailable";
      throw Object.assign(new Error("Dataset needs recovery: source snapshot is missing. Its catalog entry was preserved."), { code: "UNAVAILABLE" });
    }
    return row;
  }
  async close() { this.worker = null; return { closed: true }; }
  terminate() { this.worker = null; }
}
`;
}

try {
  const context = await launch("real-profile");
  const page = activePage = await context.newPage();
  await page.goto(`${origin}/app.html`);
  await ready(page);
  await countRows(page, 0);
  assert.equal(await page.locator("#empty-library").isVisible(), true);
  await page.locator("#show-storage").click();
  await dialogOpen(page, "storage-details");
  await page.waitForFunction(() => !/checking/i.test(document.querySelector("#storage-used").textContent));
  assert.match(await page.locator("#storage-details").innerText(), /storage|used|persist|saved/i);
  await page.keyboard.press("Escape");
  await dialogOpen(page, "storage-details", false);
  await screenshot(page, "01-empty-desktop.png");
  checks.push("real: automatic empty-library open and actual storage status");

  // Native dialog keyboard behavior, including focus return to the triggering action.
  await page.locator("#add-file").focus();
  await page.keyboard.press("Enter");
  await dialogOpen(page, "import-dialog");
  assert.equal(await page.evaluate(() => document.querySelector("#import-dialog").contains(document.activeElement)), true);
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press("Tab");
    // Native dialogs may let Tab visit browser chrome (body becomes active),
    // but must never make a background page control interactive.
    assert.equal(await page.evaluate(() => document.activeElement === document.body ||
      document.querySelector("#import-dialog").contains(document.activeElement)), true);
  }
  await page.keyboard.press("Escape");
  await dialogOpen(page, "import-dialog", false);
  assert.equal(await page.locator("#add-file").evaluate((node) => document.activeElement === node), true);
  checks.push("real: import dialog opens with keyboard, handles Escape, restores focus");

  const littlePath = resolve(fixtureDirectory, "golden-little.stdf");
  await importFile(page, littlePath, { capture: true });
  await countRows(page, 1);
  const firstId = await page.locator("#dataset-rows tr[data-id]").getAttribute("data-id");
  await page.locator("#open-imported").click();
  await dialogOpen(page, "dataset-dialog");
  await page.locator("#dataset-info summary").click();
  assert.equal(await page.locator("#dataset-name").innerText(), "golden-little.stdf");
  const detail = await page.locator("#dataset-info").innerText();
  const counts = await page.locator("#dataset-info .detail-grid article").evaluateAll((nodes) =>
    nodes.map((node) => [node.querySelector("small").textContent, node.querySelector("strong").textContent]));
  assert.deepEqual(counts, [["Measurements", "6"], ["Device attempts", "3"], ["Test declarations", "4"], ["Source records", "18"]]);
  assert.match(detail, /device attempts/i);
  assert.match(detail, new RegExp(fixtures.files["golden-little.stdf"].sourceSha256));
  await screenshot(page, "02-real-dataset-detail.png");
  await page.keyboard.press("Escape");
  await dialogOpen(page, "dataset-dialog", false);
  checks.push("real: UI imports little-endian STDF, shows retained counts, device-attempt terminology and SHA-256");

  await importFile(page, { name: "same-contents-renamed.stdf", mimeType: "application/octet-stream", buffer: await readFile(littlePath) });
  assert.match(await page.locator("#import-status").innerText(), /already|duplicate|existing/i);
  await countRows(page, 1);
  assert.equal(await page.locator("#dataset-rows tr[data-id]").getAttribute("data-id"), firstId);
  await dismissImport(page);
  checks.push("real: renamed identical contents resolve to the original dataset");

  await page.locator("#add-file").click();
  await page.locator("#source-file").setInputFiles({ name: "wrong-extension.txt", mimeType: "text/plain", buffer: Buffer.from("not STDF") });
  assert.equal(await page.locator("#start-import").isDisabled(), true);
  await dropFiles(page, [{ name: "one.stdf", bytes: [0] }, { name: "two.stdf", bytes: [0] }]);
  assert.equal(await page.locator("#start-import").isDisabled(), false);
  assert.equal(await page.locator("#selected-name").innerText(), '2 files selected');
  await page.locator('#start-import').click();
  await page.waitForFunction(() => /2 failed/.test(document.querySelector('#import-status').textContent));
  assert.equal(await page.locator('#import-outcomes li').count(), 2);
  await page.waitForFunction(() => !document.querySelector('#close-import').disabled);
  await countRows(page, 1);
  await page.keyboard.press("Escape");
  await dialogOpen(page, "import-dialog", false);
  await choose(page, resolve(fixtureDirectory, "truncated.stdf"));
  await page.locator("#start-import").click();
  await page.waitForFunction(() => /fail|error|incomplete|truncated|could not/i.test(document.querySelector("#import-status").textContent));
  await page.waitForFunction(() => !document.querySelector("#close-import").disabled);
  await countRows(page, 1);
  await dismissImport(page);
  checks.push("real: unsupported extension, multiple-file drop and malformed STDF do not publish a ready row");

  await choose(page, cancellationPath);
  // Capture the immediate user-action state before a worker message can arrive.
  // A new import must not flash the preceding import's completed byte counts.
  const initialProgress = await page.locator("#start-import").evaluate((button) => {
    button.click();
    return { label: document.querySelector("#phase-label").textContent,
      value: document.querySelector("#phase-progress").getAttribute("value"),
      completed: document.querySelectorAll("[data-phase].complete").length };
  });
  assert.doesNotMatch(initialProgress.label, /445 B|446 B|Reading test records/);
  assert.equal(initialProgress.value, null);
  assert.equal(initialProgress.completed, 0);
  await page.locator("#cancel-import").waitFor({ state: "visible" });
  await page.waitForFunction(() => /MiB/.test(document.querySelector("#phase-label").textContent));
  assert.doesNotMatch(await page.locator("#phase-label").innerText(), /undefined|NaN|Unavailable/);
  await screenshot(page, "import-active.png");
  assert.equal(await page.locator("#close-import").isDisabled(), true);
  assert.equal(await page.locator("#add-file").isDisabled(), true);
  assert.equal(await page.locator("#source-file").isDisabled(), true);
  await page.keyboard.press("Escape");
  await dialogOpen(page, "import-dialog");
  await page.locator("#cancel-import").click();
  await page.waitForFunction(() => /cancelled|canceled/i.test(document.querySelector("#import-status").textContent));
  await page.waitForFunction(() => !document.querySelector("#close-import").disabled);
  await countRows(page, 1);
  await dismissImport(page);
  checks.push("real: each import resets previous progress; active import remains visible on Escape; cooperative cancellation settles without a dataset");

  const hostileName = "<svg onload=alert(1)> literal & wafer.stdf";
  await importFile(page, { name: hostileName, mimeType: "application/octet-stream", buffer: await readFile(resolve(fixtureDirectory, "golden-big.stdf")) });
  await countRows(page, 2);
  await dismissImport(page);
  const names = await page.locator("#dataset-rows [data-dataset-id]").allTextContents();
  assert.ok(names.includes(hostileName));
  assert.equal(await page.locator("#dataset-rows svg[onload]").count(), 0);
  await screenshot(page, "03-real-library-desktop.png");
  await assertNoOverflow(page, 390);
  await screenshot(page, "04-real-library-mobile.png");
  await assertNoOverflow(page, 360);
  await page.setViewportSize({ width: 1440, height: 1000 });
  checks.push("real: hostile filename is literal text; populated library fits 360px and 390px viewports");

  await page.reload();
  await ready(page);
  await countRows(page, 2);
  await page.locator(`[data-dataset-id="${firstId}"]`).first().click();
  await dialogOpen(page, "dataset-dialog");
  await page.locator("#dataset-info summary").click();
  assert.match(await page.locator("#dataset-info").innerText(), new RegExp(fixtures.files["golden-little.stdf"].sourceSha256));
  await page.locator("#close-dataset").click();
  checks.push("real: reload reopens existing catalog and dataset without selecting the source again");

  for (const className of ["file-name", "row-open"]) {
    for (const closeWith of ["Escape", "button"]) {
      const trigger = page.locator(`.${className}[data-dataset-id="${firstId}"]`);
      const previousNode = await trigger.elementHandle();
      await trigger.focus();
      await page.keyboard.press("Enter");
      await dialogOpen(page, "dataset-dialog");
      await page.locator("#dataset-info summary").waitFor({ state: "visible" });
      await ready(page);
      assert.equal(await previousNode.evaluate((node) => node.isConnected), false, "Test must exercise row replacement");
      if (closeWith === "Escape") await page.keyboard.press("Escape");
      else await page.locator("#close-dataset").click();
      await dialogOpen(page, "dataset-dialog", false);
      await expectDatasetFocus(page, firstId, className);
      await previousNode.dispose();
    }
  }
  checks.push("real: closing dataset details with Escape or its close button returns keyboard focus to the original name/arrow action after rows rerender");

  await page.locator(".tools-link").click();
  await page.waitForURL(`${origin}/foundation.html`);
  await page.goBack();
  await page.waitForURL(`${origin}/app.html`);
  await ready(page);
  await countRows(page, 2);
  checks.push("real: Library tools uses same-tab navigation; browser Back reopens the library");

  const blocked = activePage = await context.newPage();
  await blocked.goto(`${origin}/app.html`);
  await blocked.locator("#connection-error").waitFor({ state: "visible" });
  assert.match(await blocked.locator("#connection-error").innerText(), /another tab|already open/i);
  assert.equal(await blocked.locator("#add-file").isDisabled(), true);
  await page.close();
  await blocked.locator("#retry-open").click();
  await ready(blocked);
  await countRows(blocked, 2);
  checks.push("real: second tab reports exclusive-owner BUSY and Retry succeeds after owner closes");

  const mockContext = await launch("test-only-catalog-profile");
  await mockContext.route("**/data-client.js", (route) => route.fulfill({ contentType: "text/javascript", body: catalogFixtureModule() }));
  const mockPage = activePage = await mockContext.newPage();
  await mockPage.goto(`${origin}/app.html?fixture=catalog`);
  await ready(mockPage);
  await countRows(mockPage, 25);
  assert.deepEqual(await mockPage.evaluate(() => window.frontendFixtureCalls), [{ offset: 0, limit: 100 }, { offset: 100, limit: 100 }]);
  await mockPage.locator("#sort-files").selectOption("name");
  assert.equal(await mockPage.locator("#dataset-rows [data-dataset-id]").first().innerText(), "lot-000.stdf");
  await mockPage.locator("#next-page").click();
  assert.equal(await mockPage.locator("#dataset-rows [data-dataset-id]").first().innerText(), "lot-025.stdf");
  await mockPage.locator("#previous-page").click();
  await mockPage.locator("#sort-files").selectOption("size");
  assert.equal(await mockPage.locator("#dataset-rows [data-dataset-id]").first().innerText(), "lot-122.stdf");
  await mockPage.locator("#search-files").fill("wafer-122/");
  await countRows(mockPage, 1);
  assert.equal(await mockPage.locator("#dataset-rows [data-dataset-id]").first().innerText(), "lot-122.stdf");
  await mockPage.locator("#search-files").fill("no matching dataset anywhere");
  await mockPage.locator("#no-results").waitFor({ state: "visible" });
  await countRows(mockPage, 0);
  await mockPage.locator("#search-files").fill("");
  await countRows(mockPage, 25);
  checks.push("test-only mocked catalog: bounded 100-entry loading, 25-row pagination, full-inventory path search, name and size sorting, no-results state");

  await mockPage.goto(`${origin}/app.html?fixture=unavailable`);
  await ready(mockPage);
  const unavailableId = await mockPage.locator("#dataset-rows tr[data-id]").first().getAttribute("data-id");
  await mockPage.locator(`#dataset-rows [data-dataset-id="${unavailableId}"]`).first().click();
  await dialogOpen(mockPage, "dataset-dialog");
  await mockPage.waitForFunction(() => /recovery|unavailable/i.test(document.querySelector("#dataset-info").textContent));
  await mockPage.locator("#close-dataset").click();
  await countRows(mockPage, 25);
  assert.match(await mockPage.locator(`#dataset-rows tr[data-id="${unavailableId}"]`).innerText(), /unavailable|recovery|attention/i);
  checks.push("test-only mocked catalog: unavailable dataset remains in the library with recovery guidance");

  await mockPage.goto(`${origin}/app.html?fixture=delayed-detail`);
  await ready(mockPage);
  const delayedId = await mockPage.locator("#dataset-rows tr[data-id]").first().getAttribute("data-id");
  await mockPage.locator(`.row-open[data-dataset-id="${delayedId}"]`).click();
  await dialogOpen(mockPage, "dataset-dialog");
  await mockPage.keyboard.press("Escape");
  await dialogOpen(mockPage, "dataset-dialog", false);
  assert.equal(await mockPage.locator("#add-file").isDisabled(), true);
  await mockPage.evaluate(() => window.frontendReleaseDetail());
  await ready(mockPage);
  await expectDatasetFocus(mockPage, delayedId, "row-open");
  checks.push("test-only delayed metadata: closing details during an operation restores row focus after it settles");

  for (const fixture of ["unsupported", "open-error"]) {
    await mockPage.goto(`${origin}/app.html?fixture=${fixture}`);
    await mockPage.locator("#connection-error").waitFor({ state: "visible" });
    assert.equal(await mockPage.locator("#add-file").isDisabled(), true);
    assert.equal(await mockPage.locator("#retry-open").isVisible(), true);
    assert.match(await mockPage.locator("#connection-error").innerText(), fixture === "unsupported" ? /support|browser/i : /integrity|corrupt|open|recovery/i);
  }
  checks.push("test-only mocked client: unsupported storage and corrupt-open failures are actionable without reset");

  assert.deepEqual(pageErrors, []);
  const report = { recordedAt: new Date().toISOString(), channel, browserVersion: context.browser().version(), checks, pageErrors };
  await writeFile(resolve(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Evidence: ${output}`);
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await screenshot(activePage, "failure.png").catch(() => {});
    await writeFile(resolve(output, "failure.html"), await activePage.content()).catch(() => {});
  }
  await writeFile(resolve(output, "failure.json"), JSON.stringify({ error: error.stack, checks, pageErrors }, null, 2));
  throw error;
} finally {
  await Promise.allSettled(profiles.map((context) => context.close()));
  server.close();
}
