# Local document reports

Document reports turn a selected STDF population into a portable summary. The
browser reads the existing local library and writes the finished files to
origin-private storage. No report content or source measurements are uploaded.
Original STDF and cached measurements are unchanged.

## Workflow and scope

Open **Reports**, choose a title, scope, sections and formats, then select
**Create report**. The default includes source information, selected-test
statistics and histograms. Test-dependent sections require selected tests; PAT
requires a numeric test. **Cancel** interrupts collection or writing and removes
files from the unfinished batch. Download links appear only when the entire
batch succeeds.

| Scope | Population |
|---|---|
| Current comparison | Existing comparison groups and source order |
| Single source | One selected source, in one group |
| One lot | Selected sources whose MIR `LOT_ID` matches, combined in one group |
| Each source | Separate report for every selected source |
| Each lot | Separate report for every distinct selected lot |
| Each source and each lot | Both sets of reports in one batch |

All scopes retain the selected head, site and attempt policy. Missing lot names
form the explicit **Unspecified lot** group. Batch scope is limited to the
current selection; it does not search the entire library. Source and lot report
names contain distinct prefixes and sequence numbers. The existing viewer
selection supports at most eight sources; at most sixteen report scopes can be
generated together.

## Sections and populations

| Section | Calculation and presentation |
|---|---|
| Summary | Group pass/fail/unknown counts and known-outcome yield; source identity, SHA-256 and recorded MIR metadata |
| Selected statistics | Full eligible recorded-measurement statistics, ranked by available Cpk; unavailable capability includes its reason |
| Histograms and test-order trends | Selected-test charts using the viewer's bin/settings and population policy; bounded trend display, exact summary counts |
| Hardware/software bins | Charts and count tables for the selected device population |
| Wafer maps | One map per selected wafer, up to sixteen; existing final coordinate-disposition policy |
| Site yield and test time | Per-head/site outcome counts, known-outcome yield and mean recorded PRR test time |
| Device yield/time trends | Cumulative known-outcome yield and PRR test time by selected device order; extrema-preserving display reduction with full eligible population counts |
| Retest counts | All attempts and explicitly superseded attempts; repeated identifiers alone do not imply retest |
| Recorded part counts | Original PCR summaries, independent of current head/site/retest filtering; head/site 255 is a summary scope and sentinel counts remain unknown |
| Datalog notes | First 100 selected source records, with the complete record count stated |
| PAT | Selected numeric-test screen, fit/count/limits, warnings and up to 1,000 flagged-device decisions; no disposition change |
| Full catalogue worst Cpk | Optional scan of every numeric test identity in the selected scope; report the six tests with the lowest available population Cpk |

The full catalogue scan is explicitly opt-in because it can be expensive. It
pages the catalogue in groups of 200, analyzes tests sequentially and retains
only six candidate analyses. It rejects catalogues above 20,000 test identities.
Functional status tests are excluded. A test is ranked by the minimum available
Cpk across its selected populations; its histogram still shows those
populations. The receipt records numeric tests scanned, unavailable Cpk count
and displayed test count. Cancellation is checked between every query.

For numerical definitions, final-execution rules and PAT limitations, see
[STUDIES-METHODS.md](STUDIES-METHODS.md). Report descriptive sigma is population
standard deviation. PAT's sigma fit uses sample standard deviation; MAD fitting
uses the documented median/MAD policy. These are separate populations and
methods. Generated reports state their method and source provenance.

## File formats

| Format | Contents and limits |
|---|---|
| PDF | Real PDF 1.4 with a JPEG image per page at the selected physical size and embedded `report-receipt.json`; preserves browser-rendered Unicode, but page text is not searchable or tagged for accessibility |
| Word | Real DOCX/OPC ZIP with editable paragraphs and tables, chart images, page footer and `report-receipt.json`; Word/LibreOffice controls pagination and installed fonts |
| PNG | One image for a one-page report; numbered images plus receipt in a ZIP for multiple pages |
| JPEG | Same packaging as PNG, with JPEG compression |
| Excel summary | Real XLSX with one sheet per selected report section, literal table values, chart PNGs and a provenance sheet; works with the same source/lot batches |

