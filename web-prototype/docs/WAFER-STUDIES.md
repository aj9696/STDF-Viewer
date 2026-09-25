# Wafer studies and dashboard contracts

These providers implement the documented open methods below. They do not claim
numerical equivalence to a proprietary DLOG implementation. Source records and
bins remain unchanged until a separate explicit authoring workflow creates a
derived file. See [coverage](../../docs/dlog-coverage.md).

## Wafer values

`waferValues(view, {testKey, waferKey, bounds?, limits?})` takes a numeric PTR/MPR
identity and a wafer key from `listWafers`. Optional bounds are inclusive
`{x:[minimum,maximum], y:[minimum,maximum]}`. Optional preview limits are
`{low:number|null, high:number|null}`, with at least one finite side.

The shared population iterator respects the current source groups, head/site
selection and current/all-attempt policy. It selects the **final execution** of a
test before applying the existing flag/finite eligibility rule. An invalid final
execution has no displayed value; an earlier valid result is not substituted.
At repeated coordinates, the highest selected PRR sequence supplies the displayed
die, including when its measurement is missing or invalid. Original attempts
remain available in the device table.

Return values include `method`, `test`, `wafer`, recorded `orientation`,
`population`, `provenance`, `cells`, `summary`, `histogram`, `bounds`, `limits`,
`omittedCoordinates` and `warnings`. Each cell identifies group, source dataset,
device, PRR, head/site, WIR, XY, outcome, bins, final record and result ordinal.
`missing` and `invalid` are distinct; `value` and `inRange` can be null.
`inRange` uses inclusive limits and does not change the tester's outcome.

Summary moments, exact median and a 30-bin histogram describe displayed valid
coordinate values. Sigma is population sigma. Outcome counts describe latest
displayed coordinate outcomes, independently of numeric eligibility; yield is
pass/(pass+fail), excluding unknown outcomes. `attempts` counts all selected
attempts represented by displayed coordinates. Missing coordinates are counted
separately. A map is limited to 50,000 distinct coordinates; it rejects an
oversized request rather than silently sampling or cropping.

## Gallery

`waferGallery(view, {testKey?, mode, sort, offset, limit})` supports `bin`,
`passFail`, `value` and `3d`; the latter two require a numeric test. `sort` is
`file` or ascending `yield` (unknown yields last); `limit` is 1–12, default 8.
The returned `tiles` carry wafer identity/orientation, outcome rollups and cells.
`total`, `offset` and `nextOffset` support paging. `summary` gives count and
unweighted mean/min/max wafer yields across the selection. `range` gives the
common numeric color range across the displayed page, not all hidden pages.

Tile headline yield counts all selected attempts in that wafer. Its map uses
the latest attempt at each coordinate. The distinction is reported in a warning.
No wafer populations are merged at matching coordinates. A whole returned page
is capped at 50,000 coordinates. Reduce its page size for large wafers.

## GDBN and cluster previews

`spatialScreening(view, options)` returns `recipe`, `counts`, `decisions`, source
provenance, selected population, omitted coordinate counts and warnings. An
optional `waferKey` restricts it to one wafer. At most 50,000 coordinates across
the request are retained. Each coordinate is scoped by **group, source, WIR and
head**; tests from different sites share physical wafer coordinates only within
that exact scope, with the last selected PRR representing a repeated location.

Only known-pass and known-fail dies outside `exemptBins` form the neighborhood.
Unknown, missing-coordinate and exempt dies are neither passing evidence nor
reclassification candidates. Missing grid positions are not fabricated.

The recipe parameters are:

| Parameter | Allowed values/default | Meaning |
| --- | --- | --- |
| `method` | `gdbn` / `cd` | Open screening method |
| `radius` | 1–10, default 1 | Recorded coordinate-step radius |
| `connectivity` | 4 or 8, default 8 | Manhattan distance for 4; Chebyshev for 8 |
| `minNeighbors` | 1–440, default 1 | Minimum known neighbors for GDBN |
| `minFailNeighbors` | 1–440, default 3 | Failing neighbors needed for GDBN |
| `minCluster` | 1–50,000, default 3 | Connected failed members required for CD |
| `failFraction` | 0–1, default 0.5 | Inclusive CD neighborhood threshold |
| `calcMode` | `uniform` / `weighted`, default uniform | CD density weighting |
| `exemptBins` | Soft-bin numbers | Exclude those dies from references and decisions |
| `failBin` | 0–65,534, default 7 (GDBN),9 (CD) | Proposed software failure bin |

