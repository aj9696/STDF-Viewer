import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const repository = resolve(root, "..");
const site = resolve(root, "site");
const channel = process.argv[2] ?? "chrome";
if (!["chrome", "msedge"].includes(channel)) throw new Error("Use chrome or msedge");
const queriesOnly = process.argv.includes("--queries-only");
const output = resolve(root, "results", `explorer-${channel}-${Date.now()}`);
const fixtureDirectory = resolve(output, "fixtures");
await mkdir(output, { recursive: true });
const generated = spawnSync(resolve(repository, ".venv/Scripts/python.exe"),
  [resolve(root, "scripts/make-explorer-fixtures.py"), fixtureDirectory], { encoding: "utf8" });
if (generated.status !== 0) throw new Error(generated.stderr || generated.error?.message || "Fixture generation failed");
const fixtures = JSON.parse(await readFile(resolve(fixtureDirectory, "expected.json"), "utf8")).files;
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
const checks = [], pageErrors = [], plans = [];
const imported = new Map();
let context, activePage;
let failNextWorker = false;

// Test-only injection is restricted to this isolated browser profile and origin.
// It records plans from the actual prepared query and permits metadata corruption
// fixtures, then restores the original values before any normal UI inspection.
const workerProbe = `
const fixturePlans = [];
const fixtureAccess = store.access.bind(store);
store.access = async (...args) => {
  const opened = await fixtureAccess(...args);
  const prepare = opened.db.prepare.bind(opened.db);
  opened.db.prepare = (sql) => {
    const statement = prepare(sql);
    if (typeof sql === "string" && /measurements|definitions/.test(sql) && !sql.startsWith("EXPLAIN")) {
      const bind = statement.bind.bind(statement);
      statement.bind = (values) => {
        const explain = prepare("EXPLAIN QUERY PLAN " + sql);
        try {
          explain.bind(values);
          const rows = [];
          while (explain.step()) rows.push(explain.get({}));
          if (fixturePlans.length < 1000) fixturePlans.push({ sql, rows });
        } finally { explain.finalize(); }
        return bind(values);
      };
    }
    return statement;
  };
  return opened;
};
`;
const fixtureDispatch = `
  if (message.type === "__fixturePlans") return fixturePlans.splice(0);
  if (message.type === "__fixtureMetadata") {
    const dataset = store.get(message.datasetId);
    const db = new store.pool.OpfsSAHPoolDb(dataset.db_path, "w");
    try {
      db.transaction(() => { for (const row of message.rows) db.exec({ sql: "UPDATE definitions SET metadata_json=? WHERE id=?", bind: [row.metadata_json, row.id] }); });
      return { changed: message.rows.length };
    } finally { db.close(); }
  }
  if (message.type === "__fixtureDefinitionLimit") {
    const dataset = store.get(message.datasetId);
    const db = new store.pool.OpfsSAHPoolDb(dataset.db_path, "w");
    try {
      if (message.remove) {
        db.exec({sql:"DELETE FROM definitions WHERE id BETWEEN ? AND ?", bind:[message.first, message.last]});
        return {remaining:db.selectValue("SELECT COUNT(*) FROM definitions")};
      }
      const before = db.selectValue("SELECT COUNT(*) FROM definitions");
      const first = db.selectValue("SELECT MAX(id) FROM definitions") + 1;
      const last = first + (20001 - before) - 1;
      const statement = db.prepare("INSERT INTO definitions(id,test_number,name,metadata_json) VALUES(?,77,'test-only limit fixture','{}')");
      try { db.transaction(() => { for(let id=first;id<=last;id++) { statement.bind([id]).step(); statement.reset(); } }); }
      finally { statement.finalize(); }
      return {before,first,last};
    } finally { db.close(); }
  }
`;
async function request(page, type, payload = {}) {
  return page.evaluate(({ type, payload }) => window.library.request(type, payload), { type, payload });
}
async function expectError(page, type, payload, code = "INVALID_REQUEST") {
  const result = await page.evaluate(async ({ type, payload }) => {
    try { await window.library.request(type, payload); return { accepted: true }; }
    catch (error) { return { code: error.code, message: error.message }; }
  }, { type, payload });
  assert.equal(result.code, code, `${type}: ${JSON.stringify(payload)} -> ${JSON.stringify(result)}`);
}
async function allPages(page, type, payload, limit) {
  const items = [];
  let after = type === "listTests" ? null : 0;
  for (let iteration = 0; iteration < 200; iteration++) {
    const batch = await request(page, type, { ...payload, after, limit });
    assert.ok(batch.items.length <= limit);
    assert.ok(Buffer.byteLength(JSON.stringify(batch.items)) <= 2 * 1024 * 1024);
    items.push(...batch.items);
    if (batch.nextAfter === null) return items;
    assert.ok(after === null || batch.nextAfter > after);
    after = batch.nextAfter;
  }
  throw new Error(`${type} did not reach its final cursor`);
}
function normalizedMeasurements(rows) {
  return rows.map((row) => ({ ...row, result: row.result === 0 ? 0 : row.result }));
}
async function screenshot(page, name) {
  await page.screenshot({ path: resolve(output, name), fullPage: true, animations: "disabled" });
}
async function explorerReady(page) {
  await page.waitForFunction(() => document.querySelector("#main")?.getAttribute("aria-busy") === "false" &&
    !document.querySelector("#test-search-submit")?.disabled);
}
async function searchTests(page, query, keyboard = false) {
  await page.locator("#test-query").fill(query);
  if (keyboard) await page.locator("#test-query").press("Enter");
  else await page.locator("#test-search-submit").click();
  await explorerReady(page);
  if (keyboard) await expectFocus(page, "test-query");
}
async function expectFocus(page, id) {
  await page.waitForFunction((id) => document.activeElement?.id === id, id);
}
async function keyboardPage(page, id, focusAfter = id) {
  await page.locator(`#${id}`).focus();
  await page.keyboard.press("Enter");
  await explorerReady(page);
  await expectFocus(page, focusAfter);
}
async function selectTest(page, number) {
  await page.locator(`[data-test-number="${number}"]`).click();
  await explorerReady(page);
  assert.equal(await page.locator("#selected-test").innerText(), `Test ${number}`);
}
async function cells(page, selector) {
  return page.locator(`${selector} tr`).evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent)));
}
async function attachApi(page) {
  await page.goto(`${origin}/storage.html`);
  await page.evaluate(async () => {
    const { DataLibraryClient } = await import("./data-client.js");
    window.library = new DataLibraryClient(); await window.library.open();
  });
}
function observationCells(row) {
  const special = (row.result_bits & 0x7F800000) === 0x7F800000;
  const result = row.result_bits === 0x80000000 ? "-0" : special
    ? (row.result_bits & 0x7FFFFF) ? "NaN" : row.result_bits === 0x7F800000 ? "Infinity" : "-Infinity"
    : String(row.result);
  return [row.seq, row.device_id, row.part_id, `${row.head} / ${row.site}`, result, row.definition_id,
    `0x${row.test_flags.toString(16).toUpperCase().padStart(2, "0")}`, `0x${row.parm_flags.toString(16).toUpperCase().padStart(2, "0")}`].map(String);
}

