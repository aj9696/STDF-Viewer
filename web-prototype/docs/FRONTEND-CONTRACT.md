# Browser library frontend contract

Version 1, 2026-09-24. This is the logistics and recorded-inspection boundary for
the browser frontend.
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
The [engineering console](../site/foundation.html) is a reference integration,
not the production frontend. See [FRONTEND-HANDOFF.md](FRONTEND-HANDOFF.md) for a
reproducible evaluation workflow. Methods reject rather than retry silently.
Call `open()`/`close()` only while idle; BUSY must not be treated as a worker
failure or an invitation to start a second client against the same library.

## Methods

| Method | Result / behavior |
| --- | --- |
| `open()` | Runtime/schema versions, pool capacity/files, dataset/interrupted-job counts; fails without a temporary fallback |
| `close()` | Releases SQLite handles/lock and terminates worker; call only when idle |
| `importFile(file, {relativePath})` | `{dataset, duplicate, metrics}`; copy/hash, parse, validate, publish |
| `listDatasets({offset=0,limit=50})` | `{items,nextOffset}`; maximum 100, newest first |
| `listJobs({offset=0,limit=50})` | Same pagination; includes failures/interruption diagnostics |
| `getDataset(id)` | Dataset metadata after checking referenced files/schema/manifest; no STDF reparse |
| `listTests(id, {query='',after=null,limit=50})` | Grouped test-number inventory and literal search; maximum 100 groups; details below |
| `getTest(id, testNumber)` | `{test_number,measurementCount,definitionCount}`; absent test rejects NOT_FOUND |
| `readTestDefinitions(id, testNumber, {after=0,limit=25})` | `{items,nextAfter}`; original declaration columns, maximum 100 rows |
| `readTestMeasurements(id, testNumber, {after=0,limit=100})` | `{items,nextAfter}`; measurement columns plus recorded attempt fields, maximum 1,000 rows |
| `readRows(id, table, {after=0,limit=100})` | `{items,nextAfter}`; keyset cursor, maximum 1,000 rows and a 2 MiB JSON row-data budget |
| `readRecord(id, seq)` | `{record,bytes}`; exact source record including its header, at most 65,539 bytes |
| `verifyDataset(id)` | SQLite integrity, scalar type/range/text bounds, count/reference/record-span checks, and streaming source SHA-256 |
| `exportDataset(id)` | `{file,filename,exportToken,bytes,sha256}`; File backed by temporary OPFS package, not a full JS buffer |
| `restorePackage(file)` | `{dataset,duplicate}`; verifies the package and staged database before duplicate detection or publication |
| `cancel()` | Requests cooperative cancellation; resolves when the current request settles, not as proof it was cancelled |
| `terminate()` | Immediate worker termination; outcome can be unknown, so reopen and inspect jobs before retrying |
| `request('discardJob',{jobId})` | Removes only that known incomplete job's staging artifacts; preserves job history and published datasets |
| `request('listExports',{offset=0,limit=50})` | `{items,nextOffset}`; maximum 100, generated temporary packages ordered by token, including earlier sessions and interrupted exports |
| `request('releaseExport',{exportToken})` | Removes an app-generated temporary export after its download is finished |

`readRows` tables are only `records`, `measurements`, `devices`, `definitions`.
The cursor is `seq` for records/measurements and `id` otherwise. Repeated PTRs
and devices are distinct rows. Raw result bits preserve values SQLite REAL/JS
cannot represent exactly (including negative zero and NaN payloads). Definition
metadata stores declarations; omitted and empty fields are different. Effective
test defaults belong to a later explicitly designed query layer.

Only PTR produces normalized measurement rows. FAR, MIR, MRR, PIR and PRR have
decoded record metadata. MPR/FTR retain their device context and raw record
indexes, without normalized measurements. Other indexed-only families retain
their framed bytes, but their complete field semantics are not validated.
`manifest.coverage` makes this distinction explicit; do not equate a successful
import with full semantic support for every record family.

