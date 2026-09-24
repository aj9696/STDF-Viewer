# Browser library frontend contract

Version 1, 2026-09-24. This is the logistics boundary for the future frontend.
It contains no yield, PAT, limits/default interpretation, or retest policy.
Use the adapter rather than accessing OPFS, SQL, or the worker directly.

## Entry point

```js
import { DataLibraryClient } from "../site/data-client.js";
const library = new DataLibraryClient({ onProgress: renderProgress });
await library.open();
const result = await library.importFile(file, { relativePath: file.name });
const page = await library.listDatasets({ limit: 50 });
await library.close();
```

The example paths are relative to this document; application modules use
`./data-client.js`. One request runs at a time. A second concurrent request
rejects BUSY. A separate tab rejects BUSY until the owner closes or terminates.
The storage proof at `storage.html` uses an independent pool and lock.

## Methods

| Method | Result / behavior |
| --- | --- |
| `open()` | Runtime/schema versions, pool capacity/files, dataset/interrupted-job counts; fails without a temporary fallback |
| `close()` | Releases SQLite handles/lock and terminates worker; call only when idle |
| `importFile(file, {relativePath})` | `{dataset, duplicate, metrics}`; copy/hash, parse, validate, publish |
| `listDatasets({offset=0,limit=50})` | `{items,nextOffset}`; maximum 100, newest first |
| `listJobs({offset=0,limit=50})` | Same pagination; includes failures/interruption diagnostics |
| `getDataset(id)` | Dataset metadata after checking referenced files/schema/manifest; no STDF reparse |
| `readRows(id, table, {after=0,limit=100})` | `{items,nextAfter}`; keyset cursor, maximum 1,000 rows and 2 MiB response |
| `readRecord(id, seq)` | `{record,bytes}`; exact source record including its header, at most 65,539 bytes |
| `verifyDataset(id)` | Full SQLite integrity/count/reference checks and streaming source SHA-256 |
| `exportDataset(id)` | `{file,filename,exportToken,bytes,sha256}`; File backed by temporary OPFS package, not a full JS buffer |
| `restorePackage(file)` | `{dataset,duplicate}`; verifies package and staged database before publication |
| `cancel()` | Requests cooperative cancellation; resolves when current request settles |
| `terminate()` | Immediate worker termination; outcome can be unknown, so reopen and inspect jobs before retrying |
| `request('discardJob',{jobId})` | Removes only that known incomplete job's staging artifacts; preserves job history and published datasets |
| `request('releaseExport',{exportToken})` | Removes an app-generated temporary export after its download is finished |

`readRows` tables are only `records`, `measurements`, `devices`, `definitions`.
The cursor is `seq` for records/measurements and `id` otherwise. Repeated PTRs
and devices are distinct rows. Raw result bits preserve values SQLite REAL/JS
cannot represent exactly (including negative zero and NaN payloads). Definition
metadata stores declarations; omitted and empty fields are different. Effective
test defaults belong to a later explicitly designed query layer.

Dataset fields are `id`, `source_hash`, `parser_version`, `schema_version`,
`name`, `relative_path`, `source_bytes`, `db_bytes`, `created_at`, `status`,
and `manifest`. Logical/internal filenames are not exposed. Manifest fields:
`schemaVersion`, `parserVersion`, `source:{name,relativePath,size,sha256}`,
`counts:{records,measurements,devices,definitions}`, `byteOrder`, and `coverage`.
Counts are observations/attempts, not yield or unique production devices.

Catalog pagination uses offsets and may shift when imports are added. Refresh
after a mutation. Row cursors are stable because completed datasets are immutable.

## Job states and errors

Jobs progress through snapshot → parsing → validating → ready, or restoring →
ready. Other outcomes: duplicate, failed, cancelled, interrupted, discarded.
On reopening, unfinished jobs become interrupted. Retry selects the source again
and starts a new job; no unsupported byte-offset resume is implied. Known
incomplete staging can be discarded explicitly. Unreferenced complete artifacts
are retained through the interrupted job record, not silently removed on startup.

