# Browser data foundation: validation and qualification

Recorded 2026-09-24. This qualifies the local engineering foundation used by
`foundation.html`, not a production analysis application. The historical
[storage proof](STORAGE-VALIDATION.md) and summary-parser measurements exercise
different workloads. [Frontend handoff](docs/FRONTEND-HANDOFF.md) describes the
delivered interfaces and the next product work.

## Method and environment

Windows, AMD Ryzen 7 7700X (8 cores / 16 logical processors), approximately
31.2 GiB physical memory. Chrome 153.0.8010.48 and Edge 153.0.4234.48. Official
SQLite WASM 3.53.4 (`@sqlite.org/sqlite-wasm@3.53.4-build1`), `opfs-sahpool`,
DELETE journals, FULL synchronization, 8 MiB import cache (the pinned default
read-only cache is 16 MiB). Rust `rust-stdf`
1.1.0 with the retained-record adapter and incremental SHA-256.

Browser harnesses start their own loopback static server and isolated persistent
profiles under ignored `results/`. They do not read or clear the engineer's
browser library. Process-restart checks relaunch the same profile and origin;
restore checks use a fresh profile. Downloads use disk-backed File objects.
Original source fixtures are read-only. There is no data upload or remote API.

Final large trials are sequential, one per size, with no competing large benchmark
or build. Small correctness/recovery checks briefly overlapped the first trial;
that is an additional limit on close timing comparisons. They include snapshot/hash, parsing and JavaScript batch decoding,
SQLite inserts and index maintenance, complete-stream checks, database scalar,
count, integrity, record-span/reference validation, and catalog publication.
Export time includes package hashing and OPFS output; saving the resulting
download is outside that timer. Restore time includes package/source hashing,
staging and full database validation. It currently verifies the package twice
across the library and transfer boundaries; that extra I/O is included.
Post-restore verification hashes the retained source again outside the restore
timer. No median, general throughput guarantee, or native/browser speed parity
is implied by these observations.

## Full import and portable recovery

| Measurements | Source / SQLite | Full import | Export | Restore | Import Rust / SQLite WASM |
| --- | --- | --- | --- | --- | --- |
| 1,000,000 | 89.31 MiB / 93.58 MiB | 17.22 s | 5.07 s | 11.50 s | 2.19 MiB / 9.62 MiB |
| 10,000,000 | 893.12 MiB / 963.35 MiB | 174.45 s | 47.54 s | 112.35 s | 2.19 MiB / 9.62 MiB |

| Measurements | Copy + hash | Parse + batch decode | Writes + indexes | Validation |
| --- | --- | --- | --- | --- |
| 1,000,000 | 0.48 s | 0.71 s | 10.67 s | 3.73 s |
| 10,000,000 | 7.42 s | 6.85 s | 106.96 s | 38.00 s |

Phase timings do not sum exactly to the total: setup, final commits, asynchronous
file reads and publication add work outside the named timers. Full raw results,
package sizes, storage estimates and hashes are in [the evidence JSON](evidence/library-foundation.json).

Both workloads contain 100 test declarations per device, four sites, and
deterministic generated values. Source hashes, exact counts and nine measurements
near the beginning, middle and end are checked. Each sampled row's test number,
head/site, flags and float bits are independently decoded from the original
source at its retained byte offset. Restored rows and complete raw sample records
must match, and final SQLite/source verification must pass.

The table records post-import allocation. After restore and verification,
SQLite allocated 21,037,056 bytes (20.06 MiB) in each fresh restore profile.
Memory values are allocated Rust and SQLite WASM linear memory, not whole-browser
RSS, JavaScript peak heap, or a bound on OS cache. The streams use 1 MiB snapshot
slices, 64 KiB parser inputs and awaited, bounded transfer writes. Definitions
have explicit count/byte caps. Browser File/OPFS implementations add their own
memory and storage behavior. A 1,000-dataset library and inputs at the full 2 GiB
guard have not been qualified by the two large trials.

### Changes justified by measurement

The initial implementation created indexes after inserting the data. A controlled
one-million-row comparison measured SQLite allocation growing from 10,092,544
to 52,625,408 bytes during that sort. Creating empty indexes first and maintaining
them within bounded insert transactions kept allocation at 10,092,544 bytes.
That single comparison took 16.32 versus 15.86 seconds and increased database
size by 4.6%. The initial ten-million run allocated 470,286,336 SQLite bytes;
the final table above records the adopted path. Maintaining indexes uses more
insertion work but avoids that dataset-sized sorting allocation.

Export originally awaited a write for every SQLite page. The final path
coalesces consecutive pages into a fixed transfer buffer before awaiting each
write, preserving page order and backpressure. Package checksums, odd buffer/page
boundaries and final tails are checked independently. The initial ten-million
export took 124.99 seconds; final timing above comes from the adopted path.

## Correctness and recovery evidence

| Check suite | Result | Scope |
| --- | --- | --- |
| Rust | 16 tests passed | Summary regression, retained framing/fields, definition caps, hash vectors |
| Source/queue unit tests | 16 passed | Inventory, permission mocks, changes, queue and cancellation races |
| Portable-transfer unit tests | 8 groups passed | Framing, checksums, corruption, awaited bounded transfers, page batching/tails |
| Library integration | 11 groups passed in each of Chrome and Edge | Exact goldens, malformed sources, 20 malicious restores per browser, mixed queue, export/restore, process restart |
| Recovery integration | 7 groups passed in each browser | Busy ownership, cancellation, parse/export/restore termination, quota injection, same-size corruption |
| Source browser integration | 6 groups passed in each browser | Real handles/IndexedDB restart, subfolders, changes, fallback UI, reconnect/rescan |
| Large retained path | 1M and 10M passed in Chrome | Full import, disk-backed package, fresh-profile restore, exact samples and final verification |