`readRows` can return fewer than `limit` rows because of the byte budget. Use the
returned `nextAfter` until it is null; a short page is not an end-of-table test.
Do not calculate the next cursor from array length or assume sequence numbers
are consecutive within a particular table. The console requests at most 100
rows and intentionally omits a full pagination UI. `readRecord` retrieves the
original bytes when a decoded view does not cover the needed fields.

Dataset fields are `id`, `source_hash`, `parser_version`, `schema_version`,
`name`, `relative_path`, `source_bytes`, `db_bytes`, `created_at`, `status`,
and `manifest`. Logical/internal filenames are not exposed. Manifest fields:
`schemaVersion`, `parserVersion`, `source:{name,relativePath,size,sha256}`,
`counts:{records,measurements,devices,definitions}`, `byteOrder`, and `coverage`.
Counts are observations/attempts, not yield or unique production devices.
Device IDs identify individual PIR/PRR attempts within one source, not a merged
cross-file part identity. PTR result bits remain authoritative for NaN payloads,
infinities and signed zero; JSON/SQLite numeric output is not an exact substitute.

Catalog pagination uses offsets and may shift when imports are added. Refresh
after a mutation. Row cursors are stable because completed datasets are immutable.
`listExports` items are `{exportToken,bytes,lastModified}`. `lastModified` is
milliseconds since the Unix epoch. This is a cleanup inventory, not a list of
verified/downloaded backups: interrupted entries may have zero bytes. Its
offset pagination can also shift after deletion; refresh from offset zero.

## Test inspection queries

The additive query interface is specified in
[SPEC-test-explorer.md](../../SPEC-test-explorer.md); its first product consumer
is [Test Explorer](TEST-EXPLORER.md). Queries call `LibraryStore.access` and close
the read-only dataset handle in `finally`. They do not modify stored data, reparse
STDF, resolve defaults, apply scale exponents, filter flags or combine retests.
All four reject LIBRARY_LIMIT when the manifest reports more than 20,000
declarations or a bounded 20,001-row probe finds additional stored definitions.
This check covers restored packages as well as decoder-produced datasets. The
saved dataset remains accessible through the existing Library tools workflows.

`testNumber` must be an unsigned 32-bit integer, including `0` and `4294967295`.
`listTests` accepts a string `query` of at most 128 JavaScript string code units,
a nullable uint32 `after` cursor, and integer `limit` from 1 through 100. Defaults
apply when an option is omitted, not when a non-nullable option is passed as null.
Invalid types, NaN, fractions and out-of-range values reject INVALID_REQUEST.

Its result is:

```js
{
  items: [{ test_number, name, definition_count }],
  nextAfter, totalTests, matchedTests
}
```

The query groups declarations by test number, never the measurement table.
`name` is the lexicographically first nonempty recorded name, or null when none
exists. `definition_count` includes every declaration in the group. Literal
substring search matches decimal test number or any recorded declaration name;
SQLite's built-in ASCII case folding applies, while Unicode characters otherwise
match literally. `%`, `_` and quotes have no wildcard or SQL meaning. Search
selects matching groups before cursor paging; it never hides the other
declarations of a matching test. `totalTests` counts all groups and `matchedTests`
counts all matching groups, independently of cursor position.

The first `listTests` cursor must be null to include test number zero. Zero is a
valid returned `nextAfter`: continue while `nextAfter !== null`, not while it is
truthy. Results are ordered by ascending test number. Test-number grouping is a
navigation convention within one dataset, not an analytical population or a
cross-source test identity. Multiple names, units and limits can share a number.

`getTest` counts declarations and traverses the selected test's matching entries
in the existing `measurements_test` index to count its observations. This avoids
a whole-measurement-table scan but is not a cached or constant-time count.
It rejects NOT_FOUND when no matching
declaration exists. Row-page methods may instead return an empty page for an
absent test. Their `after` cursor is a nonnegative safe integer (default zero),
with strict integer limits: 1–100 definitions or 1–1,000 observations.

