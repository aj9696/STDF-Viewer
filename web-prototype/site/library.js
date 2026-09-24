const VERSION = 1;
const MAX_BACKUP_BYTES = 1048576;

function storageError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** One worker owner and one request in flight. Discard after close/failed open. */
export class StorageProofClient {
  constructor() {
    this.worker = new Worker(new URL("./storage-worker.js", import.meta.url), {
      type: "module",
    });
    this.nextId = 1;
    this.pending = null;
    this.worker.onmessage = ({ data }) => {
      const pending = this.pending;
      if (!pending) return;
      if (
        data?.version !== VERSION ||
        data.id !== pending.id ||
        typeof data.ok !== "boolean" ||
        (!data.ok &&
          (typeof data.error?.code !== "string" ||
            typeof data.error?.message !== "string"))
      ) {
        this.terminate(storageError("STORAGE_ERROR", "Invalid storage worker response."));
        return;
      }
      clearTimeout(pending.timer);
      this.pending = null;
      if (pending.type === "close" || (pending.type === "open" && !data.ok)) {
        this.terminate();
      }
      if (data.ok) pending.resolve(data.result);
      else pending.reject(storageError(data.error.code, data.error.message));
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.terminate(storageError(
        "STORAGE_ERROR",
        event.message || "Storage worker could not start. Check the local SQLite build.",
      ));
    };
    this.worker.onmessageerror = () => {
      this.terminate(storageError("STORAGE_ERROR", "Storage worker response could not be read."));
    };
  }

  request(type, payload = {}) {
    if (!this.worker) {
      return Promise.reject(storageError("NOT_OPEN", "Create a new client to reopen storage."));
    }
    if (this.pending) {
      return Promise.reject(storageError("BUSY", "Another storage request is still running."));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.terminate(storageError(
          "STORAGE_ERROR",
          "Storage request timed out. Reopen to verify the stored value before retrying a write.",
        ));
      }, 30000);
      this.pending = { id, type, resolve, reject, timer };
      try {
        const transfer = type === "restore" && payload.bytes instanceof ArrayBuffer
          ? [payload.bytes]
          : [];
        this.worker.postMessage({ ...payload, version: VERSION, id, type }, transfer);
      } catch (error) {
        this.terminate(storageError("STORAGE_ERROR", String(error?.message ?? error)));
      }
    });
  }

  terminate(error = storageError("NOT_OPEN", "Storage worker closed before the request completed.")) {
    this.worker?.terminate();
    this.worker = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = null;
    }
  }
}

