# STDF-Viewer browser parity tracker

Reference: upstream commit `b8deaad8eecf860676183825ac0089cf6c4b0ba3`.
Scope and analytical rules: [browser viewer specification](../SPEC-browser-viewer.md).
Status is implementation in progress; a planned row is not a delivered claim.

| Working upstream feature | Browser delivery | Status |
| --- | --- | --- |
| Raw V4/IEEE byte orders | Existing retained source import | Delivered |
| Gzip, bzip2, single-file ZIP | Bounded local decompression | Planned |
| Multi-file / folder / drop | Product import queue | Planned (foundation exists) |
| Ordered merge groups and comparison | Workspace groups | Planned |
| File information | MIR/MRR and record metadata view | Planned (library overview exists) |
| Device summary / retest marking | Filtered, sortable device table | Planned |
| GDR/DTR summary | Located decoded datalog | Planned |
| Test list / search / failure marker | PTR/MPR/FTR catalogue | Planned (raw PTR explorer exists) |
| Multiple tests / head / site selection | Explicit population controls | Planned |
| Test summary across devices | Paged selected-test matrix | Planned |
| Test statistics and low-Cpk marker | Documented streaming statistics | Planned |
| Trend / dynamic limits / data picking | Bounded interactive plot | Planned |
| Histogram / Gaussian / sigma overlays | Common-range comparison histograms | Planned |
| Hardware / software bin charts | Bin summary and device drilldown | Planned |
| Wafer maps / stacked fail map | Oriented interactive die maps | Planned |
| Detailed selected DUT data | Attempt-level observations and flags | Planned |
| Excel report, eight section types | Workbook and chart export | Planned |
| Save / load session | Browser portable workspace session | Planned (dataset packages exist) |
| Chart settings / colors / custom font | Persisted local preferences | Planned |
| STDF record converter | Full record workbook export | Planned |
| Debug record reader / diagnostics | Record inspection and diagnostic export | Planned |

Native OS file association, Qt widgets and native `.db` cache files require
browser equivalents rather than binary/UI compatibility. Upstream PP/QQ,
correlation and boxplots are hidden placeholders, not completed features.
