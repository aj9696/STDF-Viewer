export const MAX_SOURCE_BYTES = 2 * 1024 ** 3;
const MAX_ENTRIES = 10000;
const RAW_EXTENSION = /\.(stdf|std|stf|gz|bz2|zip)$/i;

function sourceError(code, message) {
  return Object.assign(new Error(message), { code });
}

function optionsFor(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw sourceError("INVALID_OPTIONS", "Expected an inventory options object.");
  }
  const { includeSubfolders = false, maxFiles = MAX_ENTRIES } = options;
  if (typeof includeSubfolders !== "boolean" || !Number.isInteger(maxFiles) ||
      maxFiles < 1 || maxFiles > MAX_ENTRIES) {
    throw sourceError("INVALID_OPTIONS", "Use a boolean subfolder policy and maxFiles from 1 to 10000.");
  }
  return { includeSubfolders, maxFiles };
}

function checkPath(path) {
  if (typeof path !== "string" || /[\\\0]/.test(path) ||
      path.split("/").some((part) => !part || part === "." || part === "..") ||
      /^[A-Za-z]:/.test(path)) {
    throw sourceError("INVALID_PATH", "Source paths must be safe relative paths using '/'.");
  }
  return path;
}

function fileMetadata(file) {
  if (!file || typeof file.name !== "string" || typeof file.slice !== "function" ||
      !Number.isSafeInteger(file.size) || file.size < 0 ||
      !Number.isSafeInteger(file.lastModified) || file.lastModified < 0) {
    throw sourceError("INVALID_SOURCE", "Expected a File with valid name, size, and modification time.");
  }
  checkPath(file.name);
  if (file.name.includes("/")) throw sourceError("INVALID_PATH", "A filename cannot contain path separators.");
  return { name: file.name, size: file.size, lastModified: file.lastModified };
}