The independent Python golden fixtures contain both byte orders, repeated PTRs,
simultaneous heads/sites, repeated part IDs in separate attempts, omitted versus
empty declarations, negative zero, infinity and a NaN payload. All record offsets,
raw bytes, measurement/device tuples, exact declaration tails and selected
metadata are compared, rather than relying on the native workbench's collapsed
last-result view. MPR/FTR context and an unknown family remain raw-indexed.

Malformed-source tests reject truncation, missing final MRR, unmatched sites and
trailing records. Ten checksum-valid malformed package variants exercise a
metadata view, oversized manifest, record gaps/overlap, head/site mismatches,
null PTR/PIR/PRR device references and a BLOB where a numeric result belongs.
Each is tried with an existing identical source and in a fresh library. None may
publish or return an existing duplicate before its database is validated.

A malformed scalar fixture exposed a gap in relying on the observed read-only
integrity-check result alone. A focused reproduction on the pinned SQLite 3.53.4
build and the same SAH database returned `ok` when opened with `r`, while `w`
reported the failing CHECK; the stored result was a BLOB in both cases.
`ignore_check_constraints` was zero, with and without defensive configuration.
Explicit SQL type/range/text-bound checks now run before publication while
retaining read-only access. The regression rejects that package. This records
the observed open-mode difference; it does not establish an upstream root cause.

Recovery tests distinguish cancellation from termination. A stopped worker marks
unfinished jobs interrupted on reopen; explicit discard removes only that job's
snapshot, database and rollback journal. Publication-quota failure is injected
before the catalog commit. Ready data remains intact. Equal-length source
corruption becomes unavailable after full verification and cannot be reused as
a duplicate. Interrupted export files remain discoverable and removable.
Final seven-group recovery runs used a 6.38 MB interruption fixture; earlier
cancellation/parse-interruption runs also passed with the 93.65 MB source.
The large-volume benchmark completes imports and restores normally; it is not
a ten-million-row fault-injection test.

## Embedded-browser walkthrough

At `http://127.0.0.1:8766/foundation.html`, the console imported the STDF.io
evaluation file, reopened after reload without selecting it again, displayed
100 retained measurement rows, exported its package, rediscovered that temporary
package after closing/reopening the library, and validated a duplicate restore.
The console was visually inspected and left available with its library connection
closed. Its host-process restart, large-file run and native folder permission
UI are not covered by that walkthrough. Desktop Chrome/Edge evidence must not
be presented as those embedded-browser qualifications.

## Supported envelope and remaining work

- Raw IEEE STDF V4 only, at most 2 GiB per input; complete streams required.
  PTR measurements are normalized. Other families retain exact original bytes
  and explicit coverage labels; full semantics are not implied by framing.
- Up to 20,000 exact definitions and 16 MiB of definition-tail cache. Folder
  inventories, jobs and temporary exports each have 10,000-entry guards; datasets
  have a 1,000-entry guard. Packages are capped at 8 GiB. These are safety bounds,
  not measured capacity claims.
- Quota estimates are not reservations. Import, restore and export need space
  for source, database, journals and temporary packages. Duplicate restore also
  stages and validates its data before returning the existing dataset.
- Tests use injected quota failure, worker termination and deliberate corruption;
  physical disk-full, machine power loss and browser eviction remain unqualified.
- Native folder-picker dialogs and native permission renewal/denial remain manual
  qualification work. Real OPFS handle serialization and the folder input fallback
  have separate browser coverage; mocked permission tests do not prove native UI.
- The library belongs to an exact origin/profile. There is no in-place repair,
  automatic schema migration, destructive reset, cross-file merge, background
  watch, compressed-input support, offline asset cache, or shared multi-tab writer.
- The engineering console previews bounded pages. Final product UX and analytical
  policy, including effective STDF defaults and PAT, remain the engineer's next
  design work. Hosted CI and publication have not been performed.

## Reproduction

Build prerequisites and the external evaluation-file requirement are in the
[README](README.md#foundation-verification). Run from the repository root:

```powershell
. .venv/runtime-environment.ps1
cargo test --locked --manifest-path web-prototype/rust/Cargo.toml
./web-prototype/build.ps1
npm.cmd --prefix web-prototype run build:storage
.venv/Scripts/python.exe web-prototype/scripts/make-library-fixtures.py
.venv/Scripts/python.exe -m benchmarks.generate --duts 10000 --tests 100
.venv/Scripts/python.exe -m benchmarks.generate --duts 100000 --tests 100
node web-prototype/scripts/sources-check.mjs
node web-prototype/scripts/transfer-check.mjs
node web-prototype/scripts/library-check.mjs chrome
node web-prototype/scripts/library-check.mjs msedge
node web-prototype/scripts/library-recovery-check.mjs chrome
node web-prototype/scripts/library-recovery-check.mjs msedge
node web-prototype/scripts/source-browser-check.mjs chrome
node web-prototype/scripts/source-browser-check.mjs msedge
node web-prototype/scripts/library-benchmark.mjs chrome
```

The opt-in large benchmark retains profiles and downloaded packages under
`web-prototype/results/`; provision free disk space accordingly. Fixture sources
are under ignored `.venv/bench-data/`. Portable result summaries and exact runtime
asset/code hashes accompany this report in `evidence/library-foundation.json`.
The harness prints its detailed local evidence directory after each successful
run. A failed assertion exits nonzero; the benchmark also saves its failure text.
