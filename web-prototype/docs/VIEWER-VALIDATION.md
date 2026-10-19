# Browser viewer qualification

This document records correctness and scale evidence for the disposable browser
viewer cache described in [VIEWER-DECODER.md](VIEWER-DECODER.md) and
[VIEWER-CONTRACT.md](VIEWER-CONTRACT.md). Measurements were taken on 25 September
2026 in isolated Windows browser profiles, using SQLite WASM 3.53.4 and local
OPFS storage. The test scripts never open the user's application profile.

The completed cache supports exact population queries without retaining a full
measurement array. Building that cache is still expensive: the 10-million-PTR
workload took **582.680 seconds (9 minutes 43 seconds)** after retained import.
This cold indexing step is the principal measured latency bottleneck. These
measurements do not isolate decoding from SQLite index maintenance and must not
be presented as parser throughput alone.

## Recorded scale results

Each workload below is one run, not a median or a controlled A/B comparison.
Machine load, storage, browser version and source distribution affect timings.
The workloads contain PTR records with repeated declarations, four sites and
100 tests; they do not establish throughput for dense MPR/FTR or retest files.

| Item | 1 million observations | 10 million observations |
| --- | ---: | ---: |
| Source bytes | 93,650,444 | 936,502,821 |
| Device attempts | 10,000 | 100,000 |
| Tests | 100 | 100 |
| Retained import | Not timed by this qualification | 126.233 s |
| Cold viewer cache | 30.519 s | 582.680 s |
| Warm cache preparation | Not timed | 14.277 ms |
| Warm test catalogue | Not timed | 14.094 ms |
| Exact analysis, 100,000 observations | Not applicable | 3.666 s |
| Repeat of identical analysis | Not timed | 3.668 s |
| Device page at offset 5,000, 100 rows plus one test | Checked, not timed | 526.956 ms |
| Parser WASM linear memory after build | 2,752,512 bytes | 2,883,584 bytes |

The 10M analysis computes mean, median, population standard deviation, limits,
capability and 50-bin histograms for one full test population: 100,000
observations, an aggregate series and four site series. Every series' histogram
sum equals its eligible observation count. The repeated result is deeply equal
to the first result. Trend rendering alone uses a reduced set of points.

The 1M cache occupied 135,299,072 bytes on disk. Its query-plan inspection found
no temporary sort for default device order, part ID, test time, head, site or
the ordered value cursor. Default device order uses the device primary key;
the other four orders use their `devices_sort_*` indexes. The value cursor uses
`observations_value` and device primary-key lookups. Device pages at offset
5,000 and the four alternate orders at offset 4,090 complete across the worker's
4,096-row asynchronous yield boundary.

The 10M SQLite WASM linear memory allocation was **12,124,160 bytes after cache
construction** and **21,037,056 bytes after warm queries**. The separate 1M
query-plan worker reported 12,124,160 bytes. These counters measure allocated
WebAssembly linear memory for the respective module. They do **not** measure
live allocations, JavaScript heap, OPFS buffers, renderer processes or total
browser RSS. No claim about total browser peak memory is supported by these
tests. No quota or runtime error occurred in the recorded run.

## Application and export qualification

The subsequent UI simplification was checked in Chrome and Edge using the same
production provider. UI runs `viewer-ui-chrome-1790352275911` and
`viewer-ui-msedge-1790352306825` each pass ten grouped checks. Production runs
`viewer-e2e-chrome-1790352306803` and `viewer-e2e-msedge-1790352306815` each pass
nine workflow groups, including eight-sheet/eleven-PNG reports, scoped plot
picking, device CSV/Excel, workspace restore and download cleanup. These runs
verify collapsed controls, visible population/bounds summaries, initial test
selection and preservation of edited selections on refresh. Desktop and 360px
layouts were visually reviewed. Numerical methods and storage schemas are
unchanged. The [small example qualification](../evidence/examples.json) separately
records the five scenario oracles and their import/open flows.

The portable [qualification summary](../evidence/browser-viewer.json) retains
checks and measurements without requiring ignored local browser profiles.
Final Chrome and Edge production E2E runs each pass nine workflow groups:
all eight views, real PTR/MPR/FTR selection, ordered groups and population
filters, chart-to-device-to-record drilldown, device CSV/Excel, eight-sheet
reports with eleven PNGs, workspace restore into existing and empty libraries,
and generated-file recovery/removal after reload. Both source checksums remain
valid after export cleanup. Each run includes seven reviewed screenshots;
360-pixel checks establish layout behavior, not mobile browser storage support.