function collector(maxFiles) {
  const items = [], skipped = [], paths = new Set();
  let examined = 0;
  return {
    visit(path) {
      if (++examined > maxFiles) {
        throw sourceError("INVENTORY_LIMIT", `Inventory exceeds the ${maxFiles}-entry limit. Select a smaller folder.`);
      }
      checkPath(path);
      if (paths.has(path)) throw sourceError("DUPLICATE_PATH", `More than one source uses '${path}'.`);
      paths.add(path);
    },
    skip(relativePath, code, message) { skipped.push({ relativePath, code, message }); },
    add(file, relativePath, reference) {
      const metadata = fileMetadata(file);
      if (metadata.name !== relativePath.split("/").at(-1)) {
        throw sourceError("INVALID_PATH", "The relative path does not match the source filename.");
      }
      if (!metadata.size) this.skip(relativePath, "EMPTY_FILE", "Empty files cannot be imported.");
      else if (metadata.size > MAX_SOURCE_BYTES) {
        this.skip(relativePath, "FILE_TOO_LARGE", "The current import limit is 2 GiB per source.");
      } else items.push({ ...metadata, relativePath, ...reference });
    },
    result() {
      const compare = (a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0;
      return { items: items.sort(compare), skipped: skipped.sort(compare) };
    },
  };
}

/** Inspect metadata only; file-input paths are relative to its selected root. */
export function inventoryFiles(files, options = {}) {
  const { includeSubfolders, maxFiles } = optionsFor(options);
  if (!files || typeof files[Symbol.iterator] !== "function") {
    throw sourceError("INVALID_SOURCE", "Expected an iterable of selected files.");
  }
  const result = collector(maxFiles);
  let selectedRoot;
  for (const file of files) {
    fileMetadata(file);
    let relativePath = file.name;
    if (file.webkitRelativePath) {
      const parts = checkPath(file.webkitRelativePath).split("/");
      if (parts.length < 2 || (selectedRoot && selectedRoot !== parts[0])) {
        throw sourceError("INVALID_PATH", "Use files from one selected directory root per inventory.");
      }
      selectedRoot = parts.shift();
      relativePath = parts.join("/");
    }
    result.visit(relativePath);
    if (!includeSubfolders && relativePath.includes("/")) {
      result.skip(relativePath, "SUBFOLDER_EXCLUDED", "Enable subfolders to include this source.");
    } else if (!RAW_EXTENSION.test(relativePath)) {
      result.skip(relativePath, "UNSUPPORTED_EXTENSION", "Select STDF, gzip, bzip2, or single-file ZIP.");
    } else result.add(file, relativePath, { file });
  }
  return result.result();
}

function checkDirectory(handle) {
  if (handle?.kind !== "directory") throw sourceError("INVALID_SOURCE", "Expected a directory handle.");
}

/** Read-only traversal, with an entry budget including directories and skips. */
export async function inventoryDirectory(handle, options = {}) {
  checkDirectory(handle);
  const { includeSubfolders, maxFiles } = optionsFor(options);
  const result = collector(maxFiles);
  const directories = [{ handle, prefix: "" }];
  while (directories.length) {
    const directory = directories.pop();
    try {
      for await (const entry of directory.handle.values()) {
        checkPath(entry.name);
        if (entry.name.includes("/")) throw sourceError("INVALID_PATH", "An entry name cannot contain path separators.");
        const relativePath = directory.prefix + entry.name;
        result.visit(relativePath);
        if (entry.kind === "directory") {
          if (includeSubfolders) directories.push({ handle: entry, prefix: relativePath + "/" });
          else result.skip(relativePath, "SUBFOLDER_EXCLUDED", "Enable subfolders to include this directory.");
        } else if (entry.kind !== "file") {
          result.skip(relativePath, "INVALID_SOURCE", "Unsupported filesystem entry.");
        } else if (!RAW_EXTENSION.test(entry.name)) {
          result.skip(relativePath, "UNSUPPORTED_EXTENSION", "Select STDF, gzip, bzip2, or single-file ZIP.");
        } else {
          let file;
          try { file = await entry.getFile(); }
          catch (error) {
            result.skip(relativePath, "SOURCE_UNREADABLE", String(error?.message ?? error));
            continue;
          }
          result.add(file, relativePath, { handle: entry });
        }
      }
    } catch (error) {
      if (typeof error?.code === "string") throw error;
      throw sourceError("SOURCE_UNREADABLE", `Could not finish reading '${directory.prefix || "."}': ${error?.message ?? error}`);
    }
  }
  return result.result();
}

export async function readCandidate(item) {
  if (!item || !Number.isSafeInteger(item.size) || !Number.isSafeInteger(item.lastModified)) {
    throw sourceError("INVALID_SOURCE", "Expected an inventoried source.");
  }
  checkPath(item.relativePath);
  let file;
  try { file = item.handle ? await item.handle.getFile() : item.file; }
  catch (error) { throw sourceError("SOURCE_UNREADABLE", String(error?.message ?? error)); }
  const metadata = fileMetadata(file);
  if (metadata.name !== item.name || metadata.size !== item.size || metadata.lastModified !== item.lastModified) {
    throw sourceError("SOURCE_CHANGED", `Source '${item.relativePath}' changed. Rescan before importing.`);
  }
  if (!RAW_EXTENSION.test(item.name) || !metadata.size || metadata.size > MAX_SOURCE_BYTES) {
    throw sourceError("INVALID_SOURCE", "Candidate is outside the raw STDF source limits.");
  }
  return file;
}

async function directoryPermission(handle, method) {
  checkDirectory(handle);
  if (typeof handle[method] !== "function") {
    throw sourceError("UNSUPPORTED", "This browser cannot reconnect saved directory handles.");
  }
  let state;
  try { state = await handle[method]({ mode: "read" }); }
  catch (error) { throw sourceError("PERMISSION_ERROR", String(error?.message ?? error)); }
  if (!["granted", "prompt", "denied"].includes(state)) {
    throw sourceError("PERMISSION_ERROR", "The browser returned an unknown permission state.");
  }
  return state;
}

export function queryDirectoryPermission(handle) {
  return directoryPermission(handle, "queryPermission");
}

/** Invoke directly in a click handler: only this function can prompt. */
export function reconnectDirectory(handle) {
  return directoryPermission(handle, "requestPermission");
}

function openHandleDatabase() {
  if (!globalThis.indexedDB) {
    return Promise.reject(sourceError("UNSUPPORTED", "This browser cannot remember directory handles."));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open("semidata-source-preferences", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("handles");
    request.onblocked = () => {
      settled = true;
      reject(sourceError("HANDLE_STORAGE_ERROR", "Close other tabs to update remembered folder storage."));
    };
    request.onerror = () => reject(sourceError("HANDLE_STORAGE_ERROR", request.error?.message ?? "Could not open remembered folder storage."));
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function storedHandle(mode, operation) {
  let db;
  try {
    db = await openHandleDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("handles", mode);
      const request = operation(transaction.objectStore("handles"));
      transaction.oncomplete = () => resolve(request.result ?? null);
      transaction.onabort = () => reject(transaction.error ?? sourceError("HANDLE_STORAGE_ERROR", "Remembered folder transaction aborted."));
      transaction.onerror = () => {}; // Abort reports failure; success waits for commit.
    });
  } catch (error) {
    if (typeof error?.code === "string") throw error;
    throw sourceError("HANDLE_STORAGE_ERROR", String(error?.message ?? error));
  } finally { db?.close(); }
}

export function saveDirectoryHandle(handle) {
  checkDirectory(handle);
  return storedHandle("readwrite", (store) => store.put(handle, "last-directory"));
}

export function loadDirectoryHandle() {
  return storedHandle("readonly", (store) => store.get("last-directory"));
}

export function clearDirectoryHandle() {
  return storedHandle("readwrite", (store) => store.delete("last-directory"));
}
