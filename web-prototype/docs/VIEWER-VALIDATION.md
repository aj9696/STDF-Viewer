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