`readTestDefinitions` returns original `id`, `test_number`, `name` and
`metadata_json`, ordered by `id`. `readTestMeasurements` returns all original
measurement columns (`seq`, `device_id`, `definition_id`, `test_number`, `head`,
`site`, `test_flags`, `parm_flags`, `result_bits`, `result`) plus `part_id`,
`hard_bin`, `soft_bin` and `part_flags`. It uses the `(test_number, seq)` index
and a LEFT JOIN against the device primary key, ordered by `seq`. Do not drop an
observation merely because joined metadata is null, or interpret `result: null`
as zero; decode `result_bits` for special floating-point values.

All three page methods limit JSON row data to 2 MiB and look ahead to decide
whether more rows exist. A short page can still have a non-null cursor. Return
that exact cursor to fetch the next page; IDs and sequences can be sparse.
Stable keyset cursors rely on the completed dataset remaining immutable. The
client's explicit dataset/test arguments take precedence over similarly named
properties in the options object. Operations remain serialized through the
existing owner worker; query counts are not separate concurrent requests.

## Job states and errors

Jobs progress through snapshot → parsing → validating → ready, or restoring →
ready. Other outcomes: duplicate, failed, cancelled, interrupted, discarded.
On reopening, unfinished jobs become interrupted. Retry selects the source again
and starts a new job; no unsupported byte-offset resume is implied. Known
incomplete staging can be discarded explicitly. Unreferenced complete artifacts
are retained through the interrupted job record, not silently removed on startup.
Ordinary failed/cancelled imports attempt to remove their own unpublished staging;
if cleanup fails, the job remains available for explicit discard. Jobs are
durable history, whereas `ImportQueue` progress/outcome snapshots are in-memory
UI state. Reopening does not automatically reconstruct or resume a folder queue.

Dataset status is ready or unavailable. Access checks existence, source size,
schema and manifest agreement. Full integrity/hash checking is explicit through
`verifyDataset`; a cached ready label alone proves neither current availability
nor every byte's integrity. An unavailable duplicate requires recovery; it is
not silently overwritten by import/restore. A verified package can be restored
into a fresh browser library while retaining the damaged library for diagnosis.
Validation also checks the declared scalar types and supported numeric/text
bounds in [dataset-schema.js](../site/dataset-schema.js), contiguous record spans,
measurement/device references, and matching PIR/PRR records. SQLite's own
integrity check alone is not a retained-data contract check. These validations
do not reparse every source record or invent semantics for indexed-only families.

Errors reject with `Error.code` and a human-readable `message`. Stable categories
include BUSY, NOT_OPEN, UNSUPPORTED, INVALID_REQUEST, INVALID_SOURCE, SOURCE_CHANGED,
NOT_FOUND, INCOMPATIBLE, CORRUPT, UNAVAILABLE, NEEDS_RECOVERY, LIBRARY_LIMIT,
CANCELLED, QUOTA_EXCEEDED, IMPORT_FAILED, INVALID_PACKAGE, STORAGE_ERROR,
PROTOCOL_ERROR and WORKER_STOPPED. Transfer helpers can also report
TRANSFER_ERROR; source/queue validation codes are documented separately.
Show the message and allow deliberate retry. Do not retry mutating calls blindly
after worker termination: publication may already have committed. Content hash
deduplication makes selecting the same completed source safe.

Progress events contain `phase`, `completedBytes`, `totalBytes`, optionally
`jobId`. Progress callbacks cannot determine commit success. Display stage and
bytes rather than inventing one overall percentage across copy/parse/validation.
Cancellation is checked between bounded I/O batches. Synchronous SQLite index
and integrity operations can delay cancellation; terminate/reopen is the hard
stop path. Report interruption and inspect state afterward.
The original operation's settled result determines whether it completed,
duplicated, failed, or cancelled. A late cancellation can legitimately return a
completed dataset. During a folder queue, cancel through `ImportQueue.cancel()`
so later files remain pending. Cancelling only the library request would leave
the queue free to start its next item. Closing/navigating away terminates the
console's worker without an automatic retry; return to the same origin, reopen,
inspect jobs and datasets, then explicitly retry or discard known staging.

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
and a fixed cache budget. Test/device indexes are created on the empty dataset
and maintained during insertion, avoiding a later whole-dataset index build and
its growing sort workspace. One source's catalog publication is atomic, but source,
dataset and catalog files are not one multi-file transaction.

