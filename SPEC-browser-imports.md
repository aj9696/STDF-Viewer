# Specification: browser-imports

Implementation contract, 2026-09-24. Module: browser-imports in
[CAPABILITIES.md](CAPABILITIES.md). The engineer authorized completing the
logistics foundation autonomously until frontend development can begin.
Analysis and production UI design remain outside this increment.

## Outcome

Import raw IEEE STDF V4 in bounded chunks, retain exact source snapshots and
indexed records/measurements, reopen without reparsing, and support sequential
file/folder jobs. Completed data is immutable and independent of filenames.
Original files are never changed or uploaded.

## Decoder contract (version 1)

The Rust/WASM module adds `RetainedParser`: `new()`, `push(Uint8Array) -> JSON
string`, `finish() -> JSON string`, `memory_bytes() -> number`, and `free()`.
Input is at most 64 KiB per push. Consume each batch before the next push.
IDs/offsets are exactly representable JS integers; evaluation inputs have a
2 GiB limit. Failed parsers cannot resume. The summary parser stays unchanged.

Batch: `{version:1, records:[], definitions:[], measurements:[], devices:[]}`.
Tuple columns (a version change is required to reorder them):

- records: `[seq, offset, length, type, subtype, device_id, decoded_json]`.
  Sequence starts at 1; length includes the four-byte header; offset starts at
  zero. Every record is indexed. Undecoded records have null JSON; source
  offset/length provides exact bytes.
- definitions: `[id, test_number, name, metadata_json]`. Preserve declared PTR
  metadata, omitted-versus-empty fields and exact optional-tail bytes. IDs start
  at 1. Same test number and exact metadata tail can share a definition; distinct
  declarations do not. Name is null when omitted. Do not silently apply analytical
  defaults. Limit 20,000 definitions and fail explicitly above that limit.
- measurements: `[seq, device_id, definition_id, test_number, head, site,
  test_flags, parm_flags, result_bits, result]`. Keep every PTR, including repeated
  test/device pairs. Result is finite numeric or null; result_bits preserves
  the exact f32 bit pattern, including NaN, infinity and negative zero.
- devices: `[id, head, site, prr_seq, part_flags, num_tests, hard_bin, soft_bin,
  x, y, test_time, part_id, part_text]`. ID is the PIR sequence, not cross-source
  part identity. Emit on matching PRR; repeated devices remain separate attempts.
  Decoded optional PRR fields follow upstream defaults; raw bytes remain exact.

Decode FAR/MIR/MRR/PIR/PRR metadata. Index all other record families and expose
coverage limitations. Require one initial FAR, matching IEEE CPU/byte order,
V4, MIR before devices/results, matched PIR/PRR per head/site, results inside
an open device, final MRR without open devices/trailing records, and complete
headers/payloads. Malformed mandatory fields fail. MPR/FTR get device context
and raw indexes but are not emitted as PTR measurements.

`finish()` returns `{version:1, bytes, records, measurements, devices,
definitions, byte_order, record_counts, coverage}`. Counts are retained
observations, not unique parts or analytical populations.

Also export `Sha256Hasher`: `new()`, `update(Uint8Array)`, `finish() -> lowercase
hex`, `free()`. Hash original bytes incrementally and verify against independent
SHA-256. No whole-file digest or measurement-sized object collection.

## Import lifecycle

One worker owns a stable library Web Lock. Catalog + per-source SQLite databases
use pinned sahpool; snapshots/exports use separate OPFS directories. Snapshot
and hash first, check duplicate ready content by SHA-256 plus parser/schema
version, then parse the snapshot. Prepared statements, bounded transactions,
backpressure and durable commits are required. Document concrete schema and
worker API before integrating a frontend.

Create catalog jobs before UUID-named staging. Publish Ready only after complete
parser validation, counts/integrity and source finalization. Reopen marks pending
jobs interrupted. Failed/cancelled jobs remain visible; retry starts afresh.
Duplicates return the existing ready dataset without reparsing. Changed content
with the same name is distinct. Missing published artifacts become unavailable,
never empty replacement databases. Cancellation/failure cannot damage ready data.

## Folder interface

Read-only directory selection with relative-path file-input fallback. Inventory
before importing, optional subfolders, raw-file filtering, bounded candidate
count, sequential queue, per-item outcomes, cancellation and explicit rescans.
Remembered handles require permission rechecks. No background watching.
Changing/incomplete files fail individually, preserving completed datasets.

## Structure, commands and verification

Rust: `web-prototype/rust/src/retained.rs`, exported bindings, locked hash
dependency. Plain JS worker/client modules under `web-prototype/site/`;
fixtures/harnesses under `web-prototype/scripts/`. Parameterized SQL, no new
framework/backend/CDN. Example: `statement.bind(row).step(); statement.reset();`
inside a bounded transaction.

```powershell
. .venv/runtime-environment.ps1
cargo test --locked --manifest-path web-prototype/rust/Cargo.toml
./web-prototype/build.ps1
npm.cmd --prefix web-prototype run build:storage
node web-prototype/scripts/library-check.mjs
```

Test independent little/big-endian fixtures, repeated results, heads/sites,
nonfinite/signed-zero bits, optional declarations and malformed streams. Compare
source hashes to Python, the evaluation file's counts to native ingestion, and
small fixture rows to known expectations. Test restart, dedupe, cancellation,
publication failures, quotas, unavailable artifacts, rescans and portable restore.
Measure full 1M/10M imports separately from summary scans; no fixed speed promise.

Always preserve/version raw evidence, document limits and test before commits.
User authorization covers necessary schemas/dependencies. Never alter originals,
native data or analytical semantics. Compression, PAT, retest consolidation,
analytical default resolution and production UX remain later decisions.
