const $ = (id) => document.getElementById(id);
const number = (value, digits = 3) =>
  value == null
    ? "—"
    : value.toLocaleString(undefined, {
        maximumSignificantDigits: Math.max(3, digits),
      });
const count = (value) => value.toLocaleString();
const mib = (bytes) => `${number(bytes / 1048576, 4)} MiB`;
let worker;
let lastReport;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function details(target, entries) {
  $(target).replaceChildren(
    ...entries.flatMap(([label, value]) => [
      element("dt", label),
      element("dd", value),
    ]),
  );
}

function setRunning(running) {
  $("scan").disabled = running;
  $("stdf-file").disabled = running;
  $("cancel").disabled = !running;
}

function showError(message) {
  $("status-panel").classList.add("error");
  $("status").textContent = "Scan could not complete";
  $("progress-detail").textContent = message;
  setRunning(false);
}

function render(report) {
  const { result, timing, filename } = report;
  const wallSeconds = timing.wall_ms / 1000;
  $("metrics").replaceChildren(
    ...[
      [
        "Record count",
        count(result.records),
        `${count(result.ptr_count)} scalar PTR records`,
      ],
      [
        "Read + summary scan",
        `${number(wallSeconds, 4)} s`,
        `${number(result.bytes / 1048576 / wallSeconds, 4)} MiB/s · this run`,
      ],
      [
        "Peak WASM memory",
        mib(timing.peak_wasm_bytes),
        `Input slice is an additional ${mib(timing.chunk_bytes)}`,
      ],
      [
        "Test / metadata groups",
        count(result.groups.length),
        "Flags and unit/scale changes preserved",
      ],
    ].map(([label, value, detail]) => {
      const node = element("div", null, "metric");
      node.append(
        element("small", label),
        element("strong", value),
        element("span", detail),
      );
      return node;
    }),
  );
  $("groups").replaceChildren(
    ...result.groups.slice(0, 200).map((group) => {
      const row = element("tr");
      const identity = element("td", group.name || "Unlabeled test");
      identity.append(element("small", `Test ${group.number}`));
      row.append(
        identity,
        ...[
          group.unit || "—",
          count(group.count),
          count(group.valid),
          count(group.excluded),
          number(group.mean_raw, 7),
          number(group.stdev_raw, 6),
          group.result_scale,
          `${number(group.mean_scaled, 7)} ${group.scaled_unit}`,
        ].map((value) => element("td", value)),
      );
      return row;
    }),
  );
  $("group-count").textContent =
    `${Math.min(200, result.groups.length)} of ${count(result.groups.length)} groups shown. Exported JSON includes every group.`;
  details(
    "record-counts",
    Object.entries(result.record_counts).map(([key, value]) => [
      `Record ${key} (type / subtype)`,
      count(value),
    ]),
  );
  details(
    "flag-counts",
    Object.entries(result.flag_counts).map(([key, value]) => [
      key,
      count(value),
    ]),
  );
  details("evidence", [
    ["Source", filename],
    ["Source bytes", count(result.bytes)],
    ["Engine", result.engine],
    ["Endianness", result.byte_order],
    ["Semantic PTR fingerprint (FNV-1a 64)", result.ptr_digest],
    ["WASM parse calls", `${number(timing.parse_ms, 5)} ms`],
    ["Summary serialization", `${number(timing.summary_ms, 5)} ms`],
    ["Worker WASM initialization", `${number(timing.setup_ms, 5)} ms`],
    ["Largest input chunk", mib(result.max_input_bytes)],
    ["Largest carry occupancy", `${count(result.max_pending_bytes)} bytes`],
    ["Carry allocation", `${count(result.carry_capacity)} bytes`],
  ]);
  $("warnings").hidden = result.has_mrr;
  $("warnings").textContent =
    "No MRR end-of-lot record was found. This scan establishes record framing and measurement summaries; it does not establish a complete production test session.";
  $("report").hidden = false;
}

$("file-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const file = $("stdf-file").files[0];
  if (!file || worker) return;
  $("report").hidden = true;
  $("status-panel").classList.remove("error");
  $("status").textContent = `Reading ${file.name}`;
  $("progress-detail").textContent = "Starting the Rust/WASM worker…";
  $("progress").value = 0;
  $("percent").textContent = "0%";
  setRunning(true);
  const activeWorker = new Worker("./worker.js", { type: "module" });
  worker = activeWorker;
  worker.onmessage = ({ data }) => {
    if (worker !== activeWorker) return;
    if (data.type === "progress") {
      const fraction = file.size ? data.progress.bytes / file.size : 0;
      $("progress").value = fraction;
      $("percent").textContent = `${(fraction * 100).toFixed(1)}%`;
      $("progress-detail").textContent =
        `${count(data.progress.records)} records · ${count(data.progress.ptr_count)} PTR measurements · ${mib(data.wasm_bytes)} WASM memory`;
    } else {
      activeWorker.terminate();
      worker = null;
      setRunning(false);
      if (data.type === "error") {
        showError(data.message);
        return;
      }
      lastReport = { ...data, filename: file.name };
      $("status").textContent = "Scan complete";
      $("progress").value = 1;
      $("percent").textContent = "100%";
      $("progress-detail").textContent =
        `${file.name} · ${count(data.result.records)} framed records · the worker has released its memory.`;
      render(lastReport);
    }
  };
  worker.onerror = (error) => {
    if (worker !== activeWorker) return;
    activeWorker.terminate();
    worker = null;
    showError(
      error.message ||
        "Worker could not start. Rebuild the WASM assets and serve this directory over localhost.",
    );
  };
  worker.postMessage({ file });
});

$("cancel").addEventListener("click", () => {
  worker?.terminate();
  worker = null;
  setRunning(false);
  $("status").textContent = "Scan cancelled";
  $("progress-detail").textContent =
    "The worker stopped. No partial result was saved.";
});

$("export").addEventListener("click", () => {
  if (!lastReport) return;
  const blob = new Blob([JSON.stringify(lastReport, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = element("a");
  link.href = url;
  link.download = `${lastReport.filename}.summary.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
