# Changelog

## Browser preview — unreleased

- Simplify Library and Viewer navigation, open files directly into a chart, and
  place advanced controls and technical detail behind disclosures. Active filters
  and warnings remain visible.
- Add five small synthetic STDF examples with a picker, direct downloads,
  deterministic generation and checked expected outcomes.

- Add Data viewer with ordered file groups, PTR/MPR/FTR catalog, device matrix,
  full-population statistics, interactive trend/histogram, bins, wafer/stacked
  maps, original records and cancellable test-health scans.
- Add compressed and multi-file/folder imports, settings/fonts, eight-section
  Excel reports with charts, full device CSV/Excel, record conversion, portable
  `.sdworkspace` save/restore and generated-file cleanup across reloads.
- Preserve retained-v1 compatibility; new retained-v2 imports admit documented
  default-only PTR declarations. Disposable viewer caches preserve original data.
- Document population/units/retest rules, desktop differences, independent
  browser qualification and the measured large-file cold-index bottleneck.

- Explain direct `file://` launches before opening storage; replace app-module
  loading failures with explicit recovery guidance instead of a permanent spinner.

- Add Test Explorer to the saved-dataset overview: literal test search, recorded
  PTR declarations and paged observations with attempt IDs and raw flags.
- Preserve omitted/empty fields and IEEE-754 special values in the display;
  effective defaults, scaling and analysis remain separate design work.
- Add bounded read-only queries with existing test/device indexes and explicit
  limits for restored inventories. Existing databases need no migration.
- Record Chrome/Edge verification and the engineer workflow in the
  [Test Explorer guide](web-prototype/docs/TEST-EXPLORER.md).

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