Transfer suites each pass 31 cases covering corrupt ZIP CRC and source hashes,
bounded archive validation, cancellation, partial-restore outcomes, literal
Excel strings/images and splitting beyond Excel's row limit. Separate focused
lifecycle tests independently read 253-device/257-DTR workbooks, cancel CSV on
its final page, and check cancellation between PNG captures, duplicate download
URL invalidation and modal closure during an outstanding request. They use
explicit test-only gates; production code has no fault-injection switches.

The UI-only suites use a substitute provider to check focus, cancellation,
notation persistence and missing-font recovery. Chart checks include zoom/pan,
interval endpoints, exact coordinate picking and a 50,000-coordinate rendering
fixture. Those isolated tests supplement, rather than replace, real-provider
E2E. Retained library, recovery, raw Explorer, file/folder queue and startup
regressions also passed. All three product pages explain `file://` launches
and module failures rather than leaving an opening-library spinner.

Final E2E artifacts are `viewer-e2e-chrome-1790338590701/results.json` and
`viewer-e2e-msedge-1790338590904/results.json`. Focused lifecycle artifacts are
`viewer-lifecycle-chrome-1790338304283/results.json` and
`viewer-lifecycle-msedge-1790338337657/results.json`. The evidence summary names
the provider, UI, compression, chart and regression runs separately.

```powershell
node web-prototype/scripts/viewer-e2e-check.mjs chrome
node web-prototype/scripts/viewer-e2e-check.mjs msedge
node web-prototype/scripts/viewer-lifecycle-check.mjs chrome
node web-prototype/scripts/viewer-lifecycle-check.mjs msedge
node web-prototype/scripts/viewer-transfer-check.mjs chrome
node web-prototype/scripts/viewer-transfer-check.mjs msedge
```

The retained import and cold cache are separate persisted stages. Their timings
are not interchangeable with the older streaming parser benchmark, native
desktop importer benchmark or retained-database-only benchmark.

## Independent correctness fixtures

[`make-viewer-populations.py`](../scripts/make-viewer-populations.py) constructs
STDF records with Python `struct`; it does not call the Rust decoder. Its oracle
uses handwritten record/attempt expectations and Python `statistics` for
analytical values. The browser harness checks both little- and big-endian input
through the public data-library API and real SQLite/OPFS storage.

The recorded Chrome and Edge runs cover:

- Exact means, medians and population standard deviations; finite failures
  remain numeric observations, invalid flags and NaNs are excluded, and unknown
  pass/fail status remains distinct from numeric eligibility.
- Base-unit values despite different result and limit display exponents;
  head/site selection and changing limits, including withholding Cpk where a
  population has inconsistent limits.
- Missing tests, repeated execution on one device, invalid numeric results and
  multisite completion order. Device rank follows PIR order, not PRR completion.
- Histogram endpoint drilldown: lower edges are inclusive, interior upper
  edges are exclusive and the final upper edge is inclusive. A separate test
  uses exactly representable R4 values `[-20, 23.5, 55]` with 50 bins: `23.5`
  belongs to bin 29, not bin 28. This catches rounding from a recomputed
  fraction/floor index; every tested bar's count equals its drilldown result.
- The same dataset in two comparison groups, with an additional PartID retest
  in one group. Current/all populations, device drilldown and wafer drilldown
  retain independent group semantics.
- Wafer completion order independent of row/attempt order: two sites start A
  then B, complete B in bin 7 then A in bin 3 at the same coordinate. The map
  selects A/bin 3 and retains both attempts and bin identities. A final Chrome
  test captures the SQL actually prepared by `waferMap` and confirms that its
  pinned SQLite query plan has no temporary sort.
- Cancellation of an incomplete 20,000-observation cache; retry builds a
  complete cache and a subsequent prepare reuses it.
- Restore, verification and viewer-cache creation from an archived finalized
  `retained-v1` package while the current writer uses `retained-v2`.
- Import of a `retained-v2` source with a standards-compliant default-only PTR
  outside a device; export and restore into a fresh profile, then rebuild the
  derived cache with the same population.

