# Upstream file workflows and export baseline

This checklist records the behavior present in the desktop source, inspected on
2026-09-25. `README.upstream.md` describes the product; the references below identify
the implementation. It is a porting baseline, not a promise that every desktop
implementation detail is desirable or already available in the browser.

## Import, comparison, and logical merge

- [ ] Open raw STDF V4/V4-2007 or compressed GZ, BZ2, and single-file, unencrypted
  ZIP input. Desktop entry points are the file dialog, command-line/OS association,
  and drag/drop. See `STDF-Viewer.py:309` (`openNewFile`),
  `deps/SharedSrc.py:283` (`FILE_FILTER`), and `README.upstream.md`.
- [ ] Selecting several files normally creates one comparison group per source:
  `openNewFile` calls `callFileLoader([[file1], [file2], ...])`.
- [ ] Merge Panel allows ordered members in several groups; all groups must be
  nonempty. It reads MIR for preview, supports add/remove/reorder, and submits the
  nested list to the same loader. It does **not** produce a merged STDF file.
  See `deps/uic_stdMerge.py:91` (`onAddFiles`) and `:198` (`onConfirm`).
- [ ] Each group becomes one `Fid`; originals retain `SubFid` and filename.
  A group uses one record tracker across its members, in their selected order.
  Groups can parse independently, but members cannot be reordered during parsing:
  later retest records can supersede earlier DUTs. See
  `deps/rust_stdf_helper/src/py_api/generate_database.rs:62`.
- [ ] Retest scope is explicit: PRR bit 0 matches group/head/site/PartID; bit 1
  matches group/head/site/internal wafer index/X/Y. This is not global matching
  by PartID or matching by the wafer-ID string. See
  `deps/rust_stdf_helper/src/stdf/record_processor.rs:1022` (`on_prr_view`) and
  `deps/rust_stdf_helper/src/database/schema.rs:238`.
- [ ] Preserve original member metadata. Desktop display uses the first member
  for most fields and joins SETUP_T, START_T, FINISH_T, and SBLOT_ID with member
  numbers. See `deps/DatabaseFetcher.py:330` (`getFileInfo`).

The desktop Merge Panel only previews MIR; it has no lot/product compatibility
gate or content deduplication. `MergeTableModel.addFiles` simply appends
(`deps/customizedQtClass.py:728`). Browser grouping should retain explicit member
order and source identity without modifying immutable imported source records.

## Sessions and settings

- [ ] Save/load a parsed session without reparsing original STDF. Desktop Save
  Session copies the active SQLite `.db` file; it asks before copying a database
  of at least 50 MiB. See `STDF-Viewer.py:341` (`onSaveSession`).
- [ ] Desktop startup reopens a cache from `logs`; exit retains the active cache
  and removes other generated `.db` caches. Settings are written separately.
  See `STDF-Viewer.py:1253` (`restorePreviousSession`) and `:454` (`onExit`).
- [ ] A browser workspace format should specify source membership, order,
  selections/settings, schema/parser versions, and portability independently of
  desktop cache compatibility.

**Native `.db` sessions are incompatible with the current browser dataset schema.**
The desktop cache has 15 normalized tables, including `Test_Info`, `PTR_Data`,
`MPR_Data`, `FTR_Data`, pin/wafer/bin data, and `Dynamic_Limits`. It stores original
paths, not original source bytes. The browser currently retains immutable source
bytes and a different versioned schema; its `.sdlibrary` backup is one dataset,
not an entire desktop session or multi-dataset workspace. Do not label the two
formats interchangeable. See `deps/rust_stdf_helper/src/database/schema.rs:15`
and `web-prototype/site/dataset-schema.js`.

Do not reuse desktop session validation as a security boundary:
`deps/SharedSrc.py:768` checks unexpected table names but does not require every
expected table or validate columns, values, provenance, or resource bounds.

## Reports and tabular downloads

- [ ] Excel report wizard: choose content/output, selected tests, heads, and
  individual sites and/or an aggregate All Sites entry. DUT-only output can omit
  tests; trend/histogram/statistics require at least one. See
  `deps/uic_stdExporter.py:1092` (`gotoNextPage`).
