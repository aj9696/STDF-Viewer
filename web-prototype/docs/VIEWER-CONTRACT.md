# Browser viewer provider contract

Status: implementation contract, version 1, 2026-09-25. This is additive to
FRONTEND-CONTRACT.md. Retained library methods and schema remain unchanged.

## Public boundary

`DataLibraryClient.viewer(action, selection, options = {})` sends the `viewer`
worker operation. All SQLite access, parsing and population calculations remain
in the library owner worker. Cancellation uses the existing `cancel()` method;
long operations yield periodically and emit progress. Calls remain sequential.

`selection = {groups: [{name: string, datasetIds: string[]}], heads: number[]|null,
sites: number[]|null, attempts: 'current'|'all'}`. Omitted head/site means all.
Maximum eight groups and eight distinct datasets in a request, each source once
per group. Group source order is significant; the same saved source can appear
in different comparison groups. Names are at most 120 characters. Current is
the default attempt policy. All IDs are validated against the current catalog.
The browser workspace stores this selection, never SQL or storage paths.

| Action | Options and result |
| --- | --- |
| prepare | Build/reopen derived caches; return source identities and counts |
| overview | Source metadata, head/site choices, attempt/outcome counts and yield |
| tests | `{query, offset, limit, order}`; matched identities with family, number, name, unit, channel and count; bounded page |
| devices | `{offset,limit,sort,direction,query,bin,wafer,range,testKey,group,head,site,tests}`; filtered attempt table and optional selected-test matrix |
| device | `{datasetId,deviceId,group,after:[seq,ordinal],limit}`; explicit attempt and paged complete observations, including superseded attempts; group required if source occurs in multiple groups |
| analyze | `{testKey,bins,seriesBy,includeAggregate}`; full-population statistics, shared-edge histogram and bounded trend per series |
| bins | `{kind:'hard'|'soft'}`; recomputed counts/names/percentages per group |
| wafers | Available source/head/wafer identities and geometry |
| wafer | `{waferKey|'stacked'}`; bounded die map plus total and orientation |
| records | `{family,query,offset,limit}`; cold metadata/datalog record page |
| rawRecords | `{datasetId,after,limit}`; original record index after a sequence number |
| record | `{datasetId,seq}`; original bytes and decoded fields for one record |

Test keys are canonical JSON arrays `[family,number,name,unit,channel,identity]`.
Identity is `resolved`, or a source-scoped unresolved identity that cannot collide
with an explicitly recorded name or silently match an unresolved test in another
source. Treat keys as opaque values returned by the provider. A channel
is `''` for PTR/FTR, `pmr:N` when an MPR result is mapped, otherwise `result:N`
using its zero-based result ordinal. Unmapped results are never invented pins.
Family is the STDF subtype 10 (PTR), 15 (MPR), or 20 (FTR).

Tables default to 100 rows, maximum 1,000; test catalog maximum 200 per page.
Responses are bounded, including text-heavy records. Sort fields are allowlists,
all values are bound SQL parameters. Source strings render as text. A device is
identified by dataset ID and PIR record sequence; group and source position
remain part of comparison provenance. Repeated test executions remain separate.

## Analytical response

`analyze` returns `{test, population, series, histogramRange, warnings}`.
Each series has `{key,label,group,head,site,count,stats,bins,points}`. Statistics
include total/valid/excluded/pass/fail/unknown, mean, median, population stdev,
min/max, effective low/high limits, Cpk and a reason when unavailable. Numeric
statistics exclude invalid flags/nonfinite values but include valid failures.
FTR uses the test-flag byte for its labelled status plot and has no Cpk.
Separate `lowSpec/highSpec/changingSpecs` fields describe specification overlays;
absent/changing specifications produce null overlays. Catalog counts describe
all recorded source observations before head/site/attempt filters; scoped
health markers come from explicit full-population analysis.

Trend points contain `{x,value,lsl,usl,datasetId,deviceId,seq}`. `x` identifies the
ordered attempt within its group. Min/max reduction limits the display while
statistics/histograms use all eligible observations. A plot pick passes semantic
ranges back into `devices`; hidden series do not participate. Every drilldown
retains the originating group/head/site/attempt/test/interval scope.

## Cache lifecycle

`viewer-cache.js` owns files named `/viewer-v1-<dataset-id>.sqlite3`. This namespace
is separate from all retained databases. The cache manifest contains source hash,
source bytes, decoder/cache/policy version and completion counts. The manifest is
inserted only after successful parsing, indexing and count checks. Cache schema
or source mismatch triggers a rebuild, never a retained-data migration.

Rust emits bounded batches documented in VIEWER-DECODER.md. SQLite inserts occur
inside bounded transactions with indexes maintained incrementally. A cancelled
or failed build closes handles and removes only its own disposable cache. The
next request rebuilds interrupted caches. Cache construction validates the saved
source hash while reading. Successful source identity is preserved in reports.

Opening a workspace attaches at most eight caches and constructs transient query
views. Retest projections use explicit PRR superseding flags and preserve original
attempts. Cross-file replacements occur only inside the same ordered group and
same head/site/part-ID scope. Wafer coordinate identity remains tied to its WIR
context, so identically named wafers in distinct source files are not collapsed.

Device sort pages merge indexed source cursors; exact medians merge indexed
value cursors. Wafer accumulation tracks the last source/PRR per coordinate
without a whole-population temporary sort. Maps cap 50,000 coordinates and
200,000 coordinate/bin pairs; viewports can narrow a larger source. Metadata,
declarations and result pages also have explicit byte/row limits.

No cache contains the sole source data. Browser packages need not transport these
indexes; restore rebuilds them. Cache size is additional browser storage and cold
indexing time must be reported separately from warm query time.

## Transfer and generated files

`viewerTransfer(action, options)` saves/restores `.sdworkspace`; `viewerReport`
generates eight-section XLSX reports, complete record workbooks, or full device
exports. See [VIEWER-TRANSFER.md](VIEWER-TRANSFER.md). Device kinds are `device`
and `deviceCsv`, with `options.device={datasetId,deviceId,group}`. CSV protects
formula-like text; XLSX writes original text as literal cells.

`client.request('viewerDownloads', {action:'list',offset})` inventories a bounded
50-entry page across report/workspace staging. It returns opaque `{kind,token}`
identities plus byte size and modification time. `get` returns a disk-backed
File; `release` removes that temporary artifact. Inventory is explicit, survives
reload, and includes interrupted files without claiming their completeness.
These operations never remove retained sources or databases. UI must serialize
them through the same library owner and avoid release until downloads finish.
