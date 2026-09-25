import { DataLibraryClient } from "./data-client.js";
import { ImportQueue } from "./import-queue.js";
import {
  inventoryFiles, inventoryDirectory, queryDirectoryPermission, reconnectDirectory,
  saveDirectoryHandle, loadDirectoryHandle,
} from "./sources.js";

const $ = (id) => document.getElementById(id);
let library, queue, opened = false, busy = null, cancelling = false;
let source = null, inventory = null, rememberedDirectory = null;
const exports = new Map();
let temporaryExports = [];
const bytes = (value) => Number.isFinite(value) ? `${(value / 1024 ** 2).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB` : "unavailable";
const json = (value) => JSON.stringify(value, null, 2);

function status(title, detail = "", error = false) {
  $("status").textContent = title;
  $("status-detail").textContent = detail;
  $("status-panel").classList.toggle("error", error);
}

function controls() {
  for (const element of document.querySelectorAll("button, input, select")) element.disabled = Boolean(busy);
  const unavailable = Boolean(busy) || !opened;
  $("open-library").disabled = Boolean(busy) || opened;
  for (const id of ["close-library", "refresh-library", "dataset-select", "restore-file", "incomplete-job"]) $(id).disabled = unavailable;
  $("choose-directory").disabled = Boolean(busy) || typeof showDirectoryPicker !== "function";
  $("reconnect-directory").disabled = Boolean(busy) || !rememberedDirectory;
  $("rescan-directory").disabled = Boolean(busy) || source?.kind !== "directory";
  $("persist-library").disabled = Boolean(busy) || !navigator.storage?.persist;
  $("import-files").disabled = unavailable || !inventory?.items.length;
  const noDataset = unavailable || !$("dataset-select").value;
  for (const id of ["inspect-dataset", "verify-dataset", "export-dataset", "read-rows", "row-table"]) $(id).disabled = noDataset;
  $("restore-package").disabled = unavailable || !$("restore-file").files.length;
  $("release-exports").disabled = unavailable || !temporaryExports.length;
  $("discard-job").disabled = unavailable || !$("incomplete-job").value;
  $("cancel-operation").disabled = !busy?.cancellable || cancelling;
}

async function storageStatus() {
  try {
    const estimate = await navigator.storage?.estimate?.();
    const persistent = await navigator.storage?.persisted?.();
    $("storage-status").textContent = `Origin: ${location.origin}. Used: ${bytes(estimate?.usage)}; approximate quota: ${bytes(estimate?.quota)}. Persistence: ${persistent === undefined ? "unavailable" : persistent ? "granted" : "not granted"}.`;
  } catch (error) { $("storage-status").textContent = `Storage estimate unavailable: ${error.message}`; }
}

async function operation(label, work, { cancellable = false, queueRun = false } = {}) {
  if (busy) return;
  busy = { label, cancellable, queueRun };
  cancelling = false;
  $("worker-progress").textContent = "";
  status(label);
  controls();
  try {
    const detail = await work();
    status(`${label} complete`, detail ?? "");
  } catch (error) {
    if (error.name === "AbortError") status("Selection cancelled", "The existing library was not changed.");
    else status(`${label} failed`, `${error.code ?? error.name ?? "ERROR"}: ${error.message}`, true);
  } finally {
    if (opened && !library?.worker) { opened = false; queue = null; }
    if (source && !inventory) $("inventory-summary").textContent = "Inventory unavailable. Correct the source selection and review again before importing.";
    busy = null;
    cancelling = false;
    controls();
    void storageStatus();
  }
}

function drawTable(id, rows, columns = Object.keys(rows[0] ?? {})) {
  const table = $(id);
  table.querySelectorAll("thead, tbody").forEach((element) => element.remove());
  const head = document.createElement("thead"), header = document.createElement("tr");
  for (const key of columns) {
    const cell = document.createElement("th"); cell.scope = "col"; cell.textContent = key; header.append(cell);
  }
  head.append(header);
  const body = document.createElement("tbody");
  for (const row of rows.slice(0, 100)) {
    const line = document.createElement("tr");
    for (const key of columns) {
      const cell = document.createElement("td"), value = row[key];
      cell.textContent = value === null ? "null" : typeof value === "object" ? json(value) : String(value ?? "");
      line.append(cell);
    }
    body.append(line);
  }
  table.append(head, body);
}

