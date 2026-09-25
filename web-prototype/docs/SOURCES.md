# File and folder import foundation

This module inventories local sources and runs a sequential import queue. It has
no UI, parser, database, analytics, folder watcher, or upload behavior. Source
handles are used only for reading. The library client owns content hashing,
duplicate detection, snapshot creation, parsing, persistence, and recovery.
The [engineering console](../site/foundation.html) integrates these modules.
Its inventory and outcome tables show the first 100 entries, while a reviewed
queue can contain all eligible entries within the inventory limit.

## Inventory API

```js
import {
  inventoryFiles, inventoryDirectory, readCandidate,
  queryDirectoryPermission, reconnectDirectory,
  saveDirectoryHandle, loadDirectoryHandle, clearDirectoryHandle,
} from "./sources.js";

const inventory = await inventoryDirectory(directoryHandle, {
  includeSubfolders: false,
  maxFiles: 10000,
});
// inventoryFiles(input.files, sameOptions) is synchronous.
```

Both inventory functions return `{ items, skipped }`. An item has
`{ name, relativePath, size, lastModified, file }` for selected files, or the same
metadata with `handle` instead of `file` for directory entries. A skipped entry
has `{ relativePath, code, message }`. Only `.stdf`, `.std`, and `.stf` (case
insensitive) are candidates; empty files, files larger than 2 GiB, unreadable
files, other extensions, and excluded subfolders are reported as skipped.

Paths are relative to the selected directory, use `/`, and preserve case. File
input `webkitRelativePath` includes the chosen directory's name; this first
component is removed. Ordinary selected files use their filenames. Do not mix
different file-input folder roots in one inventory. Absolute paths, empty path
components, `.`/`..`, backslashes, and duplicate relative paths are errors.
Ordering uses JavaScript code-unit comparison, independent of browser locale.
Both items and skipped entries are sorted by relative path.

`includeSubfolders` defaults to false. `maxFiles` is an integer from 1 to 10,000
and bounds **all examined entries**, including rejected files and directories,
to keep traversal and the report bounded. The name reflects the normal file
selection case. Exceeding the limit throws `INVENTORY_LIMIT`; no partial list is
returned. A failed directory enumeration throws `SOURCE_UNREADABLE` rather than
silently presenting a complete inventory. Individual unreadable files can be
skipped without blocking other candidates. Inventory does not read file bytes.

`await readCandidate(item)` reacquires a directory file immediately before
import and returns its `File`. If its name, size, or modification time differs
from the inventory, it throws `SOURCE_CHANGED`; rescan instead of silently
importing a different selection. Selected `File` objects retain browser snapshot
semantics; metadata checks cannot prove the underlying file stayed unchanged.
The importer's own bounded snapshot, stream validation, and content hash remain
necessary. Rescans are explicit, and each produces a new inventory.
Wait for the producing test system to finish writing an STDF before importing.
Metadata checks do not provide an atomic filesystem snapshot or guarantee that
a concurrently rewritten file with the same size/timestamp cannot change.

## Remembering a directory

Use `showDirectoryPicker({ mode: "read" })` from a user action when available;
otherwise use a multiple-file input or `webkitdirectory` input. The module does
not display a picker or request permission automatically.

`saveDirectoryHandle(handle)` stores one directory handle in an IndexedDB
database named `semidata-source-preferences`. `loadDirectoryHandle()` returns
that handle or null; `clearDirectoryHandle()` forgets it. Remembering a handle
does not guarantee permission or continued filesystem access.

`queryDirectoryPermission(handle)` checks read permission without prompting and
returns `granted`, `prompt`, or `denied`. Call `reconnectDirectory(handle)`
**directly from a user gesture** to request read permission. It returns the same
states; it never requests write permission. Do not await unrelated work before
calling reconnect because the gesture may expire. A denied permission is a
normal result to display; an unsupported API or failed request throws an error.
Remembered handles remain specific to the browser profile and origin, separate
from the library's SQLite storage. No filenames or bytes leave the browser.

Folder selection and saved-dataset persistence are independent. A completed
dataset includes an app-managed source snapshot and database; reopening it does
not require renewed access to the original folder. Conversely, saving a folder
handle does not import its files or save a queue. A reload loses selected File
objects, inventory, and queue state. The file-input fallback cannot remember a
directory handle: select its folder again to refresh the browser's File objects.
The console remembers one directory and explicitly checks/reconnects read
permission. It does not start a background watcher or rescan automatically.

