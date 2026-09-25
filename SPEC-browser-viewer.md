# Browser data viewer

Status: implemented engineering baseline, 2026-09-25; qualification and explicit
differences are recorded in docs/viewer-parity.md. This specification supersedes
the earlier browser restriction to logistics and raw PTR inspection. The engineer
authorized implementing the working feature set of the original STDF-Viewer.

## Baseline and outcome

Reference: preserved upstream source at
`b8deaad8eecf860676183825ac0089cf6c4b0ba3`, `README.upstream.md`,
`STDF-Viewer.py` and `deps/rust_stdf_helper`. The browser application must support
the documented working investigation workflows without a Python server or data
uploads. Hidden, unimplemented upstream PP/QQ, correlation and boxplot controls
are not features to copy. PAT recipe development remains a separate product
capability; this request does not imply qualified production screening.

## Capability map and dependency order

| Module | Owns | Depends on |
| --- | --- | --- |
| viewer-decoder | Streaming PTR/MPR/FTR normalization, effective declarations, record metadata | pinned rust-stdf, immutable source |
| viewer-cache | Disposable, versioned local SQLite indexes; cancellation and rebuild | viewer-decoder, browser-library |
| viewer-query | Explicit populations, comparisons, device/test/record tables and bounded chart data | viewer-cache |
| viewer-charts | Trend, histogram, hardware/software bins, wafer maps and data picking | viewer-query contracts |
| viewer-workspace | Ordered file groups, filters, selected tests, settings, local session document | browser-library, viewer-query |
| viewer-transfer | Compressed input, portable sessions, tabular/chart reports and record conversion | browser-imports, browser-transfer, viewer-query |
| viewer-ui | Accessible investigation screens, progress, error recovery and exports | all providers above |

Provider contracts are fixed before their consumers. Preserve the existing raw
Test Explorer as an audit view. Introduce `viewer.html` and link it from the data
library. Keep the app origin and existing datasets intact.

## Data preservation and compatibility

The retained-v1 source snapshots, catalog, databases and portable packages are
unchanged. New analysis indexes are derived caches in separately named SQLite
files keyed by dataset ID, source SHA-256 and viewer-cache version. They are
never the only copy of data. Build incrementally, publish a completion marker
last, and rebuild incomplete/incompatible caches from the retained source.
Cancellation, crashes and cache rebuild failures must leave the saved dataset
available. Portable dataset packages remain compatible; caches can be rebuilt
after restore. An upstream native `.db` session is a different format and must
not be mistaken for a browser package.

Current imports use retained-v2 with the same schema, admitting only documented
unexecuted/default-only orphan PTR declarations. Readers/restorers support v1
and v2. Duplicate identity includes parser version, so reimporting a v1 source
under v2 can create a separate dataset instead of silently rewriting it.

Raw result bits, flags, record sequence, device attempt identity and original
records remain available. Analytical normalization must not overwrite them.
Normalize MPR result channels individually with their PMR association where
recorded; preserve unmapped channels explicitly. FTR charts show test status
flags, labelled as such, never a fabricated physical measurement.

## Populations and numerical rules

Selection explicitly includes ordered source groups, head/site filters and
current/all attempts. Default current attempts excludes earlier attempts only
when a later PRR explicitly supersedes the same scoped identity. Repeated part
names alone do not establish retest replacement. Group order matters. Part
identity is scoped to group/head/site; wafer coordinates also require wafer
context. Different groups are independent comparison populations.

Tests are matched by record family, test number, effective name, engineering
unit and MPR channel. Do not combine incompatible units. Distinguish recorded
values from inherited defaults, unknown metadata and per-observation changing
limits. Flag-invalid or nonfinite results are counted but excluded from numeric
statistics; failed valid measurements remain included. Show excluded counts.
Unknown pass/fail is separate from pass and fail.

Use stable streaming moments and population standard deviation, matching the
upstream descriptive convention. Cpk requires finite, constant, ordered low
and high limits and nonzero spread; otherwise give a reason instead of a
misleading infinity. Histograms default to 30 equal-width bins, include the
rightmost endpoint, and disclose range and excluded values. Comparisons use
common bin edges. Trend display reduction must preserve extrema and report
the full observation count. Picking a displayed interval queries the full
population, not only reduced points. No full-population array in the UI.

## Workflows and acceptance

1. Open raw or gzip/bzip2/single-file unencrypted ZIP STDF, multi-select files,
   drop files, import a folder, and reopen saved data. Show bounded progress,
   duplicate identity, cancellation and per-file outcomes.
2. Create ordered logical groups for merging and compare groups. Original files
   remain independent saved datasets; grouping does not concatenate STDF bytes.
3. Inspect file information, device summary, selected-test summary, GDR/DTR and
   full decoded/raw records. Search, sort, filter and paginate without loading
   an entire large table into the DOM. Show failed/superseded/unknown status.
4. Select one or more PTR/MPR/FTR tests and heads/sites, view statistics, trend
   and histogram, change chart settings, highlight failing or low-Cpk tests,
   and drill into devices from tables or plot selections.
5. View hardware/software bin counts, names, percentages and pass/fail labels;
   view individual wafer soft bins and stacked fail-count maps, including
   orientation and coordinate provenance. Selecting a bin or die opens devices.
6. Export chosen report sections, test/device tables, chart images and a record
   conversion workbook. Exported populations/settings/source hashes are stated.
   Save/open a portable workspace session including original data and settings.
   Local font selection and chart/site/bin colors are persisted.
7. Provide professional user, methods, architecture and compatibility guides,
   plus a parity matrix whose status reflects tested behavior.

## Verification

Independent byte fixtures cover both byte orders, PTR default inheritance and
changing limits, MPR pins, FTR flags, mixed heads/sites, superseding PRRs, wafer
orientation, empty/nonfinite/constant data and unsupported/malformed records.
Real Chrome and Edge checks use isolated profiles and temporary origins, never
fault-inject into the engineer's library. Verify retained-v1 reopen/export/restore
and raw Explorer regressions. Exercise interrupted cache construction, compressed
checksums/expansion bounds, cross-file populations and report contents. Measure
the 1M/10M path after implementation and distinguish cold indexing, warm queries,
plot reduction and import timing. Record remaining qualification limits honestly.