The small known-value fixture has eligible main-test values
`[0, 2, 4, 6, 8, 10]`. Head 1 contains `[0, 2, 4, 8, 10]`; head 1/site 1 contains
`[0, 2, 8, 10]`. The additional value `999` is explicitly invalid and a NaN has
preserved raw bits. Separate tests have a sparse execution matrix, so equal
length positional arrays cannot accidentally pass the device-join assertions.

Mixed PTR/MPR/FTR, PMR/pin states, metadata, wafer orientation and default-field
semantics also have Rust decoder tests and hand-encoded browser fixtures; see
[VIEWER-DECODER.md](VIEWER-DECODER.md). The population suite supplements those
tests rather than claiming complete format coverage itself.

## Full device report traversal

`iterateReportDevices(view, {tests})` in `viewer-tables.js` is the internal report
iterator. It yields individual rows with the same fields and repeated execution
arrays as `listDevices().items`, in comparison-group, source and PIR order.
It honors the view's head/site and current/all-attempt selection. Each internal
primary-key page holds at most 100 devices; the iterator performs no count query
or offset scan, finalizes statements before yielding rows, and checks
cancellation between rows and pages. The caller owns the open viewer context.

The independent `report-pages.stdf` fixture contains 5,003 devices, main-test
repeats every seventeenth device and a second test on every third device. The
Chrome qualification checks every generated row and result, compares the page
crossing offset 4,096 with the interactive API, and compares complete small
populations with the interactive API under current/all, head/site and repeated
source/group selections.

The recorded traversal reads exactly 5,003 device rows in 51 queries and 6,966
measurement rows in 102 queries. The largest device page is 100 rows. SQLite
reports 452,597 VM steps and zero full-scan steps for the instrumented device and
matrix statements. Their plans seek the device primary key (`rowid>?`) and
`observations_device (device_id=?)`, with no temporary sort. This qualification
checks traversal work and population correctness; it is not an XLSX throughput
benchmark or a total-browser-memory measurement.

## Reproduction

Run from the repository root after installing the documented Python, Rust,
Node and browser dependencies and building the browser assets. Chrome and Edge
must be installed locally. The harnesses launch headless isolated profiles and
serve the application on an ephemeral loopback port.

```powershell
. ./.venv/runtime-environment.ps1
cargo test --locked --manifest-path web-prototype/rust/Cargo.toml
./web-prototype/build.ps1

# Optional manual inspection; the population harness also generates these.
./.venv/Scripts/python.exe web-prototype/scripts/make-viewer-populations.py .venv/viewer-populations

# Point this at a genuine exported finalized retained-v1 package.
$env:VIEWER_LEGACY_PACKAGE = 'C:/qualification/evaluation-v1.sdlibrary'
node web-prototype/scripts/viewer-population-check.mjs chrome
node web-prototype/scripts/viewer-population-check.mjs msedge
```

The legacy package is deliberately an archived output, not a package generated
with the current writer and relabeled as v1. If the environment variable is
absent, the harness looks for the local archived evaluation artifact at
`web-prototype/results/library-1790294494268/evaluation.sdlibrary`. This ignored
artifact is not part of a clean checkout. Supply a genuine package to reproduce
the compatibility assertion; otherwise that prerequisite is unavailable.

Generate the deterministic large files once. The generator refuses to overwrite
an existing fixture; reuse an existing matching file when rerunning.

```powershell
./.venv/Scripts/python.exe -m benchmarks.generate --duts 10000 --tests 100
./.venv/Scripts/python.exe -m benchmarks.generate --duts 100000 --tests 100

# Adds the 1M cache, deep pagination and EXPLAIN QUERY PLAN checks.
node web-prototype/scripts/viewer-population-check.mjs chrome --plans

# Explicit opt-in: substantial disk space and several minutes are required.
node web-prototype/scripts/viewer-scale-check.mjs chrome 10000000
```

Each harness writes `results.json`, generated fixtures and isolated browser
profiles beneath `web-prototype/results/`. Scale failures also write
`failure.json` with completed stage timings. Do not run scale jobs concurrently
when comparing results. Fixture generation details and sidecar hashes are in
[`benchmarks/README.md`](../../benchmarks/README.md).

## Evidence and boundaries

The recorded artifacts below are local ignored reports. Exact measurements and
scope are preserved above so this document remains useful without their binary
profiles. Chrome was 153.0.8010.48; Edge was 153.0.4234.48.

