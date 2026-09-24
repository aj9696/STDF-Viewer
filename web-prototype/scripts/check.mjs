import { createReadStream, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { initSync, Parser } from "../site/pkg/parser.js";

const prototype = fileURLToPath(new URL("..", import.meta.url));
const root = resolve(prototype, "..");
const path = process.argv[2];
if (!path)
  throw new Error(
    "Usage: node web-prototype/scripts/check.mjs FILE [--skip-python]",
  );
initSync({
  module: readFileSync(resolve(prototype, "site/pkg/parser_bg.wasm")),
});

function comparable(result) {
  const {
    schema_version,
    engine,
    max_pending_bytes,
    max_input_bytes,
    carry_capacity,
    ...semantic
  } = result;
  return semantic;
}

function approximatelyEqual(actual, expected, path = "result") {
  if (typeof actual === "number" && typeof expected === "number") {
    assert.ok(
      Math.abs(actual - expected) <=
        Math.max(1e-12, Math.abs(expected) * 2e-12),
      `${path}: ${actual} != ${expected}`,
    );
  } else if (
    actual &&
    expected &&
    typeof actual === "object" &&
    typeof expected === "object"
  ) {
    assert.deepEqual(
      Object.keys(actual).sort(),
      Object.keys(expected).sort(),
      `${path}: keys differ`,
    );
    for (const key of Object.keys(actual))
      approximatelyEqual(actual[key], expected[key], `${path}.${key}`);
  } else assert.equal(actual, expected, path);
}

const nativePath = resolve(
  root,
  ".venv/toolchain/web-target/release/native.exe",
);
const native = spawnSync(nativePath, [path], {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
if (native.status !== 0)
  throw new Error(
    native.stderr || native.error?.message || "Native scan failed",
  );
const expected = comparable(JSON.parse(native.stdout));
if (!process.argv.includes("--skip-python")) {
  const pythonPath = resolve(root, ".venv/Scripts/python.exe");
  const reference = spawnSync(
    pythonPath,
    [resolve(prototype, "scripts/reference.py"), path],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (reference.status !== 0)
    throw new Error(reference.stderr || "Python reference failed");
  approximatelyEqual(expected, JSON.parse(reference.stdout));
}

const checks = [];
const sizes =
  statSync(path).size < 4096
    ? [1, 7, 65536, 4 * 1024 * 1024]
    : [65521, 4 * 1024 * 1024];
for (const chunkBytes of sizes) {
  const parser = new Parser();
  try {
    for await (const bytes of createReadStream(path, {
      highWaterMark: chunkBytes,
    }))
      parser.push(bytes);
    const result = JSON.parse(parser.finish());
    approximatelyEqual(comparable(result), expected);
    assert.ok(result.max_pending_bytes <= 65539);
    assert.equal(result.carry_capacity, 65539);
    checks.push({
      chunk_bytes: chunkBytes,
      max_pending_bytes: result.max_pending_bytes,
      wasm_bytes: parser.memory_bytes(),
    });
  } finally {
    parser.free();
  }
}
console.log(
  JSON.stringify(
    {
      file: resolve(path),
      records: expected.records,
      ptr_count: expected.ptr_count,
      groups: expected.groups.length,
      ptr_digest: expected.ptr_digest,
      independent_python_reference: !process.argv.includes("--skip-python"),
      checks,
    },
    null,
    2,
  ),
);