- [ ] Eight implemented worksheet types, in fixed order: File Info; DUT Summary;
  GDR & DTR Summary; Test Statistics; Trend Chart; Histogram; Bin Chart; Wafer Map.
  Each selected content type has one sheet. See `reportGenerator.report_core`
  (`deps/uic_stdExporter.py:567`).
- [ ] DUT Summary adds selected test columns to ordered DUT rows with test number,
  upper/lower limit, unit, per-test failure styling, and pass/fail/unknown/
  superseded DUT styling. Missing results display a placeholder; FTR displays its
  test flag. See `writeDUT_Summary` (`:313`) and
  `stringifyDutSummaryTestData` (`:405`).
- [ ] Trend/histogram sheets contain rendered PNG figures and statistics, per
  test/head/site combination. Bin sheets include hard/soft-bin summary tables.
  Wafer sheets include all wafer choices and their summary tables. UI plot and
  format settings affect exports. See `writeBinChart` (`:424`), `writeWaferMap`
  (`:466`), `writeTrendPlot` (`:491`), and `writeHistogram` (`:515`).
- [ ] File Info exports displayed metadata; GDR/DTR exports all available rows
  through a fetching generator, with record type, value, and approximate DUT
  position. See `STDF-Viewer.py:1132` and `:1153`.
- [ ] Selected-DUT detail supports transpose plus CSV and styled XLSX downloads
  of the active orientation. See `deps/uic_stdDutData.py:124`, `:134`, and `:171`.
- [ ] Chart context menu exposes the pyqtgraph export action; this is separate
  from the Excel wizard. See `deps/ChartWidgets.py:246`.

**Unimplemented placeholders are not parity requirements:** exporter file subset
selection is disabled and all files are checked; PPQQ and Correlation report
checkboxes are hidden, and no report writer fills those sheets
(`deps/uic_stdExporter.py:829`). Report chart/statistic methods also explicitly
ignore their `fids` parameter (`STDF-Viewer.py:1187`, `:1196`).

The browser needs bounded row production, explicit Excel row/column limit policy,
consistent text/number/special-float handling, correct CSV escaping, and safe
literal spreadsheet strings. The desktop CSV writer only quotes commas and the
report writers do not implement sheet splitting; those limitations should not be
copied. Report generation currently depends on Qt-rendered images and NumPy-backed
data, so it cannot simply be imported into browser JavaScript.

## Record converter and diagnostic utilities

- [ ] Standalone STDF-to-XLSX converter reads a source directly, creates one
  worksheet per encountered record type, and writes one record per row in STDF
  field order. Numbers remain numeric, null becomes `N/A`, arrays/objects become
  JSON text. It includes records beyond the analysis cache, such as STR and
  V4-2007 scan records. Unknown record types error; reserved records are handled.
  See `deps/rust_stdf_helper/src/py_api/stdf_to_xlsx.rs:28`, `:198`, and `:250`.
- [ ] Converter progress and cancellation; desktop checks cancellation at PRR
  boundaries and saves partial output after cancellation. See
  `deps/uic_stdConverter.py:89` and `ConverterWrapper.startConvertion` (`:178`).
- [ ] Debug utility shows logs, produces record-layout summaries, flags missing
  bin definitions, mismatched TSR/test identities, reused test numbers, and
  number/name collisions across PTR/MPR/FTR; saves text output. See
  `deps/uic_stdDebug.py:84`, `:126`, `:144`, and
  `deps/rust_stdf_helper/src/py_api/analyze_stdf.rs:27`.
- [ ] Add local TTF font and select it through settings. See
  `STDF-Viewer.py:426` (`onAddFont`). Desktop font directories and OS reveal/open
  helpers need browser-specific equivalents, not direct filesystem assumptions.

Complete source bytes are necessary for lossless record conversion/diagnostics.
The native cache deliberately ignores some recognized record types, and the
current browser only normalizes PTR measurements. MPR/FTR, pin maps, wafer
metadata, summaries, and datalog must be decoded from retained bytes before their
full user-facing features or reports can be claimed. Native PyO3, threads,
filesystem paths, and rusqlite bindings are not browser APIs; reusable semantics
must be separated from these adapters.

## Existing validation material

- `web-prototype/scripts/make-library-fixtures.py`: independent small little/big
  endian sources, exact expected rows, compact/empty PTR metadata, special float
  bits, multiple heads/attempts, raw MPR/FTR, malformed inputs.