function startStorageLab() {
  const $ = (id) => document.getElementById(id);
  let client = null;
  let busy = false;
  let opened = false;
  const supported = globalThis.isSecureContext && typeof Worker === "function" &&
    navigator.locks?.request && navigator.storage?.getDirectory;

  function buttons() {
    $("open-storage").disabled = !supported || busy || opened;
    for (const id of ["save-note", "read-storage", "close-storage", "export-storage", "probe-note", "backup-file"]) {
      $(id).disabled = busy || !opened;
    }
    $("restore-storage").disabled = busy || !opened || !$("backup-file").files.length;
    $("persist-storage").disabled = busy || !navigator.storage?.persist;
  }

  function status(title, message, error = false) {
    $("status").textContent = title;
    $("status-detail").textContent = message;
    $("status-panel").classList.toggle("error", error);
  }

  function details(id, entries) {
    $(id).replaceChildren(...entries.flatMap(([label, value]) => {
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value ?? "Unavailable";
      return [term, description];
    }));
  }

  const bytes = (value) => Number.isFinite(value)
    ? `${value.toLocaleString()} bytes`
    : "Unavailable";

  async function storageStatus() {
    const [estimate, persisted] = await Promise.allSettled([
      navigator.storage?.estimate?.(),
      navigator.storage?.persisted?.(),
    ]);
    const capacity = estimate.status === "fulfilled" ? estimate.value : null;
    const retained = persisted.status === "fulfilled" ? persisted.value : undefined;
    details("storage-evidence", [
      ["Application origin", location.origin],
      ["Persistence granted", typeof retained === "boolean" ? (retained ? "Yes" : "No — best effort") : "Unavailable"],
      ["Estimated origin usage", bytes(capacity?.usage)],
      ["Estimated origin quota", bytes(capacity?.quota)],
    ]);
  }

  function render(result) {
    $("stored-note").textContent = result.row?.note ?? "No note saved yet.";
    $("saved-at").textContent = result.row?.saved_at ?? "—";
    if (result.row) $("probe-note").value = result.row.note;
    details("runtime-evidence", [
      ["SQLite release", result.sqliteVersion],
      ["Storage VFS", result.vfs],
      ["SQLite WASM memory", bytes(result.wasmMemoryBytes)],
      ["Pool capacity / files", `${result.poolCapacity} / ${result.poolFiles}`],
      ["Database page size / count", `${result.pageSize} / ${result.pageCount}`],
    ]);
    $("stored-result").hidden = false;
  }

  async function run(title, action) {
    if (busy) return;
    busy = true;
    buttons();
    status(title, "Working locally in this browser…");
    try {
      await action();
    } catch (error) {
      if (!client?.worker) {
        opened = false;
        client = null;
      }
      status("Storage operation did not complete", `${error.code ?? "STORAGE_ERROR"}: ${error.message ?? error}`, true);
    } finally {
      await storageStatus();
      busy = false;
      buttons();
    }
  }

  $("open-storage").addEventListener("click", () => run("Opening local storage", async () => {
    client?.terminate();
    client = new StorageProofClient();
    render(await client.request("open"));
    opened = true;
    status("Storage open", "Save a note, close storage, then reopen it to check persistence.");
  }));

  $("note-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!opened) return;
    run("Saving probe note", async () => {
      render(await client.request("write", { note: $("probe-note").value }));
      status("Note saved", "The worker committed this synthetic probe to local SQLite storage.");
    });
  });

  $("read-storage").addEventListener("click", () => run("Verifying stored note", async () => {
    render(await client.request("read"));
    status("Stored note verified", "The worker checked the database and read the saved row.");
  }));

  $("close-storage").addEventListener("click", () => run("Closing storage", async () => {
    try {
      await client.request("close");
      status("Storage closed", "The worker released ownership. Reopen here or reload the page to check the saved note.");
    } finally {
      client?.terminate();
      client = null;
      opened = false;
      $("stored-result").hidden = true;
    }
  }));

  $("export-storage").addEventListener("click", () => run("Exporting probe backup", async () => {
    const result = await client.request("export");
    if (!(result.bytes instanceof ArrayBuffer) || !result.bytes.byteLength || result.bytes.byteLength > MAX_BACKUP_BYTES) {
      throw storageError("INVALID_BACKUP", "The worker returned an invalid probe backup.");
    }
    const url = URL.createObjectURL(new Blob([result.bytes], { type: "application/vnd.sqlite3" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "semidata-storage-probe.sqlite3";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status("Probe backup prepared", "The browser was asked to download the small SQLite file. Check your downloads before relying on it.");
  }));

  $("backup-file").addEventListener("change", buttons);
  $("restore-storage").addEventListener("click", () => run("Restoring probe backup", async () => {
    const file = $("backup-file").files[0];
    if (!file || !file.size || file.size > MAX_BACKUP_BYTES) {
      throw storageError("INVALID_BACKUP", "Choose a nonempty probe backup no larger than 1 MiB.");
    }
    render(await client.request("restore", { bytes: await file.arrayBuffer() }));
    $("backup-file").value = "";
    status("Probe restored", "The validated backup replaced the synthetic note in this library.");
  }));

  $("persist-storage").addEventListener("click", () => run("Requesting persistent storage", async () => {
    const granted = await navigator.storage.persist();
    status(granted ? "Persistence granted" : "Persistence was not granted", granted
      ? "The browser granted persistence. Clearing site data can still remove this library; keep an export."
      : "Storage remains best effort. The browser controls this decision; keep an export.");
  }));

  addEventListener("pagehide", () => {
    client?.terminate();
    client = null;
    opened = false;
    $("stored-result").hidden = true;
    buttons();
  });
  addEventListener("pageshow", (event) => {
    if (event.persisted) {
      status("Storage closed", "Reopen storage after returning to this page.");
      buttons();
    }
  });

  if (!supported) {
    status("Persistent storage is unavailable", "This experiment needs a secure context, dedicated workers, Web Locks, and OPFS. Try the documented desktop browser on localhost or HTTPS.", true);
  }
  buttons();
  void storageStatus();
}

if (typeof document !== "undefined" && document.getElementById("storage-proof")) {
  startStorageLab();
}