Dataset status is ready or unavailable. Access checks existence, source size,
schema and manifest agreement. Full integrity/hash checking is explicit through
`verifyDataset`; a cached ready label alone proves neither current availability
nor every byte's integrity. An unavailable duplicate requires recovery; it is
not silently overwritten by import/restore. A verified package can be restored
into a fresh browser library while retaining the damaged library for diagnosis.

Errors reject with `Error.code` and a human-readable `message`. Stable categories
include BUSY, NOT_OPEN, UNSUPPORTED, INVALID_REQUEST, INVALID_SOURCE, SOURCE_CHANGED,
NOT_FOUND, INCOMPATIBLE, CORRUPT, UNAVAILABLE, NEEDS_RECOVERY, LIBRARY_LIMIT,
CANCELLED, QUOTA_EXCEEDED, IMPORT_FAILED, INVALID_PACKAGE and WORKER_STOPPED.
Show the message and allow deliberate retry. Do not retry mutating calls blindly
after worker termination: publication may already have committed. Content hash
deduplication makes selecting the same completed source safe.

Progress events contain `phase`, `completedBytes`, `totalBytes`, optionally
`jobId`. Progress callbacks cannot determine commit success. Display stage and
bytes rather than inventing one overall percentage across copy/parse/validation.
Cancellation is checked between bounded I/O batches. Synchronous SQLite index
and integrity operations can delay cancellation; terminate/reopen is the hard
stop path. Report interruption and inspect state afterward.

## Storage, schema and memory

The dedicated worker owns Web Lock `semidata-library-v1`, SAH pool directory
`.semidata-library-v1`, and `/catalog.sqlite3`. Exact snapshots live in
`semidata-sources-v1`; temporary packages in `semidata-exports-v1`. The source
folder is separate and read-only. Storage is bound to exact origin/profile.
Never change the app's port during a persistence test and expect the same data.

Schema version 1 and exact SQL definitions are in
[dataset-schema.js](../site/dataset-schema.js). The catalog has datasets/jobs;
each dataset has meta/records/definitions/measurements/devices and indexes by
test number/device. Unexpected/newer schemas fail without migration or reset.
SQLite uses DELETE journals, FULL synchronization, bounded write transactions,
and a fixed cache budget. One source's catalog publication is atomic, but source,
dataset and catalog files are not one multi-file transaction.

Source copy/hash uses 1 MiB slices, Rust retained output 64 KiB inputs, and
database transactions cover up to 4 MiB of source input. SQLite and Rust have
separate WASM heaps; returned batches and browser internals add memory. The
qualified operating envelope must come from measured evidence, not these limits.
Evaluation limits: raw inputs 2 GiB, 1,000 datasets, 10,000 job records and folder
entries, 20,000 metadata definitions and the decoder's explicit byte cap.

Before importing, display `navigator.storage.estimate()` and
`navigator.storage.persisted()` when available. A user action may request
`persist()`, but use its actual result. Quota estimates are not reservations.
Catch real write failures and keep exports. Private sessions are unsuitable for
durable data. Local processing does not guarantee offline app startup.

## Sources and portability

[SOURCES.md](SOURCES.md) documents read-only folder handles, permission rechecks,
file-input fallback, explicit rescan, queue outcomes and cancellation. A folder
is an inventory source, not automatic watching or a database destination.

[SPEC-browser-transfer.md](../../SPEC-browser-transfer.md) defines `.sdlibrary`.
It contains original source plus database with streaming integrity checks;
checksums detect corruption but do not authenticate the sender. Names are
metadata, never filesystem extraction paths. Large exports remain disk-backed.
Do not turn returned File objects into whole-file ArrayBuffers. Temporary export
space remains until explicitly released; successful download must precede cleanup.

## Integration checks

From the repository root:

```powershell
node web-prototype/scripts/library-check.mjs chrome
node web-prototype/scripts/library-check.mjs msedge
node web-prototype/scripts/sources-check.mjs
node web-prototype/scripts/transfer-check.mjs
```

Use the engineering console to evaluate logistics. Build production screens one
feature at a time with the engineer: first a library/reopen flow, then import and
job feedback. Analysis screens should wait for the engineer's separate plan.
