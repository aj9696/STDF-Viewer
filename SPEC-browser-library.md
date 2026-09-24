# Specification: browser-library

Status: proposed provider design, 2026-09-24; implementation not started.
Scope comes from [the capability map](CAPABILITIES.md#proposed-next-increment-browser-data-logistics).
The engineer requested documentation and gradual logistics work. Analysis is
outside this increment. This specification governs persistence; file discovery
and batch import orchestration belong to browser-imports.

## Objective and first acceptance

Establish a local browser library which can save data, reopen it without an
STDF rescan, and distinguish complete datasets from interrupted imports.
The first task is a small storage feasibility experiment, not a complete
database product or a new analytical model.

## Candidate and decision checkpoint

Trial official SQLite WASM in one dedicated worker, initially using
`opfs-sahpool`. That VFS avoids COOP/COEP headers, has exclusive pool ownership
across browsing contexts, and requires capacity for database/journal/temp files.
Its `exportFile()` convenience function allocates the whole database, so it
does not establish a bounded-memory export solution. The alternative `opfs`
VFS requires SharedArrayBuffer and appropriate isolation headers. Select and
pin a released build after checking its actual API, rather than assuming the
current development documentation matches it.
[Official SQLite persistence documentation](https://sqlite.org/wasm/doc/trunk/persistence.md).

Record the tested browser versions, SQLite release, VFS, asset hashes, memory,
and reopen/export results in a decision note before extending imports. If
bounded export cannot be supported, reconsider the VFS here. Do not build a
large library around an untested backup path. In-memory whole-database designs
are not the starting proposal for these large inputs.

## Ownership and storage layout

Proposed logical layout: one versioned catalog plus an independent database
per source dataset, and exact source snapshots in a separate OPFS directory.
Physical paths depend on the selected VFS; logical SQLite filenames must not
be confused with ordinary filesystem paths. Raw sources must never be placed
inside the SAH pool's reserved directory. Measure pool/file-handle growth
before committing to this layout for many datasets.

One worker owns an active library. A second tab reports that the library is
already open, rather than creating a second pool or silently replacing data.
Use a stable application origin and pool name. Catalog and dataset versions
are explicit; opening a newer unsupported version fails without mutation.
No automatic native-workspace conversion is part of the first increment.

## Provider behavior

The provider supports creating an import job, writing bounded batches, checking
the completed dataset, publishing it, reopening it, and recording failure.
These are required behaviors, not final public method signatures or SQL DDL.
Specify concrete worker messages and persisted schema before implementation.

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
to known incomplete artifacts and never deletes a ready dataset's source.
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
Dataset identity is local to its source. Future row storage must preserve raw
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

Keep the experiment in `web-prototype/`. Proposed additions are
`site/storage-worker.js`, `site/library.js`, a storage integration harness under
`scripts/`, and `STORAGE-VALIDATION.md`. Parser changes remain under `rust/`.
Do not add a framework, server API, or global runtime for this experiment.

Existing checks, executable from the repository root in PowerShell:

```powershell
. .venv/runtime-environment.ps1
./web-prototype/build.ps1
cargo test --locked --manifest-path web-prototype/rust/Cargo.toml
node --check web-prototype/site/worker.js
node web-prototype/scripts/check.mjs ../semidata-evaluation.stdf
.venv/Scripts/python.exe -m http.server 8766 --bind 127.0.0.1 --directory web-prototype/site
```

These commands validate the existing parser, not unimplemented persistence.
The first task must add exact storage build/test commands and pinned assets to
the README. Use plain JS modules, named Rust types, parameterized SQL, and
versioned worker messages. Match the existing style, for example:

```js
self.postMessage({ type: "error", message: String(error?.message ?? error) });
```

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
  flags/observations, or describe this proposal as shipped functionality.

Open technical decisions: released SQLite/VFS selection, bounded export API,
many-dataset handle cost, and retained-record schema/batch interface. Compression,
folder watching, app-install/offline asset caching, and multi-tab collaboration
are later scopes. Local file processing does not itself promise offline startup.
