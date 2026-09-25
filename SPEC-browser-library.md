# Specification: browser-library

Status: implemented browser data foundation, 2026-09-24. BL-1 established the
storage choice; BL-2 through BL-6 add retained STDF imports, recovery, portable
packages and folder coordination. See [full-path validation](web-prototype/LIBRARY-VALIDATION.md)
and [the frontend contract](web-prototype/docs/FRONTEND-CONTRACT.md).
The engineer authorized completing logistics autonomously before frontend work.
Analysis remains outside this increment.

## Objective and storage decision

A browser library saves complete retained datasets, reopens them without an
STDF rescan, and distinguishes completed data from interrupted imports. Official
SQLite WASM `@sqlite.org/sqlite-wasm@3.53.4-build1` runs in one dedicated worker
using `opfs-sahpool`, without COOP/COEP or SharedArrayBuffer requirements.
Assets and notices are served locally and pinned in the npm lockfile.
[Official SQLite persistence documentation](https://sqlite.org/wasm/doc/trunk/persistence.md).

The convenience `exportFile()` whole-database allocation is not used for dataset
packages. `sqlite_dbpage` reads one page at a time inside a read transaction;
awaited OPFS writes provide backpressure. Restore uses the VFS's chunked import
callback into a new UUID database, followed by exact schema, integrity, count,
record-span and reference checks. The original [BL-1 evidence](web-prototype/STORAGE-VALIDATION.md)
is historical feasibility evidence; full retained-import measurements are in
the newer validation report.

## Ownership and storage layout

Implemented logical layout: one versioned catalog plus an independent database
per source dataset, and exact source snapshots in a separate OPFS directory.
Physical paths depend on the selected VFS; logical SQLite filenames must not
be confused with ordinary filesystem paths. Raw sources must never be placed
inside the SAH pool's reserved directory. Each dataset consumes one pool file; reserve six spare slots before staging.
The initial pool has eight slots. The 1,000-dataset cap is an evaluation guard,
not qualification at that library size.

One worker owns an active library. A second tab reports that the library is
already open, rather than creating a second pool or silently replacing data.
Use a stable application origin and pool name. Catalog and dataset versions
are explicit; opening a newer unsupported version fails without mutation.
No automatic native-workspace conversion is part of the first increment.

## Provider behavior

### BL-1 experiment contract

The isolated `storage.html` page uses a dedicated module worker and one stable
Web Lock, `semidata-storage-proof-v1`, before opening a separate SAH pool
directory `.semidata-storage-proof-v1`. No existing parser/workbench data is
accessed. No in-memory fallback is allowed. Closing the worker releases ownership.

Requests are `{version: 1, id: positiveInteger, type, ...payload}`; responses are
`{version: 1, id, ok: true, result}` or `{version: 1, id, ok: false,
error: {code, message}}`. One request is in flight at a time. Errors include
`UNSUPPORTED`, `BUSY`, `INVALID_REQUEST`, `INCOMPATIBLE`, `INVALID_BACKUP`,
`NOT_OPEN`, and `STORAGE_ERROR`. Failed/terminated workers are discarded before
retry. Unknown protocol versions/operations fail without SQL execution.

| Operation | Input | Result / effect |
| --- | --- | --- |
| open | none | Acquire exclusive ownership, open/create probe, report rows and storage/runtime evidence |
| write | `note`: string, 1–200 characters | Replace the single probe row in a durable transaction; return stored row |
| read | none | Verify schema and integrity; return the row, if any |
| export | none | Require a saved row; return a standalone SQLite ArrayBuffer, at most 1 MiB; never overwrite storage |
| restore | `bytes`: ArrayBuffer, at most 1 MiB | Validate a temporary imported database before transactionally copying its one probe row |
| close | none | Close database and release pool handles and ownership |

Probe database `/probe.sqlite3`: `PRAGMA application_id = 1396985936`,
`PRAGMA user_version = 1`, table `probe(id INTEGER PRIMARY KEY CHECK(id=1),
note TEXT NOT NULL CHECK(length(note) BETWEEN 1 AND 200), saved_at TEXT NOT NULL)`.
No implicit migration or reset of incompatible/corrupt storage. Read-only schema,
version, integrity and row checks precede writes on reopen/restore. Backups are
untrusted input: limit size, disable trusted schema, reject unexpected schema,
and use parameterized SQL. A restore deliberately replaces only the synthetic
probe row; it is not a dataset backup format. The separate BL-4 package path below supersedes this probe transfer.

Use a released, lockfile-pinned SQLite asset served from this origin. The asset
build copies the upstream license and records SHA-256 hashes. Automated browser
checks use isolated persistent test profiles, never the engineer's profile.

The provider supports creating an import job, writing bounded batches, checking
the completed dataset, publishing it, reopening it, and recording failure.
Concrete worker messages and persisted schema are defined in the frontend
contract and `site/dataset-schema.js`. Import and package specs define their
separate contracts.

| State | Catalog/library behavior |
| --- | --- |
| Importing | Owns staged artifacts; invisible to completed-dataset consumers |
| Validating | Writes finished; completeness, counts and integrity are checked |
| Ready | Published dataset and its referenced source can be reopened |
| Failed / Cancelled | Diagnostic retained; previously ready datasets unaffected |
| Interrupted | Found unfinished after restart; explicit retry starts at the beginning |
| Unavailable / Needs recovery | A published entry cannot open or validate its referenced artifacts; history is retained and recovery is explicit |

Publishing is an atomic catalog transaction after dataset/source finalization.
Do not assume a transaction spans separate database and source files. Recovery
must reconcile the catalog with staged artifacts; unreferenced completed files
are surfaced for recovery, not silently treated as disposable. Cleanup is scoped
to known incomplete artifacts and never deletes a ready dataset's source. Explicit discard also removes that
job's rollback journal; abandoned exports have a separate inventory and release
operation. A known unavailable dataset cannot be reused as a duplicate.
Reopening checks that published artifacts are present and usable; a saved
Ready label alone is not proof. Missing/corrupt artifacts produce a visible
recovery state, never an empty replacement database. Check existence/openability
on access; record separate integrity verification rather than implying that
opening SQLite proves every data page or source byte is intact.

Filename, path, size and modification time are discovery metadata, not content
identity. The importer first copies and hashes source bytes incrementally,
checks for an existing ready source, then parses the snapshot. This deliberate
extra pass gives an exact provenance source and avoids reparsing duplicates.
Do not use whole-file `arrayBuffer()`/digest calls. Identity is the SHA-256 of
original source bytes; reprocessing with a new parser is a separately versioned
artifact and must not silently mutate an earlier dataset.

## Retention boundary and resource behavior

Catalog minimum: dataset/job IDs, state, source hash and byte size, display name,
import time, parser/schema versions, covered record types, warnings, and counts.
Dataset identity is local to its source. Retained row storage preserves raw
measurement bits, flags, source sequence/offsets, metadata and device attempts;
do not aggregate or collapse repeated observations while ingesting. An STDF
snapshot is authoritative where a record family is not decoded yet. Neither
a snapshot-only database nor saved summary JSON passes retained-record acceptance.

Use fixed input/batch limits and backpressure: finish writing a batch before
producing an unbounded backlog. The parser and SQLite have separate WASM heaps;
measure both and JS buffers. Cancellation of synchronous worker work may need
worker termination followed by recovery on a fresh owner. Never disable storage
durability or skip validation merely to reproduce the summary-only scan time.

Record estimated quota/use and whether persistence was granted. Capacity
estimates cannot guarantee an import fits: catch actual write/quota failures.
Budget source copies, databases, journals, staging, and export space. Private
browsing and missing APIs must have explicit unsupported/temporary behavior;
do not promise retention based on detecting private mode.

## Structure, commands, and code conventions

Implementation stays in `web-prototype/`: Rust under `rust/`, framework-free JS
under `site/`, integration/fixture tools under `scripts/`. The new `foundation.html`
engineering console exercises the public client. The summary parser and synthetic
storage proof remain separate. Build and test commands are maintained in the
[prototype README](web-prototype/README.md); runtime modules have no CDN/backend
or dependency on the native workbench.

## Verification and boundaries

The storage proof passes only after create/write/close/reopen, page reload,
browser restart, contention from a second tab, and small export/restore work
in the tested browser. Empty/incomplete artifacts must never appear Ready.

Before a real-file library is usable, test exact counts, flags, order and
metadata on small fixtures, both byte orders, omissions, repeated PTRs, and
multiple head/sites. Require the workbench's complete-stream checks: one initial
FAR, MIR before device results, matched PIR/PRR per head/site, final MRR, and no
truncated or trailing records. Summary-parser framing alone is insufficient.
Inject cancellation, quota/write failure, and interruption
around publication. Existing native output is a comparison reference, not an
oracle for its known last-result collapsing behavior; use independent expected
records for preservation tests. Close/reopen checks verify actual persistence.

Before folder-scale use, prove bounded export/restore and full 1M/10M imports;
record time, database/source bytes, memory and quota behavior separately from
summary scans. No fixed throughput target is claimed before measuring writes.

- Always preserve originals, expose partial/unsupported coverage, version stored
  formats, and report a failed import without damaging completed datasets.
- Bring changes to retention, automatic source writes, or analytical semantics
  back to the engineer as product decisions with a concrete proposal.
- Never upload test content, modify source-folder files, silently discard raw
  flags/observations, or describe unqualified scenarios as supported functionality.

Remaining qualification: many-dataset handle cost, browser RSS/JavaScript peak
memory, real physical disk-full/power-loss behavior, and native folder permission
renewal across browser versions. Compression,
folder watching, app-install/offline asset caching, and multi-tab collaboration
are later scopes. Local file processing does not itself promise offline startup.
