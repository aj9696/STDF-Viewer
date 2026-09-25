# STDF-Viewer browser parity tracker

Reference: upstream commit `b8deaad8eecf860676183825ac0089cf6c4b0ba3`.
Scope and analytical rules: [browser viewer specification](../SPEC-browser-viewer.md).
Status: browser investigation baseline implemented, 2026-09-25. Delivered means
the browser workflow exists with the boundaries below, not identical desktop
format, appearance or numerical bugs. See the [engineer guide](../web-prototype/docs/VIEWER-UI.md),
[methods](../web-prototype/docs/VIEWER-METHODS.md) and
[qualification record](../web-prototype/docs/VIEWER-VALIDATION.md).

| Working upstream feature | Browser delivery | Status |
| --- | --- | --- |
| Raw V4/IEEE byte orders | Existing retained source import | Delivered |
| Gzip, bzip2, single-file ZIP | Bounded local decompression with checksums and expansion limits | Delivered |
| Multi-file / folder / drop | Sequential product import queue with per-file outcomes | Delivered |
| Ordered merge groups and comparison | Up to eight groups/eight distinct sources; ordered logical membership | Delivered |
| File information | MIR/MRR and per-source record metadata | Delivered |
| Device summary / retest marking | Filtered, sortable, paged device table and explicit PRR replacement rules | Delivered |
| GDR/DTR summary | Searchable decoded datalog and original-record access | Delivered |
| Test list / search / failure marker | PTR/MPR/FTR catalogue; literal/wildcard and number/name/original ordering | Delivered |
| Multiple tests / head / site selection | Up to twelve selected tests with explicit population controls | Delivered |
| Test summary across devices | Paged selected-test matrix preserving repeated executions | Delivered |
| Test statistics and low-Cpk marker | Exact median/population sigma/Cpk; cancellable whole-catalog health scan | Delivered |
| Trend / dynamic limits / data picking | Reduced display/full-population picking; zoom and pan | Delivered |
| Histogram / Gaussian / sigma overlays | Common edges, mean/median/spec/limit/3/6/9-sigma overlays | Delivered |
| Hardware / software bin charts | Scoped names/counts/percentages and device drilldown | Delivered |
| Wafer maps / stacked fail map | Oriented die maps with coordinate drilldown | Delivered |
| Detailed selected DUT data | All observations/flags; transpose displayed page; full CSV/Excel export | Delivered |
| Excel report, eight section types | Streaming workbook, chart PNGs, literal cells and automatic sheet splitting | Delivered |
| Save / load session | Portable `.sdworkspace`, source verification and fresh-library restore | Delivered, browser format |
| Chart settings / colors / custom font | Persisted preferences, notation and local TTF/OTF | Delivered with differences below |
| STDF record converter | Record workbook with decoded fields and exact raw hex | Delivered |
| Debug record reader / diagnostics | Original-byte inspection and workspace diagnostic JSON | Delivered |

Native OS file association, Qt widgets and native `.db` cache files require
browser equivalents rather than binary/UI compatibility. Upstream PP/QQ,
correlation and boxplots are hidden placeholders, not completed features.

## Intentional differences and limits

- The UI is English-only. It uses colored series and explicit legends rather
  than desktop per-file marker symbols. Histograms use vertical counts and
  common edges; desktop config-only horizontal/peak-normalized bars are not
  exposed. Adaptive, fixed and scientific numeric notation are supported.
- Native `.db` sessions are not interchangeable with `.sdworkspace`. Browser
  sessions include original source data and rebuild derived indexes after
  restore. Local font binaries are not embedded; a missing font falls back to
  Segoe UI with a notice. This build has no native file association.
- Numerical differences are documented: base-unit calculations, excluded
  invalid/nonfinite values, repeated executions preserved, unresolved identity
  isolation, explicit retests and unavailable changing-limit/zero-spread Cpk.
- Admission is bounded to 2 GiB per raw or expanded source. The retained layer
  requires complete MIR/PIR/PRR/MRR structure and supports documented orphan
  default-only PTR declarations; arbitrary orphan MPR/FTR are rejected. This
  is not a guarantee of compatibility with every vendor STDF variant.
- The 10M PTR workload passed, but cold viewer indexing took 9m43s after import.
  Warm access is much faster. Dense MPR/FTR, retest-heavy scale, Firefox/Safari,
  total browser peak memory and production disposition remain unqualified.
- PAT recipes, historical monitoring, SPC, correlation and enterprise/server
  functions remain separate product work. They are not working upstream viewer
  features promised by this increment.
