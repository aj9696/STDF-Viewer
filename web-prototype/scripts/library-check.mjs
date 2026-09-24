import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep, extname } from "node:path";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const site = resolve(root, "site");
const output = resolve(root, "results", `library-${Date.now()}`);
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
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const channel = process.argv[2] ?? "chrome";
if (!["chrome", "msedge"].includes(channel)) throw new Error("Use chrome or msedge");
const profile = resolve(output, `profile-${channel}`);
let context;
const checks = [];
async function attach(page) {
  await page.goto(`${origin}/storage.html`);
  await page.evaluate(async () => {
    const { DataLibraryClient } = await import("./data-client.js");
    window.library = new DataLibraryClient({ onProgress: (progress) => { window.lastProgress = progress; } });
  });
}
const request = (page, type, payload = {}) => page.evaluate(({ type, payload }) => window.library.request(type, payload), { type, payload });
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
  const report = { recordedAt: new Date().toISOString(), browserVersion: context.browser().version(), channel, checks, status };
  await writeFile(resolve(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Evidence: ${output}`);
} finally { await context?.close(); server.close(); }
