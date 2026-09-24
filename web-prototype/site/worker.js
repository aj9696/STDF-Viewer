import init, { Parser } from "./pkg/parser.js";

const CHUNK_BYTES = 4 * 1024 * 1024;

// One worker per file; termination cancels immediately and releases WASM memory.
self.onmessage = async ({ data: { file } }) => {
  let parser;
  try {
    const setupStart = performance.now();
    await init();
    const setupMs = performance.now() - setupStart;
    parser = new Parser();
    const started = performance.now();
    let parseMs = 0;
    let peakMemory = parser.memory_bytes();
    let lastProgress = 0;
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      // Only a single bounded slice is materialized; no file.arrayBuffer().
      const bytes = new Uint8Array(
        await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer(),
      );
      const parseStarted = performance.now();
      parser.push(bytes);
      parseMs += performance.now() - parseStarted;
      peakMemory = Math.max(peakMemory, parser.memory_bytes());
      if (performance.now() - lastProgress > 100) {
        self.postMessage({
          type: "progress",
          progress: JSON.parse(parser.progress()),
          elapsed_ms: performance.now() - started,
          wasm_bytes: peakMemory,
        });
        lastProgress = performance.now();
      }
    }
    const finishStarted = performance.now();
    const result = JSON.parse(parser.finish());
    const finishMs = performance.now() - finishStarted;
    peakMemory = Math.max(peakMemory, parser.memory_bytes());
    self.postMessage({
      type: "complete",
      result,
      timing: {
        setup_ms: setupMs,
        parse_ms: parseMs,
        summary_ms: finishMs,
        wall_ms: performance.now() - started,
        peak_wasm_bytes: peakMemory,
        chunk_bytes: CHUNK_BYTES,
      },
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: String(error?.message ?? error),
    });
  } finally {
    parser?.free();
  }
};
