import { LibraryStore } from "./library-store.js";
import { libraryError } from "./dataset-schema.js";

const store = new LibraryStore();
let active = null;

async function dispatch(message, context) {
  if (message.type === "open") return store.open();
  if (message.type === "close") return store.close();
  if (!store.catalog) throw libraryError("NOT_OPEN", "Open the library first.");
  if (message.type === "listDatasets") return store.list("datasets", message);
  if (message.type === "listJobs") return store.list("jobs", message);
  if (message.type === "getDataset") {
    const opened = await store.access(message.datasetId);
    try { return store.present(opened.dataset); } finally { opened.db.close(); }
  }
  if (message.type === "viewer") {
    const { runViewerQuery } = await import("./viewer-queries.js");
    return runViewerQuery(store, message, context);
  }
  if (message.type === 'viewerTransfer') {
    const { runViewerTransfer } = await import('./viewer-transfer.js');
    return runViewerTransfer(store, message, context);
  }
  if (message.type === 'viewerReport') {
    const { runViewerReport } = await import('./viewer-report.js');
    return runViewerReport(store, message, context);
  }
  if (message.type === 'viewerAuthoring') {
    const { runViewerAuthoring } = await import('./viewer-authoring.js');
    return runViewerAuthoring(store, message, context);
  }
  if (message.type === 'viewerDownloads') {
    const { runViewerDownloads } = await import('./viewer-downloads.js');
    return runViewerDownloads(message, context);
  }
  if (["listTests", "getTest", "readTestDefinitions", "readTestMeasurements"].includes(message.type)) {
    const { runTestQuery } = await import("./test-queries.js");
    return runTestQuery(store, message);
  }
  const { runOperation } = await import("./library-operations.js");
  return runOperation(store, message, context);
}

self.onmessage = async ({ data }) => {
  if (data?.version === 1 && data.type === "cancel") {
    if (active) active.cancelled = true;
    return;
  }
  const id = data?.id;
  const sendError = (error) => self.postMessage({ version: 1, id, ok: false,
    error: { code: typeof error.code === "string" ? error.code : "STORAGE_ERROR", message: String(error.message ?? error) } });
  if (data?.version !== 1 || !Number.isSafeInteger(id) || id < 1 || typeof data.type !== "string") {
    return sendError(libraryError("INVALID_REQUEST", "Invalid library request or protocol version."));
  }
  if (active) return sendError(libraryError("BUSY", "Another library operation is running."));
  let progressTime = 0, progressPhase = "";
  const context = { cancelled: false, checkCancelled() {
    if (this.cancelled) throw libraryError("CANCELLED", "Operation cancelled; completed datasets were preserved.");
  }, progress(progress) {
    const now = performance.now();
    if (progress.phase !== progressPhase || now - progressTime >= 100 || progress.completedBytes === progress.totalBytes) {
      self.postMessage({ version: 1, id, type: "progress", progress });
      progressTime = now; progressPhase = progress.phase;
    }
  } };
  active = context;
  try {
    const result = await dispatch(data, context);
    self.postMessage({ version: 1, id, ok: true, result });
  } catch (error) { sendError(error); }
  finally { active = null; }
};