try {
  context = await chromium.launchPersistentContext(resolve(output, "profile"), { channel, headless: true, viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(15000);
  context.on("page", (page) => {
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("dialog", async (dialog) => { pageErrors.push(`Unexpected browser dialog: ${dialog.message()}`); await dialog.dismiss(); });
  });
  const originalWorker = await readFile(resolve(site, "data-worker.js"), "utf8");
  assert.ok(originalWorker.includes("const store = new LibraryStore();"));
  assert.ok(originalWorker.includes("async function dispatch(message, context) {"));
  await context.route("**/data-worker.js", (route) => {
    const failure = failNextWorker ? `if (message.type === "getTest") { setTimeout(() => { throw new Error("Test-only worker failure"); }, 0); await new Promise(() => {}); }` : "";
    return route.fulfill({ contentType: "text/javascript", body: originalWorker
      .replace("const store = new LibraryStore();", `const store = new LibraryStore();\n${workerProbe}`)
      .replace("async function dispatch(message, context) {", `async function dispatch(message, context) {\n${fixtureDispatch}\n${failure}`) });
  });
  const page = activePage = await context.newPage();
  await page.goto(`${origin}/storage.html`);
  await page.evaluate(async () => {
    const { DataLibraryClient } = await import("./data-client.js");
    window.library = new DataLibraryClient();
    await window.library.open();
  });
  for (const [filename, expected] of Object.entries(fixtures)) {
    await page.locator("#backup-file").setInputFiles(resolve(fixtureDirectory, filename));
    const result = await page.evaluate(() => window.library.importFile(document.querySelector("#backup-file").files[0]));
    assert.equal(result.dataset.source_hash, expected.sourceSha256);
    assert.deepEqual(result.dataset.manifest.counts, expected.counts);
    imported.set(filename, result.dataset);
    const datasetId = result.dataset.id;
    const groups = await allPages(page, "listTests", { datasetId }, 7);
    assert.deepEqual(groups, expected.groups);
    const summary = await request(page, "listTests", { datasetId, limit: 50 });
    assert.equal(summary.totalTests, expected.groups.length);
    assert.equal(summary.matchedTests, expected.groups.length);
    if (!groups.length) {
      assert.equal(summary.nextAfter, null);
      await expectError(page, "getTest", { datasetId, testNumber: 12 }, "NOT_FOUND");
      assert.deepEqual(await request(page, "readTestMeasurements", { datasetId, testNumber: 12 }), { items: [], nextAfter: null });
      continue;
    }
    for (const testNumber of [0, 77, 88, 4294967295]) {
      const definitions = expected.definitions.filter((row) => row.test_number === testNumber);
      const measurements = expected.measurements.filter((row) => row.test_number === testNumber);
      assert.deepEqual(await request(page, "getTest", { datasetId, testNumber }),
        { test_number: testNumber, measurementCount: measurements.length, definitionCount: definitions.length });
      const actualDefinitions = await allPages(page, "readTestDefinitions", { datasetId, testNumber }, 9);
      assert.deepEqual(actualDefinitions.map(({ metadata_json, ...row }) => ({ ...row, metadata: JSON.parse(metadata_json) })), definitions);
      assert.deepEqual(await allPages(page, "readTestMeasurements", { datasetId, testNumber }, 13), normalizedMeasurements(measurements));
    }
    for (const query of ["%", "_", "' OR 1=1 --", "μCurrent", "ΜCurrent", "vdd", "4294967295", "", "nothing-matches"]) {
      const folded = query.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
      const matched = new Set(expected.definitions.filter((row) => String(row.test_number).includes(query) ||
        (row.name ?? "").replace(/[A-Z]/g, (letter) => letter.toLowerCase()).includes(folded)).map((row) => row.test_number));
      const wanted = expected.groups.filter((row) => matched.has(row.test_number));
      const result = await request(page, "listTests", { datasetId, query, limit: 100 });
      assert.deepEqual(result.items, wanted);
      assert.equal(result.totalTests, expected.groups.length);
      assert.equal(result.matchedTests, wanted.length);
    }
    const afterZero = await request(page, "listTests", { datasetId, after: 0, limit: 100 });
    assert.equal(afterZero.items[0].test_number, 1);
    assert.equal(afterZero.totalTests, expected.groups.length);
    assert.equal(afterZero.matchedTests, expected.groups.length);
    assert.deepEqual(await request(page, "listTests", { datasetId, after: 4294967295 }),
      { items: [], nextAfter: null, totalTests: expected.groups.length, matchedTests: expected.groups.length });
    await expectError(page, "getTest", { datasetId, testNumber: 99 }, "NOT_FOUND");
    assert.deepEqual(await request(page, "readTestDefinitions", { datasetId, testNumber: 99 }), { items: [], nextAfter: null });
    assert.deepEqual(await request(page, "readTestMeasurements", { datasetId, testNumber: 77, after: 6, limit: 1 }),
      { items: normalizedMeasurements(expected.measurements.filter((row) => row.test_number === 77 && row.seq > 6).slice(0, 1)), nextAfter: 7 });
  }
  checks.push("real SQLite: both-endian golden groups, exact declaration metadata, all selected observations/attempt joins, zero/max test numbers, sparse keyset cursors, literal search and no-PTR empty dataset");

  const datasetId = imported.get("explorer-little.stdf").id;
  const expected = fixtures["explorer-little.stdf"];
  for (const query of [null, 12, [], {}, "x".repeat(129)]) await expectError(page, "listTests", { datasetId, query });
  for (const after of [-1, 0.5, NaN, Infinity, 4294967296, "0"]) await expectError(page, "listTests", { datasetId, after });
  for (const limit of [0, -1, 0.5, NaN, Infinity, 101, null, "10"]) await expectError(page, "listTests", { datasetId, limit });
  for (const type of ["getTest", "readTestDefinitions", "readTestMeasurements"]) {
    for (const testNumber of [undefined, null, -1, 0.1, NaN, Infinity, 4294967296, "77"]) {
      await expectError(page, type, { datasetId, testNumber });
    }
  }
  for (const [type, maximum] of [["readTestDefinitions", 100], ["readTestMeasurements", 1000]]) {
    for (const after of [-1, 0.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, "0"]) {
      await expectError(page, type, { datasetId, testNumber: 77, after });
    }
    for (const limit of [0, -1, 0.5, NaN, Infinity, maximum + 1, null, "10"]) {
      await expectError(page, type, { datasetId, testNumber: 77, limit });
    }
  }
  const normalDefinitions = await request(page, "readTestDefinitions", { datasetId, testNumber: 77 });
  const normalMeasurements = await request(page, "readTestMeasurements", { datasetId, testNumber: 77 });
  assert.equal(normalDefinitions.items.length, 25);
  assert.equal(normalMeasurements.items.length, 100);
  assert.ok(normalDefinitions.nextAfter !== null && normalMeasurements.nextAfter !== null);
  checks.push("real SQLite: default page sizes and strict invalid search/test/cursor/limit rejection, including NaN, infinity, fractions and wrong types");

  const modified = expected.definitions.filter((row) => row.test_number === 77);
  const restoreMetadata = modified.map((row) => ({ id: row.id, metadata_json: JSON.stringify(row.metadata) }));
  const largeMetadata = JSON.stringify({ TEST_TXT: "漢".repeat(16000), PRESENT_FIELDS: ["TEST_TXT"] });
  await request(page, "__fixtureMetadata", { datasetId, rows: modified.map((row) => ({ id: row.id, metadata_json: largeMetadata })) });
  try {
    const first = await request(page, "readTestDefinitions", { datasetId, testNumber: 77, limit: 100 });
    assert.ok(first.items.length > 0 && first.items.length < modified.length, "Unicode byte budget must truncate a sub-100-row page");
    assert.ok(Buffer.byteLength(JSON.stringify(first.items)) <= 2 * 1024 * 1024);
    assert.ok(first.nextAfter !== null);
    const all = await allPages(page, "readTestDefinitions", { datasetId, testNumber: 77 }, 100);
    assert.deepEqual(all.map((row) => row.id), modified.map((row) => row.id));
  } finally { await request(page, "__fixtureMetadata", { datasetId, rows: restoreMetadata }); }
  checks.push("test-only large Unicode metadata in real SQLite: 2MiB byte cap truncates a short page and resumes without lost/duplicate declarations; original metadata restored");

  const added = await request(page, "__fixtureDefinitionLimit", { datasetId });
  assert.equal(added.before, expected.counts.definitions);
  try {
    for (const type of ["listTests", "getTest", "readTestDefinitions", "readTestMeasurements"]) {
      await expectError(page, type, { datasetId, testNumber: 77, limit: 1 }, "LIBRARY_LIMIT");
    }
  } finally {
    const cleaned = await request(page, "__fixtureDefinitionLimit", { datasetId, remove: true, first: added.first, last: added.last });
    assert.equal(cleaned.remaining, expected.counts.definitions);
  }
  assert.equal((await request(page, "getTest", { datasetId, testNumber: 77 })).definitionCount, 63);
  assert.equal((await request(page, "verifyDataset", { datasetId })).verified, true);
  checks.push("test-only oversized restored inventory: all four queries reject 20,001 actual declarations despite a smaller manifest; only inserted rows removed and original dataset/source verification passes");

  plans.push(...await request(page, "__fixturePlans"));
  const measurementPlans = plans.filter((entry) => /WHERE m\.test_number=\? AND m\.seq>\?/.test(entry.sql));
  const countPlans = plans.filter((entry) => /SELECT COUNT\(\*\) FROM measurements WHERE test_number=\?/.test(entry.sql));
  const listPlans = plans.filter((entry) => /WITH test_groups/.test(entry.sql));
  assert.ok(measurementPlans.length > 0 && countPlans.length > 0 && listPlans.length > 0, "Actual executed SQL plans must be captured");
  for (const entry of measurementPlans) {
    assert.ok(entry.rows.some((row) => /SEARCH m USING INDEX measurements_test/.test(row.detail)));
    assert.ok(entry.rows.some((row) => /SEARCH d USING INTEGER PRIMARY KEY/.test(row.detail)));
    assert.ok(entry.rows.every((row) => !/SCAN m\b|TEMP B-TREE/.test(row.detail)));
  }
  for (const entry of countPlans) assert.ok(entry.rows.some((row) => /USING COVERING INDEX measurements_test/.test(row.detail)));
  for (const entry of listPlans) assert.ok(entry.rows.every((row) => !/measurements/.test(row.detail)));
  checks.push("test-only observation of actual SQL: measurement pages/counts use measurements_test, attempt joins use INTEGER PRIMARY KEY, group search never scans measurements");

  if (!queriesOnly) {
    await page.evaluate(() => window.library.close());
    await page.goto(`${origin}/app.html`);
    await page.waitForFunction(() => !document.querySelector("#add-file").disabled);
    await page.locator(`[data-dataset-id="${datasetId}"]`).first().click();
    await page.getByRole("link", { name: "Explore tests" }).click();
    const explorerUrl = `${origin}/explore.html?dataset=${datasetId}`;
    await page.waitForURL(explorerUrl);
    await explorerReady(page);
    assert.equal(await page.locator("#explorer-dataset").innerText(), "explorer-little.stdf");
    assert.equal(await page.locator("#tests-body [data-test-number]").count(), 50);
    assert.match(await page.locator("#test-count").innerText(), /58 of 58/);
    assert.equal(await page.locator("#test-empty").isVisible(), true);
    await selectTest(page, 0);
    assert.equal((await cells(page, "#measurements-body")).length, 1);
    await keyboardPage(page, "tests-next", "tests-previous");
    assert.equal(await page.locator("#tests-body [data-test-number]").count(), 8);
    assert.equal(await page.locator("#tests-next").isDisabled(), true);
    await keyboardPage(page, "tests-previous", "tests-next");
    assert.equal(await page.locator("#tests-body [data-test-number]").first().getAttribute("data-test-number"), "0");
    await screenshot(page, "01-explorer-test-zero.png");
    checks.push("real UI: dataset overview opens Explorer in the same tab; 58-test inventory pages 50/8 and test zero is selectable");

    await searchTests(page, "%", true);
    assert.equal(await page.locator("#tests-body [data-test-number]").count(), 1);
    assert.match(await page.locator("#tests-body").innerText(), /63 recorded declarations/);
    assert.equal(await page.locator("#tests-body svg[onload]").count(), 0);
    assert.equal(await page.locator("#test-detail").isVisible(), false);
    await selectTest(page, 77);
    await expectFocus(page, "selected-test");
    assert.match(await page.locator("#test-summary").innerText(), /155 observations.*63 recorded declarations/);
    const observations = expected.measurements.filter((row) => row.test_number === 77);
    assert.deepEqual(await cells(page, "#measurements-body"), observations.slice(0, 100).map(observationCells));
    const declarations = expected.definitions.filter((row) => row.test_number === 77);
    const firstDefinitions = await cells(page, "#definitions-body");
    assert.equal(firstDefinitions.length, 25);
    assert.deepEqual(firstDefinitions.slice(0, 4), [
      ["1", "VDD", "V", "0.5", "1.5", "-3", "-3", "-3", "0x00"],
      ["2", ...Array(8).fill("Not recorded")],
      ["3", "(empty)", ...Array(7).fill("Not recorded")],
      ["61", "<svg onload=alert(1)>", "V", "NaN", "-0", "-3", "-2", "3", "0xFF"],
    ]);
    assert.match(await page.locator(".recorded-note").innerText(), /defaults.*scale.*not applied/i);
    assert.equal(await page.locator("#definitions-body svg[onload]").count(), 0);
    await screenshot(page, "02-explorer-recorded-values.png");
    await keyboardPage(page, "measurements-next", "measurements-previous");
    assert.deepEqual(await cells(page, "#measurements-body"), observations.slice(100).map(observationCells));
    assert.equal(await page.locator("#measurements-next").isDisabled(), true);
    await keyboardPage(page, "measurements-previous", "measurements-next");
    assert.deepEqual(await cells(page, "#measurements-body"), observations.slice(0, 100).map(observationCells));
    for (const offset of [25, 50]) {
      await keyboardPage(page, "definitions-next", offset === 50 ? "definitions-previous" : "definitions-next");
      assert.deepEqual((await cells(page, "#definitions-body")).map((row) => Number(row[0])), declarations.slice(offset, offset + 25).map((row) => row.id));
    }
    assert.equal(await page.locator("#definitions-next").isDisabled(), true);
    await keyboardPage(page, "definitions-previous");
    assert.deepEqual((await cells(page, "#definitions-body")).map((row) => Number(row[0])), declarations.slice(25, 50).map((row) => row.id));
    checks.push("real UI: literal search retains all declaration variants; recorded limits/scales/flags distinguish omitted, empty and special floats; 25/100-row paging preserves every observation and attempt");
    checks.push("real UI: keyboard search and page navigation restore focus after async disable; final/first page moves focus to the available direction, test selection focuses its heading");

    await page.setViewportSize({ width: 390, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await screenshot(page, "03-explorer-narrow.png");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await searchTests(page, "4294967295");
    await selectTest(page, 4294967295);
    assert.equal((await cells(page, "#measurements-body")).length, 1);
    assert.equal(await page.locator("#measurements-previous").isDisabled(), true);
    assert.equal(await page.locator("#definitions-previous").isDisabled(), true);
    await searchTests(page, "no test matches this");
    assert.equal(await page.locator("#tests-body [data-test-number]").count(), 0);
    assert.match(await page.locator("#test-list-message").innerText(), /No matching tests/i);
    assert.equal(await page.locator("#test-detail").isVisible(), false);
    await page.reload(); await explorerReady(page);
    assert.equal(await page.locator("#explorer-dataset").innerText(), "explorer-little.stdf");
    assert.equal(await page.locator("#tests-body [data-test-number]").count(), 50);
    await page.goBack(); await page.waitForURL(`${origin}/app.html`);
    await page.waitForFunction(() => !document.querySelector("#add-file").disabled);
    await page.goto(explorerUrl); await explorerReady(page);
    checks.push("real UI: 390px layout fits, search resets cursors, max-u32 test works, no-results state, reload and browser Back reopen retained data");

    const blocked = activePage = await context.newPage();
    await blocked.goto(explorerUrl);
    await blocked.locator("#explorer-error").waitFor({ state: "visible" });
    assert.match(await blocked.locator("#explorer-error-text").innerText(), /another tab/i);
    assert.equal(await blocked.locator("#test-search-submit").isDisabled(), true);
    await page.close();
    await blocked.locator("#explorer-retry").click(); await explorerReady(blocked);
    await blocked.goto(`${origin}/explore.html?dataset=${imported.get("explorer-no-ptr.stdf").id}`);
    await explorerReady(blocked);
    assert.equal(await blocked.locator("#tests-body [data-test-number]").count(), 0);
    assert.match(await blocked.locator("#test-list-message").innerText(), /No PTR measurements/);
    for (const suffix of ["", "?dataset=invalid-id"]) {
      await blocked.goto(`${origin}/explore.html${suffix}`);
      await blocked.locator("#explorer-error").waitFor({ state: "visible" });
      assert.match(await blocked.locator("#explorer-error-text").innerText(), /No valid dataset/);
      assert.equal(await blocked.locator("#test-search-submit").isDisabled(), true);
    }
    await blocked.goto(`${origin}/explore.html?dataset=00000000-0000-4000-8000-000000000000`);
    await blocked.locator("#explorer-error").waitFor({ state: "visible" });
    assert.match(await blocked.locator("#explorer-error-text").innerText(), /not in the current library/i);
    checks.push("real UI: exclusive-owner BUSY retry, no-PTR empty state and missing/invalid dataset recovery are actionable");

    await attachApi(blocked);
    await request(blocked, "__fixtureMetadata", { datasetId, rows: [
      { id: 1, metadata_json: "{bad-json" }, { id: 2, metadata_json: "[]" },
      { id: 3, metadata_json: JSON.stringify({ PRESENT_FIELDS: ["UNITS"], UNITS: 77 }) },
      { id: 61, metadata_json: JSON.stringify({ PRESENT_FIELDS: ["FUTURE_FIELD"], FUTURE_FIELD: "unknown" }) },
      { id: 62, metadata_json: JSON.stringify({ PRESENT_FIELDS: ["UNITS", "UNITS"], UNITS: "V" }) },
      { id: 63, metadata_json: JSON.stringify({ PRESENT_FIELDS: ["ALARM_ID"], ALARM_ID: 123 }) },
    ] });
    await blocked.evaluate(() => window.library.close());
    await blocked.goto(explorerUrl); await explorerReady(blocked);
    await searchTests(blocked, "77"); await selectTest(blocked, 77);
    assert.equal(await blocked.locator("#definitions-body .field-error").count(), 6);
    assert.equal((await cells(blocked, "#measurements-body")).length, 100);
    await screenshot(blocked, "04-explorer-malformed-metadata.png");
    await attachApi(blocked);
    await request(blocked, "__fixtureMetadata", { datasetId, rows: restoreMetadata });
    await blocked.evaluate(() => window.library.close());
    checks.push("test-only malformed metadata in real SQLite: bad JSON, non-object, wrong types, unknown/duplicate presence and invalid undisplayed fields are reported; originals restored");

    failNextWorker = true;
    await blocked.goto(explorerUrl); await explorerReady(blocked);
    failNextWorker = false;
    await blocked.locator('[data-test-number="0"]').click();
    await blocked.locator("#explorer-error").waitFor({ state: "visible" });
    assert.match(await blocked.locator("#explorer-error-text").innerText(), /connection stopped/i);
    assert.equal(await blocked.locator("#test-query").isDisabled(), true);
    assert.equal(await blocked.locator("#explorer-retry").isEnabled(), true);
    await blocked.locator("#explorer-retry").click(); await explorerReady(blocked);
    await selectTest(blocked, 0);
    checks.push("test-only injected real-worker exception: loading settles into disabled error state, retry reconnects and observations remain readable");

    const clientSource = await readFile(resolve(site, "data-client.js"), "utf8");
    await context.route("**/data-client.js", (route) => route.fulfill({ contentType: "text/javascript", body: `${clientSource}\n
const fixtureOpen = DataLibraryClient.prototype.open;
DataLibraryClient.prototype.open = async function(...args) {
  if (new URL(location.href).searchParams.get("testFailure") === "unsupported") throw Object.assign(new Error("Test-only unsupported browser"), {code:"UNSUPPORTED"});
  return fixtureOpen.apply(this, args);
};
const fixtureDataset = DataLibraryClient.prototype.getDataset;
DataLibraryClient.prototype.getDataset = async function(...args) {
  if (new URL(location.href).searchParams.get("testFailure") === "unavailable") throw Object.assign(new Error("Test-only missing source"), {code:"UNAVAILABLE"});
  return fixtureDataset.apply(this, args);
};` }));
    for (const failure of ["unsupported", "unavailable"]) {
      await blocked.goto(`${explorerUrl}&testFailure=${failure}`);
      await blocked.locator("#explorer-error").waitFor({ state: "visible" });
      assert.match(await blocked.locator("#explorer-error-text").innerText(), failure === "unsupported" ? /supported.*browser/i : /saved dataset needs attention/i);
      assert.equal(await blocked.locator("#test-search-submit").isDisabled(), true);
      assert.equal(await blocked.locator("#explorer-retry").isEnabled(), true);
      assert.doesNotMatch(await blocked.locator("#test-count").innerText(), /Opening/);
    }
    await blocked.goto(explorerUrl); await explorerReady(blocked);
    await selectTest(blocked, 0);
    checks.push("test-only adapter failures: unsupported and unavailable states show recovery guidance without stale loading text or data loss");
  }
  assert.deepEqual(pageErrors, []);
  const report = { recordedAt: new Date().toISOString(), channel, queriesOnly, browserVersion: context.browser().version(), checks, pageErrors, plans };
  await writeFile(resolve(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, plans: plans.length }, null, 2));
  console.log(`Evidence: ${output}`);
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await screenshot(activePage, "failure.png").catch(() => {});
    await writeFile(resolve(output, "failure.html"), await activePage.content()).catch(() => {});
  }
  await writeFile(resolve(output, "failure.json"), JSON.stringify({ error: error.stack, checks, pageErrors }, null, 2));
  throw error;
} finally { await context?.close(); server.close(); }