**GDBN (`known-neighbor-count`):** for each known-pass die, inspect all existing
eligible neighbors within the chosen radius, excluding the candidate itself.
Flag it if both minimum-neighbor and minimum-failing-neighbor counts are met.
The result is a single simultaneous pass: newly flagged dies do not seed further
failures during the same preview.

**CD (`failed-component-neighborhood`):** form connected components of known-fail
dies using immediate four/eight adjacency. A component must meet `minCluster`.
Its footprint is the union of its members and existing eligible dies within
`radius` of any member. Uniform density is failed dies / eligible footprint
dies. Weighted density assigns each footprint die weight
`1/(1 + distance to nearest component member)`; members have weight 1. The
numerator sums weights of failed dies and the denominator sums all eligible
weights. Components whose density meets `failFraction` flag every known-pass
die in their footprint and propose remapping failed dies not already in the
target bin. Multiple qualifying components deduplicate decisions and retain
their cluster IDs. Decisions do not seed new components.

`counts.flagged` counts decisions, including changed bins on already-failed
dies; `counts.newlyFailed` counts only prior known-pass dies. `screened` is
known-pass candidates for GDBN, or failed members of size-qualified components
for CD. This exact method is disclosed because the manual's “Weighted” screenshot
does not specify a formula.

## Dashboard and file/lot ranking

`dashboard(view, {topFailures?, failLimit?, waferPreview?})` returns scoped totals,
per-group/head/site summaries, per-source file rows, lot rows, timing, ranked
failure tests, hardware/software bin data and the first wafer preview.
`topFailures:false` or `waferPreview:false` skips the corresponding extra scan.

Group populations are independent; an overlapping source counts once per group
in dashboard totals. Lot rows group by group and exact MIR lot ID. Missing lot
IDs remain source-specific. Differing part/program labels remain visible.
Yield uses known outcomes. PRR times are milliseconds, include recorded zeros,
and are never represented as elapsed wall-clock time; file start/end times come
from MIR/MRR. File yield ranking is ascending with unknowns last. The separate
mean-file yield is unweighted; aggregate yield is weighted by known outcomes.

Failure ranking counts both failed executions and distinct failing attempts
per test identity, preserving group and channel/unit/name identity. Invalid
unknown test outcomes are not counted as known failures. A die can fail several
tests. The scan is bounded to 20,000 failing test identities and returns up to 200
ranked items (default 20). It scans indexed observation/device joins; no full
measurement array is assembled in JavaScript.

`deviceTrends` contains a test-time and cumulative known-outcome-yield series
per logical group, scanned in group/source/PIR order. `timePoints[].value` is
recorded PRR milliseconds; `yieldPoints[].value` is cumulative pass/(pass+fail),
a fraction 0–1. Unknown outcomes never enter its denominator. Points retain
source/device identity and group device index. Bounded first/last/min/max
sampling draws each trend while full counters supply exact summary totals;
`reducedTime` and `reducedYield` explicitly indicate display reduction.
`timingCount` and `yieldPointCount` are full input counts before display
reduction; report captions use them rather than the number of retained points.

Per-file `softBins`/`hardBins` percentages and cumulative shares are fractions
0–1. The existing chart API under `bins.soft`/`bins.hard` uses percentages 0–100.
Do not confuse the two formats when rendering.

`recordSummary(view, {datasetId?})` counts every original record type using the
verified cache's complete parser record inventory. It returns totals, names,
per-source contributions and unknown numeric type/subtype names. It deduplicates
sources appearing in multiple groups and deliberately ignores device filters:
record inventory is a property of the complete source. Record drilldown reads
the original retained source; metadata-only rows are not a substitute.

## Qualification

Run from the repository root:

```powershell
node web-prototype/scripts/wafer-studies-check.mjs
node web-prototype/scripts/wafer-studies-browser-check.mjs chrome
node web-prototype/scripts/wafer-studies-browser-check.mjs msedge
```

The pure suite hand-checks spatial boundaries, radius/connectivity, exclusions,
missing/unknown behavior, density and weighting, repeated coordinates, numeric
summaries, limits, cancellation and resource caps. The browser suite imports
independent Python-built little/big-endian STDF bytes in an isolated temporary
origin and checks the actual WASM/SQLite/provider pipeline. It includes separate
WIR/head populations at the same XY, repeated and invalid final executions,
missing tests/coordinates, gallery ordering, exact dashboard counts, time units,
failure ranking and every original record count. Outputs stay under ignored
`web-prototype/results/`; no user browser data is read or changed.

The old 10M-parser/index timings do not qualify throughput or peak memory of
these new studies. Browser UI integration and renderer checks are additional
to these provider tests.