The **Page layout** controls set physical page width/height and raster image
width. Defaults are A4 (210 × 297 mm) and 1200 × 1697 pixels. Width accepts
148–420 mm; height accepts 148–594 mm. Image width accepts 800–2,400 integer
pixels, with computed page height capped at 4,800 pixels. Swapping physical
width and height selects landscape. PDF MediaBox and Word section dimensions
use the selected physical size; native tables and charts fit the available
width. Pixel width changes output resolution while preserving physical font
sizes and layout. The normalized dimensions are recorded in every receipt.

PDF and Word may have
different page counts because Word reflows editable content. Table headers
repeat on page breaks, ordinary Word rows stay together, and chart captions
stay with their images. Long tokens wrap rather than clipping. Unicode depends
on available browser/Word fonts; QA covers Latin, Greek, Korean and Chinese.

The separately downloadable batch receipt contains each report's title, scope,
source SHA-256, selection, selected tests, method text, selected table contents,
included-chart markers and output names/sizes. Embedded document receipts
contain the same report provenance; single-page image files use the separate
receipt. Receipts do not contain hidden raw measurement populations. Report
files are summaries rather than database backups or original STDF exports.

Excel summary exports retain the report model's values and precision. Numeric
counts remain numeric cells; formatted summary statistics remain the displayed
report strings. Formula-looking source text stays literal and cannot create
spreadsheet formulas. Each section has its own sheet with a frozen title row,
wrapped text and bounded column widths. Charts are embedded PNG snapshots.
The provenance sheet contains source names, IDs and hashes, scope and layout,
followed by numbered JSON chunks that concatenate to the full report receipt.
There are at most 63 section sheets plus provenance. Cell text above Excel's
32,767-character limit rejects rather than truncating. This format exports the
selected summaries; the existing device/measurement workbook export remains
the path for complete underlying populations. Page-layout settings are recorded
as provenance and do not set Excel print dimensions.

Summary workbooks use classic ZIP packaging within the 128 MiB report limit,
which was verified with LibreOffice and openpyxl. The shared workbook writer's
default ZIP64 behavior for larger raw-population exports is unchanged.

## Bounds and cancellation

Each report allows a 1–200 character title, 1–128 assembled sections, at most
1,000 paragraphs per section, 1–12 table columns, 5,000 combined summary rows,
one million text characters and 64 MiB of chart blobs. PCR collection rejects
more than 3,000 records. Raster rendering permits up to 100 pages and 128 MiB
of combined PNG/JPEG page buffers; each output file is limited to 128 MiB.
These limits produce actionable errors rather than silently dropping sections.

Generated files use UUID names under `semidata-document-exports-v1` in OPFS.
`viewer-downloads.js` registers the `document` download kind for release and
cleanup. An error or cancellation during any requested format removes that
report's partial files. An error in a later batch scope also removes completed
files from earlier scopes, so the UI never publishes a partial-success batch.
The browser still needs memory for selected report sections and bounded page
images; this is not an unbounded raw-data export path.

## Module contracts

`viewer-document-ui.js` collects data using existing worker queries, captures
charts through their PNG export API, and renders document controls:

```js
collectDocumentReport(api, choice, { checkCancelled, onProgress })
renderDocumentTools(container, api)
```

The UI API supplies `state`, `query`, `run`, `client()` and `checkCancelled()`.
Collection returns a plain report with `title`, `createdAt`, `scope`, optional
`filenameStem`, `provenance`, `layout: {pageWidthMm, pageHeightMm, imageWidthPx}`,
and `sections`. Each section has a title and any
of `paragraphs`, `table: {headers, rows}`, or a PNG/JPEG `image` Blob.

`viewer-document-formats.js` is independent of viewer queries:

```js
validateDocumentReport(report)
normalizeReportLayout(layout)
renderDocumentPages(report, { checkCancelled, onProgress })
createDocumentExports(report, { formats, checkCancelled, onProgress })
createDocumentBatch(reportFactories, { formats, checkCancelled, onProgress })
```