function selectOptions(id, items, label, placeholder) {
  const element = $(id), selected = element.value;
  element.replaceChildren(new Option(placeholder, ""));
  for (const item of items) element.add(new Option(label(item), item.id));
  if (items.some((item) => item.id === selected)) element.value = selected;
}

async function refreshLibrary() {
  const datasets = await library.listDatasets({ limit: 100 });
  const jobs = await library.listJobs({ limit: 100 });
  selectOptions("dataset-select", datasets.items, (item) => `${item.name} · ${item.status} · ${item.id.slice(0, 8)}`, "Select a dataset");
  $("dataset-summary").textContent = `${datasets.items.length} datasets shown${datasets.nextOffset !== null && datasets.nextOffset !== undefined ? " (more available through the API)" : ""}. Select one to inspect retained metadata.`;
  drawTable("jobs-table", jobs.items.map((item) => ({
    name: item.name, status: item.status, created: item.created_at,
    error: [item.error_code, item.error_message].filter(Boolean).join(": "), id: item.id,
  })));
  selectOptions("incomplete-job", jobs.items.filter((item) => ["failed", "cancelled", "interrupted"].includes(item.status)), (item) => `${item.name} · ${item.status} · ${item.id.slice(0, 8)}`, "Select an incomplete job");
  $("jobs-summary").textContent = `${jobs.items.length} jobs shown${jobs.nextOffset !== null && jobs.nextOffset !== undefined ? " (more available through the API)" : ""}. Failed or interrupted operations remain visible.`;
  await refreshExports();
}

async function refreshExports() {
  const page = await library.request("listExports", { limit: 100 });
  temporaryExports = page.items;
  drawTable("exports-table", temporaryExports.map((item) => ({
    token: item.exportToken, size: bytes(item.bytes), modified: new Date(item.lastModified).toLocaleString(),
  })));
  $("export-status").textContent = `${temporaryExports.length} temporary packages listed${page.nextOffset !== null && page.nextOffset !== undefined ? " (more remain; refresh after releasing this batch)" : ""}. Includes interrupted exports and prior sessions. Release listed packages only after downloads have finished or are no longer needed.`;
}

async function reviewSources() {
  inventory = null;
  $("inventory-summary").textContent = "Reading source metadata…";
  drawTable("inventory-table", []);
  drawTable("queue-table", []);
  $("queue-summary").textContent = "";
  const options = { includeSubfolders: $("include-subfolders").checked };
  if (source?.kind === "directory") {
    const permission = await queryDirectoryPermission(source.handle);
    if (permission !== "granted") throw Object.assign(new Error("Reconnect this folder before rescanning it."), { code: "PERMISSION_REQUIRED" });
    inventory = await inventoryDirectory(source.handle, options);
  } else if (source?.kind === "files") inventory = inventoryFiles(source.files, options);
  else return "Select source files or a folder first.";
  const totalBytes = inventory.items.reduce((total, item) => total + item.size, 0);
  $("inventory-summary").textContent = `${inventory.items.length} importable files · ${bytes(totalBytes)} total · ${inventory.skipped.length} skipped. Review before starting the queue.`;
  const rows = [
    ...inventory.items.map((item) => ({ path: item.relativePath, status: "candidate", size: bytes(item.size), detail: "" })),
    ...inventory.skipped.map((item) => ({ path: item.relativePath, status: "skipped", size: "", detail: `${item.code}: ${item.message}` })),
  ].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  drawTable("inventory-table", rows, ["path", "status", "size", "detail"]);
  return "Inventory is ready. Importing starts only when you choose Import reviewed files.";
}

function showQueue(snapshot) {
  $("queue-summary").textContent = `${snapshot.completed} of ${snapshot.total} files finished${snapshot.running ? "; queue active" : ""}. Pending files have not started.`;
  drawTable("queue-table", snapshot.outcomes.slice(0, 100).map((item, index) => ({
    path: item.relativePath,
    status: index === snapshot.activeIndex ? "preparing / importing" : item.status,
    dataset: item.dataset?.id ?? "",
    error: item.error ? `${item.error.code}: ${item.error.message}` : "",
  })), ["path", "status", "dataset", "error"]);
}

async function inspectDataset() {
  const dataset = await library.getDataset($("dataset-select").value);
  $("dataset-details").textContent = json(dataset);
  return `Read metadata for ${dataset.name}. The source was not reparsed.`;
}

