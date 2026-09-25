# Upstream viewer behavior

Source inventory, 2026-09-25. This document records the working desktop baseline
for [the browser viewer specification](../SPEC-browser-viewer.md). It is not a
claim that the browser already implements each capability. The preserved
upstream baseline is `b8deaad8eecf860676183825ac0089cf6c4b0ba3`;
`README.upstream.md` and the desktop Python sources are authoritative for UI
behavior. Rust references describe the corresponding local importer semantics.

## Working feature inventory

| Capability | Behavior and defaults | Source evidence |
| --- | --- | --- |
| Open and compare | V4/V4-2007; raw, ZIP, gzip, bzip2; ZIP documented as one unencrypted member. Toolbar, drag/drop, OS open. Multiple inputs compare in separate panels. Ordered merge groups act as logical datasets and can be compared. | [README](../README.upstream.md), lines 98–124 |
| Test identity | Number + name by default; optional number-only import identity. Each MPR PMR is separately selectable. Duplicate identities across files share a list entry; conflicting PTR/MPR/FTR families for one identity are rejected. | [SharedSrc](../deps/SharedSrc.py):99–115; [DatabaseFetcher](../deps/DatabaseFetcher.py):144–182 |
| Test selection | Extended multiselection; case-insensitive wildcard search; original, number or name ordering. Selection carries number, PMR and name. | [STDF-Viewer](../STDF-Viewer.py):151, 597–623, 822–840, 934–944 |
| Populations | Head/site checkboxes. Fresh UI selects All Sites and all heads; individual sites start unchecked. All Sites is a separate aggregate series that may coexist with individual sites. Statistics split by test/head/site/file; charts split by test/head with file panels. | [main UI](../deps/ui/stdfViewer_MainWindows.py):227; [STDF-Viewer](../STDF-Viewer.py):791–840, 1005–1012, 1344–1354 |
| Statistics | Name, unit, low/high limits, fail count, Cpk, mean, median, population standard deviation, min/max. MPR adds PMR/logical/physical/channel names; FTR adds pattern name. NaN ignored; infinity hidden by default. Numeric summaries do not exclude flagged-invalid finite values. | [DataInterface](../deps/DataInterface.py):219–336, 536–608; [SharedSrc](../deps/SharedSrc.py):474–494 |
| Fail marker | Explicit cancellable scan across all files/heads/sites. Failure red; otherwise low Cpk orange. Cpk search defaults off, warning threshold 1.33. Statistical-table Cpk highlighting is separate. | [fail marker](../deps/uic_stdFailMarker.py):52–99; [STDF-Viewer](../STDF-Viewer.py):903–923 |
| Trend | DUTIndex versus result, scatter points colored by site and shaped by file; hover shows site/index/value. Mean, median, limits and specifications initially visible. PTR dynamic limit curves; linked value axes across comparison panels. | [ChartWidgets](../deps/ChartWidgets.py):760–915; [DataInterface](../deps/DataInterface.py):731–788 |
| Histogram | Thirty equal-width NumPy bins, computed independently for each site/file. Settings allow 1–1000. Final interval includes its upper endpoint. Horizontal by default; site series occupy separate bands. Mean/median, peak-scaled Gaussian and ±3/6/9σ overlays. Optional normalization divides by the maximum bin count, not total count. | [ChartWidgets](../deps/ChartWidgets.py):41–94, 981–1127; [SharedSrc](../deps/SharedSrc.py):38–58; [settings](../deps/uic_stdSettings.py):169 |
| FTR and MPR | FTR numerical plots use the raw TEST_FLAG byte; table labels it Test Flag. MPR exposes each returned pin result and return-state tooltip, names and PMR identity; no-result MPR may show its flag in the table. | [DataInterface](../deps/DataInterface.py):248–306; [table model](../deps/customizedQtClass.py):476–541 |
| Bins | Separate hardware/software counts, ascending bin number rather than Pareto order. Computed from current nonsuperseded DUTs. Names/colors, hover, percentages, yield and pass/fail/unknown/superseded counts. Yield is pass/(pass+fail); displayed Total also includes unknown/superseded. | [DatabaseFetcher](../deps/DatabaseFetcher.py):300–327; [DataInterface](../deps/DataInterface.py):610–666; [ChartWidgets](../deps/ChartWidgets.py):1254–1349 |
| Wafers | Individual maps by soft bin; legend visibility, count/percentage, XY hover. WCR dimensions/orientation determine geometry, default square/right/up. Sites filter; map query ignores head. Stacked map counts failed current DUTs per XY across all loaded files, including zero-failure coordinates. | [DataInterface](../deps/DataInterface.py):829–905; [DatabaseFetcher](../deps/DatabaseFetcher.py):787–867; [ChartWidgets](../deps/ChartWidgets.py):1385–1467 |
| Device summary | File, part ID/text, head/site, test count/time, hardware/software bin, wafer/XY, decoded status. All attempts retained: failed red, superseded gray, unknown orange. Sortable and lazily fetched with Fetch All Rows. Empty optional columns hidden. | [SharedSrc](../deps/SharedSrc.py):289–312; [STDF-Viewer](../STDF-Viewer.py):626–652, 737–764; [table model](../deps/customizedQtClass.py):248–287 |
| Test summary and drilldown | Selected tests become columns with number/limits/unit header rows. Device rows, selected test cells and plot selections open complete DUT test data. Detail supports transpose, CSV and XLSX. | [STDF-Viewer](../STDF-Viewer.py):481–566, 947–977; [DUT detail](../deps/uic_stdDutData.py):63–171 |
| Plot interaction | Restore, rectangular zoom, pan, data-pick, clear selection, selected-DUT drilldown. Hidden series excluded from picking. Trend selection has count/mean/median/σ; bar selection has bar and DUT counts. Plot export is provided through pyqtgraph. | [ChartWidgets](../deps/ChartWidgets.py):172–305, 422–489, 570–646 |
| Metadata and datalog | File properties/header records; GDR/DTR with approximate position relative to PIR/PRR. Typed GDR values; Bn/Dn in hexadecimal. Lazy retrieval with Fetch All Rows. | [README](../README.upstream.md):152–160; [SharedSrc](../deps/SharedSrc.py):329–345 |
| Reports and utilities | Excel sheets for file information, DUT summary, trend, histogram, bins, wafers, test statistics, GDR/DTR. Filters determine content. Parse-cache sessions; STDF-to-XLSX record dump; log/record diagnostics; local TTF loading. | [README](../README.upstream.md):249–300 |
| Settings | English/Chinese; font; automatic/fixed/scientific notation; precision 0–12, default 3; test ordering/identity; site/bin colors; per-file symbols; plot overlays. Some config fields (normalization, orientation, Gaussian, hide-infinity) lack settings-dialog controls. | [SharedSrc](../deps/SharedSrc.py):29–166; [settings](../deps/uic_stdSettings.py):190–291; [settings UI](../deps/ui/stdfViewer_settingsUI.py):225–228 |

