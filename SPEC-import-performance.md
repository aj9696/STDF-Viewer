# Specification: measured import performance

## Objective and authorization

The engineer requested faster parsing of large STDF files, research into the
format's design, and progress toward a browser application on 2026-09-24.
Preserve measurement semantics and failed-import isolation while improving
measured ingestion cost. Synthetic benchmarks support reproducibility; they
do not establish production-vendor coverage or a speed ranking against tools
we have not measured.

## Capability map and sequence

| Module | Responsibility | Depends on |
| --- | --- | --- |
| import-benchmarks | Deterministic scalable input, phase timings, peak memory and correctness evidence | existing native importer |
| import-performance | Reduce proven validation, I/O, or database costs without weakening checks | import-benchmarks |
| browser-parser-prototype | Bounded raw STDF parsing in a browser worker using Rust/WASM | upstream rust-stdf, shared benchmark inputs |

Build sequence: baseline harness → measured native changes → comparison and
review. The isolated browser parser can proceed independently. Its scoped
specification lives in web-prototype/; full browser database/PAT migration is
a later increment after this parsing experiment.

## Boundaries

- Retain original source snapshots, SHA256 deduplication, complete-record/DUT
  validation, integrity checks, flags, scaling, limits, and retest behavior.
- Never publish incomplete imports or remove correctness checks for speed.
- Keep large generated files, databases, downloaded specs, caches, and compiler
  output under ignored .venv paths. Do not commit proprietary inputs.
- Keep the shipping application usable while the browser experiment remains
  explicitly separate. Native and browser workloads must be labeled separately.
- Read/write benchmarks run sequentially. Record cold-process versus warm-file
  cache conditions; do not claim an OS cold-cache run without controlling it.
- Keep measured changes; reject experiments with unsupported speed claims.

## Structure and commands

- benchmarks/: generator, process-isolated runner, JSON results contract.
- semidata/ingest.py and library.py: validation and import orchestration.
- deps/rust_stdf_helper/src/: native parsing/database path.
- tests/: correctness and malformed-input regression cases.
- docs/import-performance.md: measurements, methodology, findings and caveats.
- docs/stdf-format.md: primary-source design explanation.

```powershell
.venv/Scripts/python.exe -m unittest discover -s tests -v
.venv/Scripts/python.exe -m compileall -q semidata benchmarks
git diff --check
```

Exact benchmark and WASM build commands will be documented with their CLIs.
Use focused functions and existing conventions; use explicit byte offsets
and bounded buffers for record scanning. No runtime timing assertions in tests.

## Acceptance

1. Baseline and changed imports use identical hashed input files, expected DUT/
   test/PTR counts, and comparable measurement summaries or logical digests.
2. Report full import time separately from Rust parse/database time and file
   validation. Include process peak memory and database size.
3. Test record boundaries across chunks, truncated headers/bodies, final MRR,
   both IEEE byte orders, compressed errors and expansion caps for any scanner
   change. Retest/batch changes need ordering and last-result regressions.
4. At least one million PTRs and one larger workload are measured if workstation
   resources permit. Increase size progressively; record actual tested sizes.
5. Browser prototype uses the actual WASM parser in a worker, bounded input
   chunks, explicit errors, and verifiable results. No speed equivalence claim
   between summary-only parsing and full database import.
6. Independent review, existing tests, and rebuilt-native regressions pass.

Open uncertainty: representative customer workloads and acceptable latency are
not supplied. Use the available STDF.io fixture and documented synthetic cases
to expose costs without assuming real production distributions.