Formats are `pdf`, `docx`, `png`, `jpg`, and `xlsx`. Successful creation returns
`{files, receipt}`; each file includes its File object, user-facing filename,
OPFS token, format and raster page count (null for Word and Excel). Factories run
sequentially so batch reports do not accumulate all population models at once.
The implementation uses the already-vendored ZIP writer, the existing streaming
XLSX writer and browser APIs. XLSX-only and Word-only requests do not rasterize
report pages.

## Verification

Run from the repository root:

```powershell
node web-prototype/scripts/viewer-documents-check.mjs chrome
node web-prototype/scripts/viewer-documents-check.mjs msedge
python web-prototype/scripts/verify-document-exports.py <results-directory>
```

The last command requires pypdf, python-docx, Pillow and openpyxl. Browser checks generate
an independent multilingual report fixture, import independently encoded STDF
through the production WASM/SQLite path, exercise every section, verify known
PCR values, create real UI downloads, and generate source-plus-lot batches.
They verify excessive-row rejection, cancellation after one format and rollback
when the second batch scope fails. The independent validator parses PDF page
objects and attachments, DOCX XML/relationships/native tables, and PNG/JPEG
signatures, dimensions and page counts. It also opens XLSX files to verify
literal hostile text, numeric/boolean cells, embedded chart images, source
membership and reconstructed receipt chunks. Binary parsing is supplemented with
LibreOffice DOCX rendering and visual inspection of every page, plus Poppler
rendering of PDF pages. Results are stored under ignored `results/` directories.

These checks establish correctness on small adversarial fixtures and a real
report collection path. They do not establish throughput for the optional
20,000-test catalogue scan or every font installed on another machine.

### Verified run: 25 September 2026

Chrome 153.0.8010.48 and Edge 153.0.4234.48 passed all three browser check groups.
The three-source/two-lot fixture produced five reports with source membership
counts `[1, 1, 1, 2, 1]` and independently checked lot pass counts `[2, 1]`.
Both runs passed the independent container validator: three-page multilingual
PDF, two-page default report, six-page report containing all sections, DOCX
with eleven native tables and ten charts, and three-page PNG/JPEG archives.

Evidence directories are `results/viewer-documents-chrome-1790357138508` and
`results/viewer-documents-msedge-1790357138506`. Visual QA of the same final
formatting implementation is in
`results/viewer-documents-chrome-1790356996349`: all six production DOCX pages,
all three multilingual DOCX pages and all six production PDF pages were rendered
and inspected. The review corrected an interoperable table-property ordering
issue, kept chart captions with their images, and prevented short summary rows
from splitting across Word pages.

The later sizing checks passed four browser groups in Chrome and Edge, in
`results/viewer-documents-chrome-1790358305060` and
`results/viewer-documents-msedge-1790358305072`. Independent parsing verified
297 × 210 mm landscape geometry in PDF and DOCX, 1600 × 1131 pixel PNG output,
and matching receipts; excessive raster dimensions reject before allocation.

The final five-format checks passed five browser groups in Chrome and Edge:
`results/viewer-documents-chrome-1790358916881` and
`results/viewer-documents-msedge-1790358916881`. Both directories include
independent `container-validation.json` results. The all-section workbook has
24 sheets and ten chart images; the lot workbook retains both expected source
identities. A five-scope source-plus-lot batch produced ten PDF/XLSX files with
matching receipts. Overlong Excel cell text rejects the export and rolls back
an already-created Word file from that request.

LibreOffice opened the actual final six-sheet XLSX fixture directly. Every
rendered sheet was inspected for readable tables, Unicode and embedded charts;
the PDF and page images are in the Chrome directory's `xlsx-render` folder.
Final custom-size visual QA is in
`results/viewer-documents-chrome-1790358305060`: all six production Word and PDF
pages, plus both landscape pages, were rendered and inspected. Microsoft Excel
and Microsoft Word application behavior was not directly tested.
