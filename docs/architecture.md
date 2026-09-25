# Architecture and maintenance

SemiData is an additive workbench in the STDF-Viewer fork. Upstream baseline:
noonchen/STDF-Viewer commit b8deaad. The original application remains runnable
as STDF-Viewer.py; its documentation is retained in README.upstream.md.

## Components and dependency direction

Browser → loopback HTTP API → library / analysis / PAT → SQLite / Rust parser.
The UI does not implement scientific calculations. The analysis and PAT modules
do not import HTTP, Qt, or browser code.

| Path | Responsibility |
| --- | --- |
| semidata/ingest.py | Streaming STDF framing validation and Rust adapter |
| semidata/library.py | Source snapshots, metadata catalog, import publication |
| semidata/analysis.py | Populations, scalar queries, statistics, plot summaries |
| semidata/pat.py | Screening rules and immutable experiment persistence |
| semidata/server.py | Loopback HTTP, validation, static files, documentation |
| semidata/static/ | Browser interaction and visualization |
| semidata/demo.py | Deterministic binary STDF regression fixtures |
| tests/ | Native ingestion, calculations, persistence, transport regression |

## Decision 001: preserve the Rust parser

Use the existing Rust record pipeline and prepared/batched SQLite writes.
Do not infer a speed claim from implementation choices; benchmark workloads
before changing storage or parser architecture. The only initial parser change
preserves PARM_FLAG alongside scalar results. A 360-row test verifies full and
tail batches retain both flags and all prior result fields.

## Decision 002: catalog independent immutable imports

The upstream builder recreates its output tables. It never receives the catalog
path. Each import uses a unique staging directory, snapshots/hash-checks source
bytes, expands/validates the stream, builds source.db, verifies counts/integrity,
and publishes a catalog row after moving the completed directory into place.
Failed imports cannot replace an existing dataset. SHA-256 uniqueness and an
IMMEDIATE catalog transaction serialize concurrent imports. Busy writers may
time out after 30 seconds; imports are not a distributed job system.

The catalog uses WAL and FULL synchronous writes. Source databases are closed,
flushed, and queried read-only after publication. Runtime code never mutates
them. Catalog schema version 1 is checked at open; future incompatible versions
fail explicitly. There is no old-session migration in this release.

Workspace layout:

```
workspace/
  catalog.sqlite3
  imports/<dataset-id>/source.stdf[.gz|.bz2|.zip]
  imports/<dataset-id>/source.db
  demo-sources/*.stdf
```

Compressed imports retain the original compressed bytes. Temporary normalized
STDF is discarded after a successful parse. Deduplication compares original
bytes, so recompressing a file can create a distinct dataset. Power loss can
leave an unreferenced staging/import directory; the catalog ignores it.
No automatic orphan deletion is implemented. Stop the server before backing up
the entire workspace, including SQLite sidecars if present.

Since 0.1.1, preflight reads 1 MiB chunks and retains at most one partial record
between reads. Raw snapshots are parsed directly after validation, avoiding a
second full-file write. Compressed inputs and raw files with a misleading
compression suffix still use temporary normalized STDF, because the native
reader selects compression by filename. Byte signatures remain authoritative
for the workbench import contract.

## Decision 003: local browser UI with a native service

The browser contains only local assets. Python binds 127.0.0.1, validates Host,
rejects cross-origin requests, and requires a per-process token for writes.
No external assets, analytics, or production data uploads are included.
Explicit asset/document allowlists prevent arbitrary filesystem serving.
This is a single-user local service; LAN exposure, login, TLS, shared workspaces,
and enterprise deployment are outside its boundary.

## Decision 004: bounded, transparent first release

Maximum 20 selected datasets and 500,000 queried PTR rows. Catalog/history lists
show the most recent 200 entries. Original and expanded import sizes each have
a 2 GiB cap. The complete query population is held in process memory; this is
not yet a streaming analytics engine. The bounds make first-release behavior
explicit and errors actionable. No multi-gigabyte performance claim is made.

The native reader accepts IEEE big/little endian STDF V4. Workbench preflight
requires complete MIR/PIR/PRR/MRR framing, so some incomplete/live files that
the original viewer tolerated are intentionally rejected. MPR/FTR are retained
by the parser but not analyzed by this workbench version. See methods.md for
test identity, superseded attempts, repeated PTRs, units, flags, and Cpk policy.

## Adding a feature

The browser-only foundation is implemented separately under `web-prototype/`.
Its Rust/WASM parser feeds bounded batches to one SQLite owner worker. Each
immutable dataset has a source snapshot and database; the catalog publishes it
only after validation. Browser-managed storage is scoped to an exact origin and
profile. Portable packages preserve source bytes and database pages.

See [Browser data workflow](browser-data-workflow.md),
[frontend contract](../web-prototype/docs/FRONTEND-CONTRACT.md), and
[full-path validation](../web-prototype/LIBRARY-VALIDATION.md). The native service
and analysis architecture above remains unchanged. Future browser UI work must
consume this new contract; native analytical semantics are not silently applied
to the retained raw evidence.

1. Update the relevant module spec and acceptance checks.
2. Record native API changes in api.md, or browser contracts in
   web-prototype/docs/FRONTEND-CONTRACT.md and SOURCES.md, before adding UI consumers.
3. Keep the calculation in its domain module; add known-answer tests.
4. Exercise one full engineer workflow, including empty/error states.
5. Update the engineer guide, calculation reference, and changelog together.

Add schema migrations explicitly; never silently repurpose a source database
or change stored run semantics. Do not introduce a general plugin framework
until concrete integrations require one.
