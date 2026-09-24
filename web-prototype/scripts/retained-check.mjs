// Stream the actual WASM bindings, verify source identity independently, and
// check tuple/offset invariants without retaining a file-sized row collection.
import assert from "node:assert/strict";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { initSync, RetainedParser, Sha256Hasher } from "../site/pkg/parser.js";

const path = process.argv[2];
if (!path) throw new Error("Usage: node web-prototype/scripts/retained-check.mjs FILE");
initSync({ module: readFileSync(new URL("../site/pkg/parser_bg.wasm", import.meta.url)) });
const checks = [];
let expected;
for (const chunkBytes of [65536, 65521]) {
  const parser = new RetainedParser();
  const hasher = new Sha256Hasher();
  const reference = createHash("sha256");
  let offset = 0, records = 0, measurements = 0, devices = 0, definitions = 0;
  let maxBatchJsonBytes = 0;
  const started = performance.now();
  try {
    for await (const bytes of createReadStream(path, { highWaterMark: chunkBytes })) {
      hasher.update(bytes);
      reference.update(bytes);
      const serialized = parser.push(bytes);
      maxBatchJsonBytes = Math.max(maxBatchJsonBytes, Buffer.byteLength(serialized));
      const batch = JSON.parse(serialized);
      assert.equal(batch.version, 1);
      for (const row of batch.records) {
        assert.equal(row.length, 7);
        assert.equal(row[0], ++records);
        assert.equal(row[1], offset);
        offset += row[2];
        if (row[6] !== null) assert.equal(typeof JSON.parse(row[6]), "object");
      }
      for (const row of batch.definitions) {
        assert.equal(row.length, 4);
        assert.equal(row[0], ++definitions);
        const metadata = JSON.parse(row[3]);
        assert.match(metadata.RAW_TAIL_HEX, /^[a-f0-9]*$/);
        assert.ok(Array.isArray(metadata.PRESENT_FIELDS));
      }
      for (const row of batch.measurements) {
        assert.equal(row.length, 10);
        assert.ok(row[0] <= records && row[1] <= row[0]);
        assert.ok(row[2] <= definitions);
        const bits = new DataView(new ArrayBuffer(4));
        bits.setUint32(0, row[8], true);
        const value = bits.getFloat32(0, true);
        if (Number.isFinite(value)) assert.equal(row[9], value);
        else assert.equal(row[9], null);
      }
      for (const row of batch.devices) assert.equal(row.length, 13);
      measurements += batch.measurements.length;
      devices += batch.devices.length;
    }
    const summary = JSON.parse(parser.finish());
    const hash = hasher.finish();
    assert.equal(hash, reference.digest("hex"));
    assert.equal(summary.bytes, statSync(path).size);
    assert.equal(summary.bytes, offset);
    assert.equal(summary.records, records);
    assert.equal(summary.measurements, measurements);
    assert.equal(summary.devices, devices);
    assert.equal(summary.definitions, definitions);
    assert.ok(summary.coverage && !Array.isArray(summary.coverage));
    if (expected) assert.deepEqual({ summary, hash }, expected);
    else expected = { summary, hash };
    checks.push({ chunk_bytes: chunkBytes, max_batch_json_bytes: maxBatchJsonBytes,
      wasm_bytes: parser.memory_bytes(), elapsed_ms: performance.now() - started });
  } finally {
    parser.free();
    hasher.free();
  }
}
console.log(JSON.stringify({ file: resolve(path), ...expected, checks }, null, 2));