- `web-prototype/scripts/make-explorer-fixtures.py`: 58 test groups, 120
  declarations, 212 observations, special names/limits/flags, pagination, and
  a no-PTR raw-context fixture. Existing library/explorer browser harnesses test
  real SQLite/WASM, isolated profiles, source hashes, backup restore, and bounds.
- `tests/test_parser_identity.py` and `tests/test_parser_flags.py`: native parser
  compact-name/default behavior, explicitly empty names, ambiguity, mixed
  PTR/MPR/FTR identities, and parameter flags. These are semantic references, not
  proof that the retained browser schema already applies native defaults.
- `tests/test_library.py` and `tests/test_ingest.py`: native gzip/BZ2/ZIP fixtures,
  single-member policy, corrupt/truncated streams, expansion limits, misleading
  suffixes, source retention, and repeated PTR behavior.
- `semidata/demo.py`: deterministic three-lot PTR/wafer examples;
  `benchmarks/generate.py`: bounded-memory workloads, gzip, PartID/die retests;
  `benchmarks/native_retests.py` and Rust database-context tests verify retest
  scope/index behavior. Existing 1M/10M measurement inputs can test throughput.

New independent fixtures are still needed for cross-file ordered merge,
comprehensive MPR/FTR/pin arrays, scan records, rich GDR values, and report output
validation. No existing converter/report/session round-trip test was found in
`tests/` or `benchmarks/` during this inventory. XLSX tests should inspect the ZIP
workbook XML and cell types/values, not merely assert that a file was downloaded.

## Browser compressed-source implementation

`web-prototype/site/compressed-source.js` now exports
`prepareSource(file, context) -> { file, cleanup }`. This is a worker-only provider:
`context.checkCancelled()` throws on cancellation and `context.progress()` accepts
the `decompressing` phase with compressed-byte progress and `expandedBytes`.
The returned `File` contains expanded bytes with a raw STDF filename. Import must
finish reading it before calling the idempotent asynchronous `cleanup()` in a
`finally` block. The original input `File` is never modified. With this contract,
expanded bytes supply the retained source hash; differently compressed copies of
the same STDF deduplicate. The compressed envelope itself is not retained by this
provider.

Compression is detected from content. Supported inputs are gzip (including
concatenated members), BZIP2 (including concatenated streams), and a ZIP containing
exactly one unencrypted regular file. ZIP methods are STORE (0), DEFLATE (8),
BZIP2 (12), and Zstandard (93). Direct gzip/BZIP2 CRCs, ZIP CRC-32, expanded sizes,
and optional Zstandard frame checksums are verified. Other ZIP methods, dictionaries,
links, special files, directories, and multiple entries fail explicitly. Zstandard
has an explicit 32 MiB history-window bound; higher-window files must be recompressed
using a supported window or another supported format.

Input and total expanded output are each capped at 2 GiB. Staging is a random child
of OPFS `semidata-decompression-v1`; a handled error, cancellation, or quota failure
removes only that invocation's child. No user filename is used as a storage path.
ZIP central-directory reads are capped at 1 MiB before allocation; ordinary input
and output chunks are 64 KiB. BZIP2 uses its format-bounded block buffers; Zstandard
frame headers are checked before its decoder allocates history. Worker termination
can leave a staging child; library startup may remove stale children only while
holding the exclusive library lock, before any new prepare operation starts.

Run `npm ci --ignore-scripts` and `npm run build:vendor` in `web-prototype` to build
the locally served bundle. Exact versions are pinned in `package-lock.json`;
`THIRD-PARTY-VIEWER-NOTICES.txt` contains full license texts and adaptation notices.
The generated `site/vendor/manifest.json` records bundle hashes. Runtime codecs do
not contact a CDN or upload source data. Pako's low-level gzip decoder is used
because native browser `DecompressionStream('gzip')` rejects concatenated members.

`node scripts/compression-check.mjs chrome` and the equivalent `msedge` invocation
use isolated profiles and generated independent fixtures. They verify exact hashes,
real SQLite imports and deduplication, bounded reads/writes, stream-boundary cases,
corrupt block/stream/frame checksums, malformed archives, cancellation, quota errors,
and cleanup. Expansion-cap testing substitutes a smaller limit in a test-only route;
production retains the 2 GiB bound.