| Local artifact under `web-prototype/results/` | Evidence |
| --- | --- |
| `viewer-population-chrome-1790336307204/results.json` | Seven grouped checks, including 1M cache/plans and deep pagination; no page errors |
| `viewer-population-msedge-1790336165585/results.json` | Six grouped correctness checks; no page errors |
| `viewer-scale-chrome-10000000-1790336429125/results.json` | 10M retained/cache/warm-query timings, counts, hashes and module memory; no page errors |
| `viewer-population-chrome-1790337704722/results.json` | Eight grouped correctness checks after the indexed retest projection and exact-edge fix; no page errors |
| `viewer-population-msedge-1790337704711/results.json` | The same eight grouped checks in Edge; no page errors |
| `viewer-population-chrome-1790337888281/results.json` | Eleven grouped checks, adding both-endian wafer completion order and the actual wafer SQL plan; no page errors |
| `viewer-population-chrome-1790338329590/results.json` | Thirteen grouped checks, adding report iterator equivalence and bounded 5,003-device traversal; no page errors |
| `viewer-population-msedge-1790338402770/results.json` | The same thirteen grouped checks in Edge; no page errors |

The 10M source SHA-256 is
`c6db5a736bdd12033cd570927375b179a3a2a074c4621101cd3f953b53c4c2d4`.
The 1M source SHA-256 is
`e0d0fcdd68e6c64b39f66ee90f454aaa293659095d30e16b9f9f7bd8c888e68f`.

The cache schema was frozen throughout the 10M run. A subsequent query-only
change replaces temporary retired-device rows with indexed existence checks;
the recorded warm timings and EXPLAIN traces precede that change. The harness
tracks the current query contract, but these historical results must not be
represented as a new performance measurement of later edits. Both final small
browser suites exercise the updated query code; they are correctness runs, not
new throughput measurements.

The current evidence does not qualify Firefox/Safari, mobile devices, a 10M
Edge workload, browser eviction/recovery under forced disk exhaustion, total
browser memory, every vendor's STDF encoding or performance at the 2 GiB
admission limit. Large-scale MPR/FTR and retest-heavy populations still need
separate qualification. A passing synthetic workload establishes its tested
behavior, not complete upstream feature parity or a production ATE acceptance
corpus.


## DLOG engineering workflows — 2026-09-25

The expansion is qualified as a browser engineering implementation. It does
not change the retained source schema or overwrite source snapshots. The
[coverage matrix](../../docs/dlog-coverage.md) records each manual workflow and
its limits; [tools](TOOLS.md) provides the evaluation path. Machine-readable
run references are in [dlog-features.json](../evidence/dlog-features.json).

| Area | Verification |
| --- | --- |
| Numerical studies | Independent little/big-endian STDF fixtures; sparse/repeated/final-invalid test pairing; signed correlation; exact quartiles, Tukey whiskers and CDF ranks; PAT sigma/MAD; balanced crossed R&R oracle; PVT assignments |
| PAT lots and combined rules | Explicit source memberships; per-test limits/bins; source-hash recipe reload; current-attempt retirement across lot boundaries; duplicate-reference rejection; independent rules and first-match precedence |
| Wafer/dashboard | Hand-computed spatial neighborhoods and density; WIR/head isolation; recorded aspect/orientation; filtered coordinate means and contributors; dashboard outcomes, timing and full record inventory |
| Tables and plots | Final-execution numeric ordering with invalid/missing last; query plans without temporary sort; complete/partial catalog exclusion scans; ranges, regression, CDF steps, box hover, visibility and 3D picking |
| Source authoring | Independently parsed emitted bytes in both endiannesses; original hashes; interleaved attempt removal; PRR XY and PTR/MPR edits; linked metadata changes; rebuilt summaries; malformed/stale plan rejection |
| ATDF and conversion | Supported record/flag mapping, UTC offset, malformed input, duplicate imports, cancellation cleanup, exact original-text recovery, CSV/JSON/STDF bundles |
| Documents | Actual PDF/DOCX/XLSX/PNG/JPEG files read independently; source/lot memberships and receipts; page geometry; literal spreadsheet text; chart images; cancellation/batch rollback; rendered PDF/Word inspection |
| Product regressions | Existing library, viewer, device drilldown, Excel report, generated-file inventory and workspace restore workflows; legacy retained-v1/v2 restores; desktop and narrow viewport checks |