function workerProgress(progress) {
  $("worker-progress").textContent = `${progress.phase}: ${bytes(progress.completedBytes)} / ${bytes(progress.totalBytes)}${progress.jobId ? ` · job ${progress.jobId}` : ""}`;
}

$("open-library").addEventListener("click", () => operation("Open library", async () => {
  library = new DataLibraryClient({ onProgress: workerProgress });
  const runtime = await library.open();
  opened = true;
  queue = new ImportQueue(library);
  $("runtime-details").textContent = json(runtime);
  await refreshLibrary();
  return "Local library opened. Completed datasets can be reopened without selecting the original sources.";
}));

$("close-library").addEventListener("click", () => operation("Close library", async () => {
  await library.close();
  opened = false;
  queue = null;
  $("runtime-details").textContent = "Library closed. Saved data remains in this browser profile.";
  return "Storage ownership released. Use Open library to reopen.";
}));

$("refresh-library").addEventListener("click", () => operation("Refresh library", async () => {
  await refreshLibrary(); return "Dataset and job lists refreshed.";
}));

$("persist-library").addEventListener("click", () => operation("Request persistence", async () => {
  const granted = await navigator.storage.persist();
  return granted ? "The browser granted persistent storage. Keep exports for recovery." : "The browser did not grant persistence. Keep exported packages; stored data remains best-effort.";
}));

for (const id of ["source-files", "directory-files"]) {
  $(id).addEventListener("change", () => {
    if (!$(id).files.length) return;
    source = { kind: "files", files: Array.from($(id).files) };
    $("source-description").textContent = `${source.files.length} selected files. Select them again to refresh browser File snapshots.`;
    void operation("Review sources", reviewSources);
  });
}

$("choose-directory").addEventListener("click", () => operation("Choose source folder", async () => {
  // The picker is the first awaited operation, retaining the click gesture.
  const handle = await showDirectoryPicker({ mode: "read" });
  source = { kind: "directory", handle };
  rememberedDirectory = handle;
  $("source-description").textContent = `Source folder: ${handle.name}. Read-only access; changes appear only after an explicit rescan.`;
  try {
    await saveDirectoryHandle(handle);
    $("folder-status").textContent = "Folder handle remembered. Future sessions may need read permission again.";
  } catch (error) { $("folder-status").textContent = `Folder selected but could not be remembered: ${error.message}`; }
  return reviewSources();
}));

$("reconnect-directory").addEventListener("click", () => operation("Reconnect folder", async () => {
  // Permission is requested directly from the button event, without prior I/O.
  const state = await reconnectDirectory(rememberedDirectory);
  if (state !== "granted") throw Object.assign(new Error("Read permission was not granted. Choose a folder or use the file-input fallback."), { code: "PERMISSION_DENIED" });
  source = { kind: "directory", handle: rememberedDirectory };
  $("source-description").textContent = `Source folder: ${rememberedDirectory.name}. Read-only access; rescan to see changes.`;
  $("folder-status").textContent = "Read permission granted for the remembered folder.";
  return reviewSources();
}));

$("rescan-directory").addEventListener("click", () => operation("Rescan folder", reviewSources));
$("include-subfolders").addEventListener("change", () => {
  if (source) void operation("Review subfolder selection", reviewSources);
});

$("import-files").addEventListener("click", () => operation("Import queue", async () => {
  const outcomes = await queue.run(inventory.items, { onProgress: showQueue });
  busy.cancellable = false;
  controls();
  await refreshLibrary();
  const totals = Object.entries(outcomes.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1; return counts;
  }, {})).map(([key, count]) => `${count} ${key}`).join(" · ");
  return `${totals}. Select a dataset to inspect its retained records.`;
}, { cancellable: true, queueRun: true }));

$("cancel-operation").addEventListener("click", async () => {
  if (!busy?.cancellable || cancelling) return;
  cancelling = true;
  $("status-detail").textContent = "Cancellation requested. Waiting for the current bounded operation to settle; completed datasets are retained.";
  controls();
  try { await (busy.queueRun ? queue.cancel() : library.cancel()); }
  catch (error) { status("Cancellation request failed", error.message, true); }
  // The original operation owns the final status and unlocks controls.
});

