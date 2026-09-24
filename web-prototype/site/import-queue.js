import { readCandidate } from "./sources.js";

function queueError(code, message) {
  return Object.assign(new Error(message), { code });
}

function errorSummary(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "IMPORT_FAILED",
    message: String(error?.message ?? error),
  };
}

/** One queue owns one client. Observers never determine storage outcomes. */
export class ImportQueue {
  #client;
  #running = false;
  #activeIndex = null;
  #completed = 0;
  #outcomes = [];
  #cancelled = false;
  #importActive = false;
  #cancelPromise = null;
  #runId = 0;

  constructor(client) {
    if (typeof client?.importFile !== "function" || typeof client?.cancel !== "function") {
      throw queueError("INVALID_CLIENT", "The queue requires an importFile/cancel library client.");
    }
    this.#client = client;
  }

  snapshot() {
    return structuredClone({
      running: this.#running, activeIndex: this.#activeIndex,
      completed: this.#completed, total: this.#outcomes.length, outcomes: this.#outcomes,
    });
  }

  cancel() {
    if (!this.#running) return Promise.resolve();
    this.#cancelled = true;
    if (!this.#cancelPromise) {
      const runId = this.#runId;
      // Deferral converts a synchronous client exception into a rejected promise.
      this.#cancelPromise = this.#importActive
        ? Promise.resolve().then(() => {
          if (this.#runId === runId && this.#running && this.#importActive) return this.#client.cancel();
        }) : Promise.resolve();
    }
    return this.#cancelPromise;
  }

  async run(items, { onProgress } = {}) {
    if (this.#running) throw queueError("QUEUE_BUSY", "An import queue is already running.");
    if (!Array.isArray(items) || items.length > 10000 ||
        items.some((item) => !item || typeof item.relativePath !== "string") ||
        (onProgress !== undefined && typeof onProgress !== "function")) {
      throw queueError("INVALID_ITEMS", "Provide at most 10000 inventoried items and an optional progress callback.");
    }
    // Protect inventory metadata against changes by the caller during the run.
    const candidates = items.map((item) => ({ ...item }));
    this.#outcomes = candidates.map(({ relativePath }) => ({ relativePath, status: "pending" }));
    this.#running = true;
    ++this.#runId;
    this.#cancelled = false;
    this.#cancelPromise = null;
    this.#completed = 0;
    const emit = () => {
      if (!onProgress) return;
      const report = (error) => console.error("Import queue progress callback failed:", error);
      try {
        const notification = onProgress(this.snapshot());
        if (notification?.then) Promise.resolve(notification).catch(report);
      } catch (error) { report(error); }
    };
    emit();
    try {
      for (let index = 0; index < candidates.length && !this.#cancelled; ++index) {
        this.#activeIndex = index;
        emit();
        const item = candidates[index];
        const outcome = this.#outcomes[index];
        try {
          const file = await readCandidate(item);
          if (this.#cancelled) throw queueError("CANCELLED", "Cancelled before the import started.");
          this.#importActive = true;
          const result = await this.#client.importFile(file, { relativePath: item.relativePath });
          if (!result?.dataset || typeof result.duplicate !== "boolean") {
            throw queueError("INVALID_RESULT", "The library returned an invalid import result. Reopen the library to verify it.");
          }
          outcome.dataset = structuredClone(result.dataset);
          outcome.status = result.duplicate ? "duplicate" : "ready";
        } catch (error) {
          outcome.error = errorSummary(error);
          outcome.status = outcome.error.code === "CANCELLED" ? "cancelled" : "failed";
        } finally { this.#importActive = false; }
        ++this.#completed;
        this.#activeIndex = null;
        emit();
      }
    } finally {
      this.#running = false;
      this.#activeIndex = null;
    }
    const outcomes = this.snapshot().outcomes;
    emit();
    return outcomes;
  }
}