Browser checks run in fresh disposable profiles against temporary local origins,
not the engineer's library. Chrome and Edge are both exercised. Pure model,
independent Python artifact readers, actual worker/SQLite providers and product
UI checks have separate roles; a provider-only pass does not establish a control
exists. Rendered pages were inspected after LibreOffice/Poppler conversion.

Independent review found and corrected:

- A filtered-out wafer incorrectly participating in aggregate geometry checks.
- Missing recipe/source provenance in numeric coordinate aggregates.
- Summary plot clicks opening invalid device-detail requests.
- Alias histogram series being combined despite different bin edges.
- Repeated reference sources inflating PAT reference count.
- Word table property ordering, detached image captions and split short rows.

The earlier 1M/10M parser/cache measurements remain historical. New distributions,
screening, authoring and document exports have bounded-fixture correctness
qualification, not measured 10M throughput. Resource limits, unsupported R&R
designs, ATDF record coverage and downstream format dependencies are documented
in their feature guides. No claim is made of an undocumented proprietary
algorithm or an untested vendor-format dialect.

## UI refinement — 2026-10-18

This presentation release refines Library, scope/test selection, chart controls,
tool navigation, PAT, Gauge R&R and workspace actions. Retained source schemas,
worker query formulas, histogram edges and transfer format version 1 are
unchanged. Gauge result exports additionally record the explicit mapping and
UI recipe. All runs below use disposable profiles and synthetic data; they do
not read or reset an engineer's existing browser library.

| Coverage | Chrome artifact under `results/` | Edge artifact under `results/` |
| --- | --- | --- |
| Five examples, import failures/retry/deduplication, empty-library restore entry, keyboard/reflow and long names (9 checks) | `examples-ui-chrome-1792370103109` | `examples-ui-msedge-1792370111875` |
| Viewer routing, scope, state, errors/cancel/retry and bounded catalog (10 checks) | `viewer-ui-chrome-1792369782292` | `viewer-ui-msedge-1792370114910` |
| Charts, legends, picks, extreme values, PNG and 50,000-coordinate bounded display | `viewer-charts-chrome-1792370034302` | `viewer-charts-msedge-1792370034288` |
| Grouped tool navigation, PAT/Gauge forms, inline validation, stale-result invalidation and real JSON exports (17 checks) | `viewer-tools-ui-chrome-1792370091853` | `viewer-tools-ui-msedge-1792370091832` |
| Independent numerical study fixtures (6 checks) | `viewer-studies-chrome-1792369648370` | `viewer-studies-msedge-1792370014873` |
| PAT lot/rule recipes and source provenance (6 checks) | `viewer-pat-recipes-chrome-1792369891932` | `viewer-pat-recipes-msedge-1792370017862` |
| Production worker UI, device drilldowns, actual report downloads and fresh-profile workspace restore (9 checks) | `viewer-e2e-chrome-1792369871776` | `viewer-e2e-msedge-1792370103108` |
| Transfer provider, corruption/cancellation, source integrity and independent XLSX inspection (31 cases) | `viewer-transfer-chrome-1792370157239` | `viewer-transfer-msedge-1792370168130` |

`viewer-localization-chrome-1792370103139` passes reversible English/Korean/Chinese
control translation with literal source strings preserved. Settings persistence
also passes in `viewer-preferences-msedge-1792370106953` (5 checks). New tool group
labels and local validation messages use explicit translations; method prose,
provider diagnostics and guides retain the existing English-only limitation.

The PAT exercise verifies 36 scoped devices, 31 eligible reference results, five
excluded and one flagged at the fixture's sigma settings. Sigma, MAD and manual
limit exports retain the expected decisions. Gauge uses an explicit 3-part ×
2-operator × 3-trial design: repeatability variance 1, reproducibility variance 2,
gauge variance 3 and total variance 103. Missing mapping, malformed/unbalanced
design, duplicate references and reversed manual limits have recoverable errors.
Editing either form removes stale result/export controls once and asks for a
rerun; repeated edits do not repeatedly announce the same status.

Visual checks cover 1440/1280/768/390/360 px layouts, long file/test names, desktop
and narrow study forms, and comparison charts. Wide tables scroll inside their
regions. At a 720×450 effective viewport the Workspace menu scrolls, all four
actions remain keyboard-reachable, and Escape restores trigger focus. This
models the CSS reflow space of 200% zoom on a 1440px display; **actual browser
zoom was not exercised**. Narrow desktop screenshots do not qualify mobile
browser storage, touch devices, screen readers or Firefox/Safari.

