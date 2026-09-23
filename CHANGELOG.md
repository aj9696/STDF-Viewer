# Changelog

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