## Queue API

```js
import { ImportQueue } from "./import-queue.js";

const queue = new ImportQueue(libraryClient);
const outcomes = await queue.run(inventory.items, {
  onProgress: (snapshot) => renderQueue(snapshot),
});
// From a Cancel button: await queue.cancel();
```

The client must implement `importFile(file, { relativePath })`, resolving to
`{ dataset, duplicate: boolean }`, and `cancel()`, which requests cooperative
cancellation of its active import. The queue processes one item at a time and
continues after per-file errors. Library content hashes decide duplicates;
matching filenames alone never do.

`run()` resolves to ordered outcomes:
`{ relativePath, status, dataset?, error? }`. Status is `pending`, `ready`,
`duplicate`, `failed`, or `cancelled`. Errors are serializable `{ code, message }`.
The active outcome remains `pending`; `activeIndex` identifies it. `snapshot()`
and `onProgress` use `{ running, activeIndex, completed, total, outcomes }`.
Snapshots are detached copies, so consumers cannot change queue state. Dataset
metadata must be structured-cloneable, as it is in the worker client. Progress
is emitted at run start, before each item, after each item, and at run end.
An observer exception is reported through `console.error` and does not cancel
or misreport a successful database import.

`cancel()` stops future items and calls the client's cancellation method only
while an import is active. Items never started remain `pending` so the frontend
can offer a deliberate retry. An active import rejected with `CANCELLED` becomes
`cancelled`; an import that finished before cancellation remains `ready` or
`duplicate`. Failed cancellation requests reject `cancel()` while the queue
still stops subsequent items; they never invent a cancelled dataset state.
Cancelling during source acquisition avoids starting that import and marks it
`cancelled`. Repeated cancellation calls share the first request. A later run
resets cancellation and replaces previous outcomes. Concurrent runs reject with
`QUEUE_BUSY`; individual queue instances must not share a client concurrently.
The queue is session state, not a durable scheduler. The library independently
records import jobs. After a browser stop, inspect those jobs and published
datasets; do not infer outcome from the last displayed queue snapshot. Rescan
and start a new queue deliberately. Successful sources become content duplicates,
and changed content becomes another dataset even if its filename is unchanged.

Public errors expose a stable string `code`; messages are for people. Inventory
validation errors include `INVALID_OPTIONS`, `INVALID_SOURCE`, `INVALID_PATH`,
`DUPLICATE_PATH`, `INVENTORY_LIMIT`, and `SOURCE_UNREADABLE`. Changed candidates
use `SOURCE_CHANGED`. Permission and remembered-handle failures use
`UNSUPPORTED`, `PERMISSION_ERROR`, and `HANDLE_STORAGE_ERROR`. The queue also
uses `INVALID_CLIENT`, `INVALID_ITEMS`, `INVALID_RESULT`, and `IMPORT_FAILED`.

## Verification

Run `node web-prototype/scripts/sources-check.mjs` from the repository root.
The dependency-free Node tests use `File`, mocked read-only handles, and mock
clients. They cover boundaries, deterministic inventories, changes, permission
modes, sequential outcomes, cancellation races, and progress isolation.
Real IndexedDB handle serialization and permission prompts require browser
integration coverage; Node mocks cannot establish browser permission behavior.
`source-browser-check.mjs chrome` and `source-browser-check.mjs msedge` exercise
real OPFS-created directory handles, read permission queries, IndexedDB storage
across a full browser restart, changed-file/rescan behavior, and the console's
actual `webkitdirectory` input. Run them with the same `node web-prototype/scripts/`
prefix after generating the golden fixtures as documented in the README.
They use only disposable profiles and small fixtures. OPFS handles have different
permission behavior from native folders: native picker UI and persistent native
read grants/denials remain separate manual qualifications.
For recorded browser evidence and remaining manual checks, use
[LIBRARY-VALIDATION.md](../LIBRARY-VALIDATION.md). Do not interpret passing
mock-based tests as proof of native folder-picker support in every browser or
the embedded app browser.