Independent review corrected filename clipping without ellipsis and repeated
live announcements after study input changes. Final review found no remaining
high-confidence functional defect. Screenshots and JSON artifacts are local,
ignored build evidence, not new large-file performance measurements. Packaging
and public deployment verification are recorded separately in [DEPLOYMENT.md](DEPLOYMENT.md).

Production release `69d4e51` was subsequently verified at
`https://semidata.pages.dev/` in Chrome and Edge. The separate live runs confirm
packaged asset hashes, example imports, the new controls, full-browser restart
persistence and fresh-profile workspace restore; they do not broaden the
numerical or performance qualification above.

## Taste visual release — 2026-10-18

This pass changes visual presentation and the default display font. No parser,
storage schema, query provider or analytical formula changed. Existing system
and local font preferences remain supported; a focused browser regression loads
the bundled Plex face and verifies that saved Consolas overrides both text and
identifier typography. The source revision is recorded in the deployment manifest.

| Suite | Chrome | Edge |
| --- | --- | --- |
| Five example workflows and responsive Library/comparison | 9 passed | 9 passed |
| Production STDF E2E, picks, CSV/XLSX and workspace round trip | 9 passed | 9 passed |
| Study tools, PAT and balanced Gauge R&R | 17 passed | 17 passed |
| Display preferences and bundled/saved fonts | 6 passed | 6 passed |
| Viewer routing, safe text, cancellation and recovery | 10 passed | Not repeated this pass |
| Chart limits, picks, PNG and 50k-die bounded rendering | 12 passed | Not repeated this pass |

The production E2E export contains all eight expected sheets and 11 chart PNGs;
both original sources retain their hashes after reports, workspace restore and
generated-file deletion. Neither browser reported JavaScript errors.

Evidence directories under ignored `web-prototype/results/`:

- `examples-ui-chrome-1792374530260`, `examples-ui-msedge-1792375038178`
- `viewer-e2e-chrome-1792374768736`, `viewer-e2e-msedge-1792374835585`
- `viewer-tools-ui-chrome-1792374531289`, `viewer-tools-ui-msedge-1792374835613`
- `viewer-preferences-chrome-1792374768766`, `viewer-preferences-msedge-1792374835615`
- `viewer-ui-chrome-1792374703113`, `viewer-charts-chrome-1792374438291`

Taste static lint and browser inspection of empty Library and a real two-source
STDF comparison pass with no failures at 1440/768/390px. Screenshots, reports and
the selected direction are under `taste-product-direction/`. Early Chrome example
captures exposed an SVG test-server MIME issue and an encoded text chevron;
these were fixed with inline SVG and a CSS chevron before the subsequent viewer
and Edge runs. Independent review corrected mobile action heights and font-error
recovery wording. Final design decisions and warning explanations are in
[DESIGN-SYSTEM.md](DESIGN-SYSTEM.md). Existing zoom, device and browser qualification
limits above remain applicable.

The example screenshot helper now waits two animation frames after viewport
changes, allowing responsive catalog collapse and canvas resize to settle. This
corrects an Edge full-page capture artifact; the settled page did not have a scroll
gap. The final Edge example run above passed after this harness correction.

The published `7fecc60` release also passed independent Chrome/Edge checks against
the stable public origin, including exact asset hashes, all five local font faces,
MIME headers, source-preserving example import and fresh-profile workspace restore.
See the deployment record for the immutable revision and final screenshot paths.

## All-test statistics and help — 2026-10-18

Implemented against `STATISTICS-AND-HELP.md`; help writing/interaction policy is
in `VIEWER-HELP.md`. The existing framed-sheet design is retained.

Local verification passed:

- `viewer-summary-model-check.mjs`: global numeric sorting with missing values
  last in both directions; search and pagination; partial cancellation/resume
  without duplicate batches; empty scopes and FTR numeric suppression.
- `viewer-summaries-check.mjs chrome` and `msedge`: six provider check groups,
  both byte orders, exact equality with chart analysis, independent moments,
  invalid values and changing limits, filters, retests, independent groups,
  unresolved identities, compact catalog equivalence, request bounds and
  cancellation during both scans and between tiny tests.