## Retest and record requirements

PRR bit 0 supersedes earlier attempts matching file/group, head, site and part
ID. Bit 1 uses file/group, head, site, wafer context and XY. Repeated identifiers
without these flags do not establish replacement. Aggregate charts/statistics
exclude superseded attempts; explicit device drilldown retains access to them.
See [record processor](../deps/rust_stdf_helper/src/stdf/record_processor.rs),
lines 1047–1072, [schema](../deps/rust_stdf_helper/src/database/schema.rs),
238–254, and [DatabaseFetcher](../deps/DatabaseFetcher.py), 547–552, 608–617.

Required families are PIR/PRR for device identity, outcome, time, retest and XY;
PTR for parametric results and effective/dynamic limits; MPR/PMR for returned
channels and pin names; FTR for flags/patterns; WIR/WRR/WCR for wafers; HBR/SBR
for bin metadata; TSR for supplied test summaries; MIR/MRR/FAR/ATR/RDR/SDR for
file context; GDR/DTR for datalog; and BPS/EPS for program sections. Importer
dispatch additionally handles PCR/PGR/PLR/VUR. Parser recognition alone is not
evidence of a corresponding GUI analysis.

## Limitations to avoid reproducing

- PP/QQ and correlation tabs are hidden and have no implemented plot dispatch
  ([STDF-Viewer](../STDF-Viewer.py):192–193, 1084–1129). Boxplot controls are
  hidden as unimplemented ([settings](../deps/uic_stdSettings.py):185–187).
  Dynamic PTR limits are displayed; this is not a PAT recipe/screening engine.
- Cpk requires both limits and reports infinity for any zero-spread population,
  even when outside limits ([SharedSrc](../deps/SharedSrc.py):483–493). Browser
  rules instead report unavailable capability with a reason.
- Fail Marker fallback applies a DUT flag mask to TEST_FLAG
  ([DataInterface](../deps/DataInterface.py):194); the statistics table uses the
  test flag predicate ([SharedSrc](../deps/SharedSrc.py):348–349).
- Histogram limit visibility inherits Trend settings; the final interval's
  tooltip is printed half-open although its upper edge is included
  ([ChartWidgets](../deps/ChartWidgets.py):62–64, 902–915, 1079).
- Bin and XY drilldown queries drop the plot's site/current-attempt scope
  ([DatabaseFetcher](../deps/DatabaseFetcher.py):870–915). Browser picking must
  reapply the full population and query full observations after display reduction.
- Test Summary assumes aligned DUT arrays across selected tests instead of
  joining by device ID ([DataInterface](../deps/DataInterface.py):427–439;
  [table model](../deps/customizedQtClass.py):484–495).
- Unknown-DUT count has an unparenthesized SQL OR that can escape its scope
  ([DatabaseFetcher](../deps/DatabaseFetcher.py):481). All-passing stacked wafer
  coloring divides by a zero maximum ([ChartWidgets](../deps/ChartWidgets.py):1413).

The browser specification deliberately improves these correctness boundaries,
uses common histogram edges for comparisons, preserves invalid/unknown counts,
and keeps original values and flags available for audit.
