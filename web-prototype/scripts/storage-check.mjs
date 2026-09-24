import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep, extname } from "node:path";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const site = resolve(root, "site");
const output = resolve(root, "results", `storage-${Date.now()}`);
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    const path = resolve(site, "." + decodeURIComponent(new URL(request.url, "http://localhost").pathname));
    if (!path.startsWith(site + sep)) throw new Error("Outside site");
    const bytes = await readFile(path);
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript",
      ".mjs": "text/javascript", ".wasm": "application/wasm", ".css": "text/css" })[extname(path)] ?? "application/octet-stream");
    response.end(bytes);
  } catch { response.writeHead(404); response.end("Not found"); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// Runs only in disposable test profiles. Exercise the released public DBPAGE
// API and chunked import against OPFS, without a full-database JS buffer.
async function transferProof(origin) {
  const { default: init } = await import(origin + "/sqlite/index.mjs");
  const sqlite3 = await init();
  const pool = await sqlite3.installOpfsSAHPoolVfs({
    name: "transfer-test", directory: ".semidata-transfer-test", initialCapacity: 6,
  });
  const db = new pool.OpfsSAHPoolDb("/source.db", "c");
  let target, stmt, sink;
  try {
    db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE samples(id INTEGER PRIMARY KEY, note TEXT)");
    db.exec("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<3000) INSERT INTO samples SELECT i, printf('sample %06d — units and flags preserved',i) FROM n");
    if (db.selectValue("SELECT sqlite_compileoption_used('ENABLE_DBPAGE_VTAB')") !== 1) throw new Error("DBPAGE unavailable");
    const root = await navigator.storage.getDirectory();
    const staging = await root.getFileHandle("transfer-proof.sqlite3", { create: true });
    sink = await staging.createWritable();
    let bytes = 0, pages = 0, maxChunkBytes = 0;
    db.exec("BEGIN");
    stmt = db.prepare("SELECT pgno, data FROM sqlite_dbpage('main') ORDER BY pgno");
    try {
      while (stmt.step()) {
        if (stmt.get(0) !== ++pages) throw new Error("Nonsequential export page");
        const chunk = stmt.getBlob(1);
        await sink.write(chunk);
        bytes += chunk.byteLength;
        maxChunkBytes = Math.max(maxChunkBytes, chunk.byteLength);
      }
    } finally { stmt.finalize(); stmt = undefined; db.exec("ROLLBACK"); }
    await sink.close(); sink = undefined;
    const file = await staging.getFile();
    if (file.size !== bytes) throw new Error("Export byte count mismatch");
    let offset = 0;
    await pool.importDb("/restored.db", async () => {
      if (offset === file.size) return undefined;
      const chunk = await file.slice(offset, offset + 8192).arrayBuffer();
      offset += chunk.byteLength;
      return chunk;
    });
    target = new pool.OpfsSAHPoolDb("/restored.db", "r");
    if (target.selectValue("PRAGMA integrity_check") !== "ok") throw new Error("Restored DB corrupt");
    // Exact comparison of all 3,000 fixture rows, streamed one row per statement.
    const before = db.prepare("SELECT id,note FROM samples ORDER BY id");
    const after = target.prepare("SELECT id,note FROM samples ORDER BY id");
    let rows = 0;
    try {
      while (before.step()) {
        if (!after.step() || before.get(0) !== after.get(0) || before.get(1) !== after.get(1)) throw new Error("Restored row mismatch");
        ++rows;
      }
      if (after.step()) throw new Error("Unexpected restored rows");
    } finally { before.finalize(); after.finalize(); }
    return { rows, bytes, pages, maxChunkBytes, wasmMemoryBytes: sqlite3.wasm.heap8u().byteLength,
      queryPlan: db.selectObjects("EXPLAIN QUERY PLAN SELECT pgno,data FROM sqlite_dbpage('main') ORDER BY pgno") };
  } finally {
    stmt?.finalize(); await sink?.abort(); target?.close(); db.close(); pool.pauseVfs();
  }
}

async function attach(page) {
  await page.goto(`${origin}/storage.html`);
  await page.evaluate(async () => {
    const { StorageProofClient } = await import("./library.js");
    window.probeClient = new StorageProofClient();
  });
}
function request(page, type, payload = {}) {
  return page.evaluate(async ({ type, payload }) => {
    if (type === "open" && !window.probeClient.worker) {
      const { StorageProofClient } = await import("./library.js");
      window.probeClient = new StorageProofClient();
    }
    return window.probeClient.request(type, payload);
  }, { type, payload });
}

const results = [];
try {
  for (const channel of process.argv.slice(2).length ? process.argv.slice(2) : ["chrome", "msedge"]) {
    if (!["chrome", "msedge"].includes(channel)) throw new Error("Supported channels: chrome, msedge");
    const profile = resolve(output, `profile-${channel}`);
    const checks = [];
    let context;
    const launch = () => chromium.launchPersistentContext(profile, { channel, headless: true });
    try {
      context = await launch();
      const page = await context.newPage();
      await attach(page);
      const initial = await request(page, "open");
      assert.equal(initial.row, null);
      assert.equal(initial.sqliteVersion, "3.53.4");
      await assert.rejects(request(page, "export"), /Save a note before exporting/);
      checks.push("empty probe export rejected with save-first guidance");
      const note = `Persistent probe ${channel} — μA ' SQL stays data`;
      const saved = await request(page, "write", { note });
      assert.equal(saved.row.note, note);
      await request(page, "close");
      assert.deepEqual((await request(page, "open")).row, saved.row);
      checks.push("create/write/close/reopen");
      await page.reload();
      await attach(page);
      assert.deepEqual((await request(page, "open")).row, saved.row);
      checks.push("page reload");

      const second = await context.newPage();
      await attach(second);
      const busy = await request(second, "open").then(() => null, (error) => error.message);
      assert.match(busy, /another tab/i);
      await request(page, "close");
      assert.deepEqual((await request(second, "open")).row, saved.row);
      await request(second, "close");
      await second.close();
      await request(page, "open");
      checks.push("second-tab ownership and retry");

      await assert.rejects(request(page, "write", { note: "" }), /1–200/);
      await assert.rejects(request(page, "write", { note: "x".repeat(201) }), /1–200/);
      await assert.rejects(request(page, "invalid"), /Unknown storage operation/);
      assert.deepEqual((await request(page, "read")).row, saved.row);
      checks.push("invalid inputs preserve saved row");

      const backup = await page.evaluate(async () => {
        const { bytes } = await window.probeClient.request("export");
        window.backupBytes = bytes;
        return Array.from(new Uint8Array(bytes));
      });
      assert.ok(backup.length > 512 && backup.length <= 1024 * 1024);
      await writeFile(resolve(output, `${channel}-probe.sqlite3`), new Uint8Array(backup));
      await request(page, "write", { note: "Changed after backup" });
      const restored = await page.evaluate(() => window.probeClient.request("restore", { bytes: window.backupBytes.slice(0) }));
      assert.deepEqual(restored.row, saved.row);
      checks.push("SQLite export/restore");

      for (const corruption of ["version", "header", "oversize"]) {
        const rejected = await page.evaluate(async (corruption) => {
          const bytes = corruption === "oversize" ? new ArrayBuffer(1024 * 1024 + 1) : window.backupBytes.slice(0);
          const view = new DataView(bytes);
          if (corruption === "version") view.setUint32(60, 99);
          if (corruption === "header") view.setUint32(0, 0);
          try { await window.probeClient.request("restore", { bytes }); return null; }
          catch (error) { return { code: error.code, message: error.message }; }
        }, corruption);
        assert.ok(rejected, `Rejected ${corruption} backup`);
        assert.deepEqual((await request(page, "read")).row, saved.row);
      }
      checks.push("incompatible/corrupt/oversized backup leaves live row intact");

      await page.evaluate(() => window.probeClient.terminate());
      await request(page, "open");
      assert.deepEqual((await request(page, "read")).row, saved.row);
      checks.push("worker termination releases ownership; committed row survives");
      const browserVersion = context.browser().version();
      const storage = await page.evaluate(async () => ({ origin: location.origin,
        persisted: await navigator.storage.persisted(), estimate: await navigator.storage.estimate(),
        userAgent: navigator.userAgent, crossOriginIsolated }));
      // Closing a persistent context closes its dedicated browser process.
      await context.close();
      context = await launch();
      const reopened = await context.newPage();
      await attach(reopened);
      assert.deepEqual((await request(reopened, "open")).row, saved.row);
      await request(reopened, "close");
      checks.push("full browser process restart using the same test profile and origin");

      const unsupported = await reopened.evaluate(async (origin) => {
        const script = `Object.defineProperty(navigator, "storage", {value: undefined}); await import(${JSON.stringify(origin + "/storage-worker.js")}); self.postMessage({ready:true});`;
        const url = URL.createObjectURL(new Blob([script], { type: "text/javascript" }));
        const worker = new Worker(url, { type: "module" });
        try {
          return await new Promise((resolve, reject) => {
            worker.onmessage = ({ data }) => data.ready
              ? worker.postMessage({ version: 1, id: 1, type: "open" }) : resolve(data);
            worker.onerror = (event) => reject(new Error(event.message));
          });
        } finally { worker.terminate(); URL.revokeObjectURL(url); }
      }, origin);
      assert.equal(unsupported.error.code, "UNSUPPORTED");
      checks.push("missing OPFS fails explicitly without temporary fallback");
      const transfer = await reopened.evaluate(async ({ source, origin }) => {
        const script = `(${source})(${JSON.stringify(origin)}).then(result => self.postMessage({result}), error => self.postMessage({error: String(error.stack)}));`;
        const url = URL.createObjectURL(new Blob([script], { type: "text/javascript" }));
        const worker = new Worker(url, { type: "module" });
        try {
          return await new Promise((resolve, reject) => {
            worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.result);
            worker.onerror = (event) => reject(new Error(event.message));
          });
        } finally { worker.terminate(); URL.revokeObjectURL(url); }
      }, { source: transferProof.toString(), origin });
      assert.equal(transfer.rows, 3000);
      assert.ok(transfer.pages > 1);
      assert.ok(transfer.maxChunkBytes <= 8192);
      checks.push("page-at-a-time OPFS export and chunked restore; all 3,000 rows equal");
      results.push({ channel, browserVersion, checks, storage, initial, saved, exportedBytes: backup.length, transfer });
      console.log(`${channel} ${browserVersion}: ${checks.length} storage checks passed`);
    } finally { await context?.close(); }
  }
  await writeFile(resolve(output, "results.json"), JSON.stringify({ recordedAt: new Date().toISOString(), results }, null, 2) + "\n");
  console.log(`Evidence: ${output}`);
} finally { server.close(); }