- `viewer-ui-check.mjs chrome` and `msedge`: all 53 identities without checkbox
  selection, numeric sorting across page boundaries, cached search/paging,
  no-observation rows, exact test-to-histogram drilldown, cancellation after ten
  completed tests and resume of the remaining 43, and scope/series invalidation.
- `viewer-e2e-check.mjs chrome` and `msedge`: ten population rows for five real
  PTR/MPR/FTR identities in two groups. All counts and physical numeric moments
  match full analysis. Existing selected statistics, device matrix, nested
  source drilldown, eight-sheet XLSX with eleven PNGs, source checksum checks,
  workspace restore and reload persistence still pass.
- `viewer-help-check.mjs chrome` and `msedge`: 27 topics including all fifteen
  tools; context selection, related topics, keyboard trapping, modal isolation,
  focus return, internal scrolling, reduced motion, and 44px mobile controls.
  The conservative sentence-length check passes; it is not an STE dictionary or
  conformance audit.

Desktop and 360px all-test screenshots were inspected. Wide tables stay inside
scrollable regions with a fixed identity column. Help screenshots were inspected
at 1440, 768, 390 and 360px; the reading column and persistent Close/Topic controls
fit. No new large-file timing claim or actual browser-zoom qualification is made.

Independent review corrected empty CSS class tokens, unnecessary catalog pin
metadata retention, response-sized batches, full chart cache growth after table
navigation, and generic retry behavior after cancellation. Help review corrected
control names, site-series scope and test-limit/specification-overlay language.

Evidence directories under `results/`:

- `viewer-summaries-chrome-1792376476086/`, `viewer-summaries-msedge-1792376476082/`
- `viewer-ui-chrome-1792376634238/`, `viewer-ui-msedge-1792376634235/`
- `viewer-e2e-chrome-1792376634242/`, `viewer-e2e-msedge-1792376634238/`
- `viewer-help-chrome-1792376593500/`, `viewer-help-msedge-1792376593492/`

Public deployment is qualified separately in `DEPLOYMENT.md`.

## Yield Manager — 2026-10-19

The new tab is qualified with synthetic data in disposable browser profiles.
No engineer's browser library is cleared or used as a test fixture.

- `viewer-yield-check.mjs chrome` and `msedge` import independently generated
  STDF through the real worker. Both byte orders, source metadata, null dates,
  missing bins, unknown outcomes, group/head/site/current/all scope, invalid
  filters, cancellation and retry pass. Traced SQL confirms one device scan and
  no observation reads. Every source, site, outcome and failing-bin count agrees
  with the corresponding Devices query. Virtual-cursor boundary checks accept
  exactly 4,096 site buckets, 32,768 bin buckets and 4 MiB UTF-8; each next value
  is rejected with an actionable error and finalized statements. No large fixture
  is needed for these resource-limit checks. Later-source replacements remain active
  when the drill-down restricts the displayed source rows.
- `viewer-yield-model-check.mjs` checks weighted yield, exact cohort identities,
  missing-lot isolation, independent groups, search, numeric sorting and UTC
  chronology. Zero known outcomes remain null.
- `viewer-yield-ui-check.mjs chrome` and `msedge` cover cached controls, exact
  source/bin/site drill-down, head/attempt invalidation, chart-series independence,
  cancellation/retry, keyboard help, plot-point activation and resize focus,
  360px layout, reload and workspace-state restoration. Both breakdown tables
  page through 53 bins/sites as 50 then 3, retaining the full failure denominator.
  The current-attempt scope warning names only groups that require review.
  A second context uses
  production Rust/WASM and SQLite: 8 current attempts = 3 pass + 3 fail + 2
  unknown, giving 50% yield. The failed unrecorded-bin drill-down returns F and
  excludes unknown-outcome D.
- Existing `viewer-ui-check.mjs`, `viewer-e2e-check.mjs` and
  `viewer-help-check.mjs` pass in Chrome and Edge. The real E2E now opens all
  nine tabs; selected tests, numerical statistics, reports with eleven PNGs,
  portable workspace restore and original source hashes remain correct. Help
  now covers 28 topics under the existing controlled-English policy.
- Existing `viewer-population-check.mjs chrome` passes after the additive
  device-filter change.

Independent code review corrected the progress label during long device scans
and an image-export API assumption about chart cleanup handles. Screenshot
review found that a global SVG icon rule collapsed the new chart to 20px;
the scoped 190px chart height is now asserted in both browser suites. Desktop
and phone screenshots were inspected after this correction. Tables scroll
within their own regions; plot axes and date labels remain readable.

