# Changelog

## 0.1.1 — 2026-09-24

- Read preflight input in bounded chunks and avoid a redundant copy for raw
  STDF; preserve compression detection by content, including misleading suffixes.
- Preserve compact PTR identity and default metadata when TEST_TXT is physically
  omitted and the prior name is unambiguous; reject ambiguous omissions.
- Index prior-attempt lookups lazily for PartID and die-coordinate retests.
- Add deterministic million/ten-million-measurement benchmarks, phase timing,
  memory evidence, and exact/sampled correctness comparisons.
- Add an isolated Rust/WebAssembly worker experiment for local browser scans.
  Persistent browser databases and PAT are not implemented in that experiment.

See [performance evidence](docs/import-performance.md) and the
[compatibility policy](docs/methods.md). Existing imported databases are not
rewritten; reimport affected compact sources into a fresh workspace.

## 0.1.0 — 2026-09-23

First local engineering evaluation release of SemiData Workbench.

- Persistent source library with byte-level deduplication, validated STDF imports,
  immutable snapshots, and restart persistence.
- Scalar PTR comparison, site/attempt filters, distribution/ordered plots, and
  documented descriptive statistics.
- Single-pass mean/SD and median/MAD PAT experiments with selectable references,
  saved recipes/evidence, and affected-measurement CSV exports.
- Local browser interface, deterministic STDF examples, and evaluation guide.
- Preserve PTR parameter flags through Rust batch ingestion for data validity.
- Native parser, calculation, persistence, and HTTP regression tests.

Known scope: engineering evaluation; PTR only in the new UI; no cross-file
retest consolidation, production rebinning, qualified DPAT, or enterprise server.
The upstream desktop viewer remains available for its existing workflows.