Import metrics report different measured regions: `snapshotMs` covers source
copy/hash, `parseMs` covers retained decoding and batch JSON conversion,
`writeMs` covers batched inserts, index maintenance and intermediate commits,
and `validationMs` covers manifest/contract checks rather than index construction.
The final partial-batch commit, setup and publication remain in `totalMs`, so
these phase fields are not a complete additive partition of end-to-end time.
Keep their definitions alongside any displayed measurements; do not compare
`parseMs` alone to a complete library import.

Source copy/hash uses 1 MiB slices, Rust retained output 64 KiB inputs, and
database transactions cover up to 4 MiB of source input. SQLite and Rust have
separate WASM heaps; returned batches and browser internals add memory. The
qualified operating envelope must come from measured evidence, not these limits.
Evaluation limits: raw inputs 2 GiB, packages 8 GiB, 1,000 datasets, 10,000 job
records, 10,000 folder entries, and 10,000 temporary exports. Decoder state is
limited to 20,000 metadata definitions and 16 MiB of distinct raw definition
tails. Discarding staging preserves job history and does not reduce the job
count. These are implementation ceilings, not a qualified operating envelope.

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

Use `URL.createObjectURL(result.file)` for a download link, retaining its
`exportToken` separately. Creating a link or triggering a download does not prove
the browser finished saving it. Release only after an explicit user action that
acknowledges completed or abandoned downloads; revoke the object URL then. Never
release automatically on page unload. `listExports` discovers old temporary
files after a crash/restart. It does not reconstruct download links; exporting a
dataset again creates a new package. The console offers batch cleanup of the
displayed first 100 entries.

Import duplicates are identified after snapshot/hash by source SHA-256 plus
parser/schema version and reuse the saved dataset without a second parse.
Restore duplicates follow a different path: package framing/hash, staged source,
database schema, manifest agreement, integrity, scalar bounds, counts, record
spans and references are checked
before returning an existing dataset. Consequently, restoring an existing
package still needs temporary disk space and can fail validation or quota
checks. An existing source hash does not excuse a damaged or incompatible
package. No completed dataset is silently replaced.
A package covers one source/database pair; it does not include library-wide job
history, all other datasets, UI settings, or remembered directory handles.

## Integration checks

From the repository root:

```powershell
.venv/Scripts/python.exe web-prototype/scripts/make-library-fixtures.py
node web-prototype/scripts/retained-check.mjs .venv/library-fixtures/golden-little.stdf
node web-prototype/scripts/retained-check.mjs .venv/library-fixtures/golden-big.stdf
node web-prototype/scripts/library-check.mjs chrome
node web-prototype/scripts/library-check.mjs msedge
node web-prototype/scripts/sources-check.mjs
node web-prototype/scripts/source-browser-check.mjs chrome
node web-prototype/scripts/source-browser-check.mjs msedge
node web-prototype/scripts/transfer-check.mjs
```

Build prerequisites and the external evaluation-file requirement are documented
in the [README](../README.md#foundation-verification). Recovery/fault checks use
`library-recovery-check.mjs` with the same browser argument and additionally
require its generated 1M source. Test outcomes and limitations belong in
[LIBRARY-VALIDATION.md](../LIBRARY-VALIDATION.md); this contract makes no import
speed or universal browser-support claim.

The product [library home](LIBRARY-HOME.md) provides saved-dataset open/reopen and
single-source import feedback. [Test Explorer](TEST-EXPLORER.md) adds recorded
PTR inspection through the four bounded query methods. Its guide records the
format/browser verification commands and current qualification status. Use the
engineering console for the remaining logistics workflows. Continue one feature
at a time; analytical policies require the engineer's separate design.