$("dataset-select").addEventListener("change", () => {
  $("dataset-details").textContent = "No dataset selected.";
  $("rows-summary").textContent = "Choose a retained table and read its first 100 rows.";
  drawTable("rows-table", []);
  controls();
  if ($("dataset-select").value) void operation("Read dataset metadata", inspectDataset);
});
$("inspect-dataset").addEventListener("click", () => operation("Read dataset metadata", inspectDataset));
$("verify-dataset").addEventListener("click", () => operation("Verify dataset", async () => {
  const result = await library.verifyDataset($("dataset-select").value);
  return json(result);
}, { cancellable: true }));
$("row-table").addEventListener("change", () => {
  drawTable("rows-table", []);
  $("rows-summary").textContent = "Table selection changed. Read its first 100 rows to refresh the preview.";
});
$("read-rows").addEventListener("click", () => operation("Read retained rows", async () => {
  const table = $("row-table").value;
  const page = await library.readRows($("dataset-select").value, table, { limit: 100 });
  drawTable("rows-table", page.items);
  $("rows-summary").textContent = `${page.items.length} ${table} rows shown${page.nextAfter !== null && page.nextAfter !== undefined ? "; more rows are available through the API" : ""}. No analytical defaults or retest consolidation applied.`;
  return "Read saved rows from the database without reparsing the source.";
}));

$("export-dataset").addEventListener("click", () => operation("Export dataset", async () => {
  const result = await library.exportDataset($("dataset-select").value);
  const url = URL.createObjectURL(result.file);
  const link = document.createElement("a");
  link.href = url;
  link.download = result.filename;
  link.textContent = `Download ${result.filename} (${bytes(result.bytes)})`;
  $("download-links").append(link);
  exports.set(result.exportToken, { url, link });
  busy.cancellable = false;
  controls();
  await refreshExports();
  return "Package ready. Use its download link below to save it. Temporary storage is retained until you explicitly release it.";
}, { cancellable: true }));

$("release-exports").addEventListener("click", () => operation("Release completed downloads", async () => {
  try {
    for (const { exportToken } of temporaryExports) {
      await library.request("releaseExport", { exportToken });
      const entry = exports.get(exportToken);
      if (entry) { URL.revokeObjectURL(entry.url); entry.link.remove(); exports.delete(exportToken); }
    }
  } finally {
    if (library.worker) await refreshExports();
  }
  return "Temporary export packages released. Completed datasets remain available for another export.";
}));

$("restore-file").addEventListener("change", controls);
$("restore-package").addEventListener("click", () => operation("Restore package", async () => {
  const result = await library.restorePackage($("restore-file").files[0]);
  busy.cancellable = false;
  controls();
  await refreshLibrary();
  if (!Array.from($("dataset-select").options).some((option) => option.value === result.dataset.id)) {
    $("dataset-select").add(new Option(`${result.dataset.name} · ${result.dataset.status} · ${result.dataset.id.slice(0, 8)}`, result.dataset.id));
  }
  $("dataset-select").value = result.dataset.id;
  $("dataset-details").textContent = json(result.dataset);
  drawTable("rows-table", []);
  $("rows-summary").textContent = "Restored dataset selected. Read a table to inspect retained rows.";
  return result.duplicate ? "This exact dataset already exists; its saved copy was reused." : "Package verified and restored. Original source selections were not modified.";
}, { cancellable: true }));

$("incomplete-job").addEventListener("change", controls);
$("discard-job").addEventListener("click", () => operation("Discard incomplete staging", async () => {
  await library.request("discardJob", { jobId: $("incomplete-job").value });
  await refreshLibrary();
  return "Only the selected incomplete job's staging was discarded. Its history and completed datasets remain.";
}));

window.addEventListener("pagehide", () => {
  library?.terminate();
  opened = false;
  queue = null;
  for (const entry of exports.values()) URL.revokeObjectURL(entry.url);
  // No automatic export release: the browser may still be saving a download.
});
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  for (const entry of exports.values()) entry.link.remove();
  exports.clear();
  controls();
  status("Reopen the library", "This page was restored after leaving it. Reopen to inspect datasets and interrupted jobs. Temporary export files remain retained.");
});

controls();
void storageStatus();
void (async () => {
  try {
    const saved = await loadDirectoryHandle();
    if (!saved || rememberedDirectory || source?.kind === "directory") return;
    rememberedDirectory = saved;
    const permission = await queryDirectoryPermission(saved);
    $("folder-status").textContent = `Remembered folder: ${saved.name}. Read permission: ${permission}. Use Reconnect remembered folder to review it.`;
  } catch (error) { $("folder-status").textContent = `Remembered folder unavailable: ${error.message}`; }
  finally { controls(); }
})();
