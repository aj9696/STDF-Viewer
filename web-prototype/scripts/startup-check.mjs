import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const site = resolve(root, "site");
const repository = resolve(root, "..");
const channel = process.argv[2] ?? "chrome";
if (!["chrome", "msedge"].includes(channel)) throw new Error("Use chrome or msedge");
const output = resolve(root, "results", `startup-${channel}-${Date.now()}`);
const fixtures = resolve(output, "fixtures");
await mkdir(output, { recursive: true });
const generated = spawnSync(resolve(repository, ".venv/Scripts/python.exe"),
  [resolve(root, "scripts/make-library-fixtures.py"), fixtures], { encoding: "utf8" });
if (generated.status !== 0) throw new Error(generated.stderr || generated.error?.message || "Fixture generation failed");
const expected = JSON.parse(await readFile(resolve(fixtures, "expected.json"), "utf8")).files["golden-little.stdf"];
const server = createServer(async (request, response) => {
  try {
    const path = resolve(site, "." + decodeURIComponent(new URL(request.url, "http://localhost").pathname));
    if (!path.startsWith(site + sep)) throw new Error("Outside site");
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".css": "text/css" })[extname(path)] ?? "application/octet-stream");
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end("Not found"); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const checks = [], pageErrors = [], requestFailures = [], faultEvidence = [];
let context, activePage, fault = null;

async function screenshot(page, name) {
  await page.screenshot({ path: resolve(output, name), fullPage: true, animations: "disabled" });
}
async function libraryReady(page) {
  await page.waitForFunction(() => !document.querySelector("#add-file")?.disabled);
}
async function explorerReady(page) {
  await page.waitForFunction(() => document.querySelector("#main")?.getAttribute("aria-busy") === "false" &&
    !document.querySelector("#test-search-submit")?.disabled);
}
async function assertSavedDataset(page, datasetId) {
  assert.equal(await page.locator("#dataset-rows tr[data-id]").count(), 1);
  assert.equal(await page.locator("#dataset-rows tr[data-id]").getAttribute("data-id"), datasetId);
  await page.locator(`[data-dataset-id="${datasetId}"]`).first().click();
  await page.locator("#dataset-info summary").click();
  assert.equal(await page.locator("#dataset-info code").innerText(), expected.sourceSha256);
  await page.locator("#close-dataset").click();
}
async function noAutomaticNavigation(page) {
  const navigated = await page.waitForEvent("framenavigated", {
    predicate: (frame) => frame === page.mainFrame(), timeout: 350,
  }).then(() => true, (error) => { if (error.name === "TimeoutError") return false; throw error; });
  assert.equal(navigated, false, "Boot failure must not trigger an automatic reload loop");
}