Evidence under `results/`: `viewer-yield-chrome-1792410993292/`,
`viewer-yield-msedge-1792410993292/`,
`viewer-yield-ui-chrome-1792411023391/`,
`viewer-yield-ui-msedge-1792411031505/`,
`viewer-ui-chrome-1792410738468/`, `viewer-ui-msedge-1792410757876/`,
`viewer-e2e-chrome-1792410738452/`, `viewer-e2e-msedge-1792410757879/`,
`viewer-help-chrome-1792410642010/`, `viewer-help-msedge-1792410738461/`.

No new large-file throughput or actual browser-zoom qualification is claimed.
Public deployment is recorded separately in `DEPLOYMENT.md`.

## Library organization and report filters — 2026-10-19

Checks use synthetic data and disposable browser profiles. No engineer's library
is reset or used as a test fixture.

- `library-metadata-unit.mjs` verifies normalization, missing/malformed MIR,
  4,096-record bound, early stopping, cancellation and cache failure tolerance.
  `library-metadata-check.mjs chrome` and `msedge` verify retained-v1/v2 and both
  byte orders, missing fields, persistent cache reuse without dataset access,
  signature invalidation, unavailable-source recovery and legacy package restore.
  No viewer cache is created by Library metadata reads.
- `library-organize-check.mjs` checks grouping, UTC chronology, metadata search,
  unknown dates and atomic eight-file selection. `library-organize-ui-check.mjs`
  passes in Chrome and Edge: selection across pages/search/groups, keyboard
  focus, remove/clear controls, selection bounds, real WASM/SQLite import metadata
  in Library and Details, and two-file navigation into independent Viewer groups.
  Screenshots at 1440, 768, 390 and 360 pixels were inspected. Existing
  `frontend-check.mjs chrome` passes all fifteen regression groups.
- `viewer-report-filter-check.mjs chrome` and `msedge` verify all/current attempts
  with all/non-failed/pass outcomes, matching overview/device/analysis/bin/map/
  dashboard counts, a failed later retest, unknown and empty populations,
  cancellation, invalid/unsupported options and original-source preservation.
  Five generated XLSX workbooks per browser are inspected independently using
  Python ZIP/XML, including a mandatory scope sheet without File Info. Unowned
  datalog notes and original PCR summaries remain labelled source context.
- `viewer-report-filter-ui-check.mjs chrome` and `msedge` collect real filtered
  documents and inspect PDF, Word, Excel and PNG exports. Filter provenance
  survives omitting Summary. The Reports form forwards the selected outcome
  scope. The investigation modal passes the same scope to six embedded PNG
  charts and workbook tables; a new dialog resets to All devices. Raw-record
  exports hide the report filter. Saved workspace selection remains unchanged.
  The actual Viewer modal fits 360 pixels; keyboard selection and Escape work.
- Existing `viewer-e2e-check.mjs`, `viewer-documents-check.mjs` and
  `viewer-help-check.mjs` pass in Chrome and Edge. Nine tabs, the original
  eight-sheet/eleven-image default workbook, workspace save/restore, document
  formats, and controlled-English help remain correct. Existing population and
  lifecycle suites also pass in Chrome.

Independent review corrected File Details metadata handoff. Accessibility review
added concise labels to report selectors. The report filter is ephemeral; source
databases, parser versions and portable-package schemas require no migration.
No new large-file throughput or mobile storage qualification is claimed.

Evidence under `results/` includes `library-metadata-1792421252512/` (Chrome),
`library-metadata-1792421264775/` (Edge),
`library-organize-chrome-1792421496236/`,
`library-organize-msedge-1792421507566/`,
`viewer-report-filter-chrome-1792421317359/`,
`viewer-report-filter-msedge-1792421331228/`,
`viewer-report-filter-ui-chrome-1792421684419/`,
`viewer-report-filter-ui-msedge-1792421693520/`,
`viewer-e2e-chrome-1792421501900/`, `viewer-e2e-msedge-1792421501910/`,
`viewer-documents-chrome-1792421541238/`,
`viewer-documents-msedge-1792421552217/`,
`viewer-help-chrome-1792421501902/`, `viewer-help-msedge-1792421541242/`.
Public release provenance is recorded in `DEPLOYMENT.md`.
