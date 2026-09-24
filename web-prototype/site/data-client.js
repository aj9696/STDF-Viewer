import { libraryError } from "./dataset-schema.js";

/** Public frontend adapter. All data work happens in one dedicated owner worker. */
export class DataLibraryClient {
  constructor({ onProgress = () => {} } = {}) {
    this.onProgress = onProgress;
    this.nextId = 1;
    this.worker = null;
    this.pending = null;
  }
  start() {
    this.worker = new Worker(new URL("./data-worker.js", import.meta.url), { type: "module" });
    this.worker.onmessage = ({ data }) => {
      if (data?.version !== 1) return this.terminate(libraryError("PROTOCOL_ERROR", "Unsupported worker response."));
      const pending = this.pending;
      if (!pending || pending.id !== data.id) return;
      if (data.type === "progress") {
        try { this.onProgress(data.progress); } catch { /* A UI callback cannot interrupt a commit. */ }
        return;
      }
      this.pending = null;
      if (data.ok) pending.resolve(data.result);
      else pending.reject(libraryError(data.error?.code ?? "STORAGE_ERROR", data.error?.message ?? "Library operation failed."));
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.terminate(libraryError("WORKER_STOPPED", event.message || "Library worker stopped. Reopen and inspect jobs before retrying."));
    };
    this.worker.onmessageerror = () => this.terminate(libraryError("PROTOCOL_ERROR", "Worker response could not be read."));
  }
  request(type, payload = {}) {
    if (!this.worker) return Promise.reject(libraryError("NOT_OPEN", "Open the library first."));
    if (this.pending) return Promise.reject(libraryError("BUSY", "The library is processing another operation."));
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject };
      try { this.worker.postMessage({ ...payload, version: 1, id, type }); }
      catch (error) { this.pending = null; reject(error); }
    });
    if (this.pending) this.pending.promise = promise;
    return promise;
  }
  async open() {
    if (!this.worker) this.start();
    try { return await this.request("open"); }
    catch (error) { this.terminate(); throw error; }
  }
  async close() {
    if (!this.worker) return { closed: true };
    try { return await this.request("close"); }
    finally { this.terminate(); }
  }
  terminate(error = libraryError("WORKER_STOPPED", "Worker terminated. Reopen to check publication status before retrying.")) {
    this.worker?.terminate(); this.worker = null;
    this.pending?.reject(error); this.pending = null;
  }
  cancel() {
    this.worker?.postMessage({ version: 1, type: "cancel" });
    return this.pending?.promise?.then(() => undefined, () => undefined) ?? Promise.resolve();
  }
  listDatasets(options = {}) { return this.request("listDatasets", options); }
  listJobs(options = {}) { return this.request("listJobs", options); }
  getDataset(datasetId) { return this.request("getDataset", { datasetId }); }
  readRows(datasetId, table, options = {}) { return this.request("readRows", { datasetId, table, ...options }); }
  readRecord(datasetId, seq) { return this.request("readRecord", { datasetId, seq }); }
  verifyDataset(datasetId) { return this.request("verifyDataset", { datasetId }); }
  importFile(file, { relativePath = file.name } = {}) { return this.request("importFile", { file, relativePath }); }
  exportDataset(datasetId) { return this.request("exportDataset", { datasetId }); }
  restorePackage(file) { return this.request("restorePackage", { file }); }
}
