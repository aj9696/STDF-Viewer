// Timings include file reads and summary serialization, excluding WASM initialization.
import { createReadStream, readFileSync } from "node:fs";
import { initSync, Parser } from "../site/pkg/parser.js";
if (!process.argv[2])
  throw new Error("Usage: node web-prototype/scripts/bench.mjs FILE");
initSync({
  module: readFileSync(new URL("../site/pkg/parser_bg.wasm", import.meta.url)),
});
const parser = new Parser();
const started = performance.now();
let parseMs = 0;
let peakWasm = parser.memory_bytes();
try {
  for await (const bytes of createReadStream(process.argv[2], {
    highWaterMark: 4 * 1024 * 1024,
  })) {
    const start = performance.now();
    parser.push(bytes);
    parseMs += performance.now() - start;
    peakWasm = Math.max(peakWasm, parser.memory_bytes());
  }
  const result = JSON.parse(parser.finish());
  peakWasm = Math.max(peakWasm, parser.memory_bytes());
  const wallMs = performance.now() - started;
  console.log(
    JSON.stringify(
      {
        file: process.argv[2],
        bytes: result.bytes,
        records: result.records,
        ptr_count: result.ptr_count,
        ptr_digest: result.ptr_digest,
        groups: result.groups.length,
        wall_ms: wallMs,
        parse_ms: parseMs,
        mib_per_second: result.bytes / 1048576 / (wallMs / 1000),
        peak_wasm_bytes: peakWasm,
        max_pending_bytes: result.max_pending_bytes,
        carry_capacity: result.carry_capacity,
        max_input_bytes: result.max_input_bytes,
        node_peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
      },
      null,
      2,
    ),
  );
} finally {
  parser.free();
}