try {
  context = await chromium.launchPersistentContext(resolve(output, "profile"), {
    channel, headless: true, viewport: { width: 1440, height: 1000 },
  });
  context.setDefaultTimeout(15000);
  context.on("page", (page) => {
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => requestFailures.push({ url: request.url(), error: request.failure()?.errorText }));
  });

  for (const filename of ["app.html", "explore.html"]) {
    const page = activePage = await context.newPage();
    const workers = [], requests = [];
    page.on("worker", (worker) => workers.push(worker.url()));
    page.on("request", (request) => requests.push(request.url()));
    await page.goto(pathToFileURL(resolve(site, filename)).href, { waitUntil: "domcontentloaded" });
    await page.locator("#boot-error").waitFor({ state: "visible" });
    assert.match(await page.locator("#boot-error-text").innerText(), /browser|address|localhost|server|http/i);
    assert.equal(await page.locator("#boot-library").getAttribute("href"), "http://127.0.0.1:8766/app.html");
    assert.equal(await page.locator("#boot-reload").isVisible(), false);
    assert.equal(await page.locator(filename === "app.html" ? "#connection-status" : "#explorer-status").innerText(), "App not started");
    if (filename === "app.html") assert.equal(await page.locator("#loading-library").isVisible(), false);
    assert.deepEqual(workers, []);
    assert.ok(requests.every((url) => !/\/(library-home|explorer|data-client|data-worker)\.js(?:\?|$)/.test(url)), "File guard must run before importing the application graph");
    await noAutomaticNavigation(page);
    await screenshot(page, `file-${filename}.png`);
    await page.close();
  }
  checks.push("actual file URLs: library and Explorer show local-server guidance, correct localhost link, no reload button, no application module/worker and no infinite spinner");

  const bootSource = await readFile(resolve(site, "boot.js"), "utf8");
  const viewSource = await readFile(resolve(site, "library-home-view.js"), "utf8");
  assert.ok(viewSource.includes("export function hydrateIcons()"));
  assert.match(bootSource, /const MODULE_LOAD_TIMEOUT_MS\s*=\s*15_000/);
  await context.route("**/boot.js", (route) => route.fulfill({ contentType: "text/javascript", body: fault === "timeout"
    ? bootSource.replace(/const MODULE_LOAD_TIMEOUT_MS\s*=\s*15_000/, "const MODULE_LOAD_TIMEOUT_MS = 200") : bootSource }));
  await context.route("**/library-home-view.js", (route) => {
    if (fault === "fetch-failure") return route.abort("failed");
    if (fault === "missing-export") return route.fulfill({ contentType: "text/javascript", body: viewSource.replace("export function hydrateIcons()", "function hydrateIcons()") });
    if (fault === "timeout") return new Promise(() => {});
    return route.continue();
  });
  const page = activePage = await context.newPage();
  await page.goto(`${origin}/app.html`); await libraryReady(page);
  assert.equal(await page.locator("#boot-error").isVisible(), false);
  await page.locator("#add-file").click();
  await page.locator("#source-file").setInputFiles(resolve(fixtures, "golden-little.stdf"));
  await page.locator("#start-import").click();
  await page.locator("#open-imported").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#close-import").disabled);
  await page.locator("#close-import").click();
  const datasetId = await page.locator("#dataset-rows tr[data-id]").getAttribute("data-id");
  assert.ok(datasetId);
  await assertSavedDataset(page, datasetId);
  checks.push("normal HTTP: real STDF import completes through the UI and exposes the known saved source hash");

  for (const filename of ["app.html", "explore.html"]) {
    const target = `${origin}/${filename}${filename === "explore.html" ? `?dataset=${datasetId}` : ""}`;
    for (const mode of ["fetch-failure", "missing-export", "timeout"]) {
      fault = mode;
      await page.goto(target, { waitUntil: "domcontentloaded" });
      await page.locator("#boot-error").waitFor({ state: "visible" });
      assert.equal(await page.locator("#boot-reload").isVisible(), true);
      assert.equal(await page.locator("#boot-reload").isEnabled(), true);
      assert.equal(await page.locator("#boot-library").evaluate((link) => link.href), `${origin}/app.html`);
      assert.equal(await page.locator(filename === "app.html" ? "#connection-status" : "#explorer-status").innerText(), "App not started");
      if (filename === "app.html") assert.equal(await page.locator("#loading-library").isVisible(), false);
      const text = await page.locator("#boot-error-text").innerText();
      assert.ok(text.trim().length > 0);
      await noAutomaticNavigation(page);
      faultEvidence.push({ filename, mode, message: text });
      await screenshot(page, `${filename}-${mode}.png`);
      fault = null;
      await page.locator("#boot-reload").click();
      if (filename === "app.html") {
        await libraryReady(page); await assertSavedDataset(page, datasetId);
      } else {
        await explorerReady(page);
        assert.equal(await page.locator("#explorer-dataset").innerText(), "golden-little.stdf");
        await page.locator('[data-test-number="77"]').click(); await explorerReady(page);
        assert.match(await page.locator("#test-summary").innerText(), /5 observations.*3 recorded declarations/);
      }
      assert.equal(await page.locator("#boot-error").isVisible(), false);
    }
  }
  await page.goto(`${origin}/app.html`); await libraryReady(page);
  await assertSavedDataset(page, datasetId);
  checks.push("HTTP boot recovery on both pages: failed dependency, stale missing export and bounded module timeout show explicit reload; successful retry preserves dataset ID/hash and readable observations");
  assert.deepEqual(pageErrors, []);
  const report = { recordedAt: new Date().toISOString(), channel, browserVersion: context.browser().version(),
    checks, datasetId, sourceSha256: expected.sourceSha256, faultEvidence, requestFailures, pageErrors,
    deadlineTest: "Only module-load timeout was shortened to 200 ms in a routed test copy; production default is 15 seconds. Worker requests and imports have no new deadline." };
  await writeFile(resolve(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Evidence: ${output}`);
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await screenshot(activePage, "failure.png").catch(() => {});
    await writeFile(resolve(output, "failure.html"), await activePage.content()).catch(() => {});
  }
  await writeFile(resolve(output, "failure.json"), JSON.stringify({ error: error.stack, checks, pageErrors, requestFailures }, null, 2));
  throw error;
} finally { await context?.close(); server.close(); }
