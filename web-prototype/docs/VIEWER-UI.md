# Browser data viewer: user and integration guide

The browser viewer implements investigation workflows from the working upstream
STDF-Viewer. It operates on saved local source data through a dedicated worker;
the page does not parse entire files or load complete measurement tables into the
DOM. The governing specification is [SPEC-browser-viewer.md](../../SPEC-browser-viewer.md).
See [VIEWER-CONTRACT.md](VIEWER-CONTRACT.md) for population/query rules and
[upstream-viewer-behavior.md](../../docs/upstream-viewer-behavior.md) for the
source-evidenced baseline and intentional corrections.

## Open a workspace

Open **Data viewer** from a saved dataset in Data library. Its address is
`viewer.html?dataset=<saved dataset ID>` on the same app origin. The first visit
can build disposable analysis indexes. Progress and cancellation remain visible;
original retained sources are unchanged. A subsequent visit reuses compatible
indexes. Direct `file://` loading is unsupported; the launch notice links to the
local app address.

**Files & groups** creates ordered logical groups of saved datasets. Sources
within a group form one population in the specified order; comparison groups
remain independent. The same source may occur in multiple groups, once per
group. The provider allows eight groups and eight distinct source files.
Reordering groups or sources does not rewrite STDF bytes.

Choose heads, sites, and **Current attempts** or **All attempts, including
superseded**. Head/site controls support multiple native selections. Current
attempts are determined by explicit scoped STDF superseding rules; repeated part
names alone are insufficient evidence of replacement. The chart-series selector
offers aggregate selected sites, each site, or both. Aggregate and per-site
series overlap intentionally; they are not disjoint cohorts to sum.

## Investigate recorded data

| View | Behavior |
| --- | --- |
| File info | Outcome metrics for the selected current/all policy, attempt history counts, source hash, warnings and recorded headers. Unknown outcomes are separate; displayed yield excludes unknowns. |
| Devices | Searchable/sortable attempt table, 50 rows per page. Open a device for all its recorded observations. Plot selections retain their original population and can be cleared explicitly. |
| Tests | Full-population statistics for up to twelve selected identities and a device-by-test matrix joined by original device identity. Repeated executions are retained. |
| Trend | Reduced display points with full recorded/eligible counts and extrema retained by the provider. Statistics are computed from the full population. |
| Histogram | Common, equal-width provider bins across compared series. Intervals are half-open except the final upper endpoint. |
| Bins | Recomputed hardware/software counts, percentages and outcome counts. The accompanying bin table is paged at 50 rows. |
| Wafers | Individual soft-bin maps or stacked failure counts. Recorded orientation and die aspect ratio affect display; drilldowns retain original die coordinates. Four optional X/Y viewport bounds narrow large maps. |
| Records | Paged GDR/DTR, headers, pin metadata, all indexed metadata, or all original records from a chosen source. Open a record for decoded fields and exact bytes. |

The test catalog is independently paged at 50 identities and supports number/name
search, optional `*`/`?` wildcards, and original/number/name ordering. Tests retain
record family, effective name, unit and MPR channel identity. Mapped pin labels
and available source/head/site pin provenance are shown; an unmapped result is
not presented as a fabricated pin.

Catalog recorded/failure counts describe source inventory **before** head/site
and current/all filters. **Scan test health** performs an explicit, cancellable
scan of every test identity using the current population and series policy. It
adds scoped failure and low-Cpk markers without selecting every test. A partial
scan reports its completed identity count; unscanned identities have no marker.
Source/filter/series/settings changes invalidate markers. Cpk markers compare
the lowest defined series Cpk with the configured threshold, initially 1.33.
Undefined capability remains unavailable rather than becoming a passing score.

Device detail preserves result flags, original R4 bits, record sequence and MPR
result ordinal alongside normalized values. **Transpose this page** changes the
current page presentation only. Paging still retrieves every recorded execution.
**Export CSV** and **Export Excel** export all recorded observations for that
attempt, beyond the current page and selected-test set.

## Chart interaction and settings

Each chart provides a legend, reset button, hover information, and labeled
keyboard alternatives to pointer selection. Trend/histogram interval picks
query full-population devices, including observations omitted by display
reduction. Hidden series do not participate in picks. Bin and die picks retain
their exact category/coordinate and group scope.

**Pointer drag** selects Inspect data, Zoom rectangle, or Pan view. Dedicated
zoom and four pan buttons provide keyboard operation. Zoom/pan changes the
displayed extent only; population, histogram bins and statistics remain fixed.
Reset restores all series and full extent. Wafer viewport bounds are a separate
provider filter used to retrieve a smaller map when necessary.

Settings include 1–1,000 histogram bins (default 30), displayed decimal
precision, adaptive/fixed/scientific notation, point size, mean/median overlays, test/specification limits,
±3/6/9 sigma, peak-scaled Gaussian overlays, Cpk threshold, site/bin colors and
font. Adaptive notation uses scientific notation for small/large values rather
than rounding nonzero measurements to zero. Fixed notation deliberately rounds
to the selected number of decimal places; the recorded number and raw bits
remain available. FTR plots explicitly show the test-status byte; they do
not claim a physical measurement or meaningful Cpk.

Specification overlays use constant, recorded effective specification limits.
Absent or changing specifications are not drawn. Gaussian height is scaled to
each series' peak histogram count; it is not a fitted probability-density axis.
Color overrides address bin numbers in bin plots and individual wafer maps;
stacked wafer colors encode failed-attempt counts.

Settings and the latest logical group/test selection use versioned local browser
preferences. A custom TTF/OTF font up to 10 MiB is loaded with `FontFace` and stored
in a separate IndexedDB preference database. Portable workspace packages carry
the font preference but not the font binary. If the font is unavailable on
restore, the viewer completes restoration using Segoe UI and explains how to
add the font again. Source data and analysis indexes do not depend on fonts.

## Reports and portable workspaces

The report/session action module supplies **Export report**, **Save workspace**
and **Open workspace**, including Open workspace in an empty local library.
Reports select sections, optional chart images, complete record workbooks or
diagnostic JSON. Generated files have explicit download and temporary-copy
cleanup controls. See [VIEWER-TRANSFER.md](VIEWER-TRANSFER.md) for exact package,
retained-source, export and restore guarantees. Native upstream database
sessions are distinct from browser workspace packages.
**Generated files** reopens the stored temporary-output inventory, including in
an empty library, so files can be downloaded or explicitly removed after reload.

## Module ownership and extension boundary

| File | Responsibility |
| --- | --- |
| `viewer.html`, `viewer.css` | Static accessible application shell, responsive layout and native dialogs |
| `viewer.js` | Serialized operations, progress/cancel/retry, scope and selection state, dialog/query lifecycle |
| `viewer-view.js` | Text-safe tables, metrics, raw observation/record presentation |
| `viewer-groups.js` | Isolated group edits and ordered source controls |
| `viewer-settings.js` | Validated preference schema and local font persistence |
| `viewer-number.js` | Shared adaptive/fixed/scientific presentation; raw values stay unchanged |
| `viewer-charts.js`, `viewer-charts.css` | Pure bounded canvas display, semantic picks, keyboard alternatives and PNG output |
| `viewer-actions.js` | Report/session and device-export workflows |

`window.semidataViewer` exposes the integration boundary after module evaluation:

```js
getState() // cloned {selection, settings, tests, tab, seriesBy, includeAggregate}
getDatasets() // cloned saved dataset catalog
query(action, options) // current-selection worker query
checkCancelled() // throws CANCELLED only during a cancelled active operation
client() // owner DataLibraryClient, for transfer/report operations
exportChartPNGs() // Promise<Blob[]> for currently rendered plot canvases
installActions({export, saveSession, openSession, exportDevice, manageDownloads})
applyWorkspace({selection, settings, tests, tab, seriesBy, includeAggregate})
```

Installed actions receive a state snapshot. `exportDevice` additionally receives
`{datasetId, deviceId, group}` and `'csv' | 'xlsx'`. Actions run within the same
serialized busy/progress boundary. `applyWorkspace` is safe inside an installed
action: it reloads directly rather than awaiting its own outer action. Outside an
action, it refuses a concurrent operation. Restoring refreshes the dataset
catalog before loading the new scope. `viewer-ready` fires after initialization,
including an empty library; `viewer-statechange` announces logical selection or
setting changes. Consumers should treat test/series/wafer keys as opaque.
The query wrapper checks cancellation before and after each worker request.
Actions must also call `checkCancelled()` after asynchronous non-worker phases
such as canvas capture and before dispatching a report or publishing an output,
so cancellation between requests prevents subsequent work. A new operation
starts with a fresh cancellation state; an idle check is a no-op.

Main controls and dynamic view regions are disabled or inert while operations
run. Closing a busy native dialog defers focus restoration until completion;
nested raw-record dialogs return focus to their device record button. Navigation
away terminates the owner worker; browser history restoration reloads the page
to acquire a new owner. All source strings are rendered as text, never HTML.

Chart exports are PNGs of the current plot canvas and axes, including its current
viewport. Titles, legends and population provenance are separate DOM content;
standalone consumers must retain them alongside the PNG. Report rendering uses
separate full-extent chart instances.

## Presentation differences from the desktop baseline

The browser implements the investigation workflows with a new web layout; it
does not reproduce every desktop presentation preference. This increment is
English-only and uses colored series with explicit group/site legends rather
than the desktop's per-file marker-symbol controls. Histograms are vertical,
use common comparison edges, and show counts. The upstream configuration-only
horizontal orientation and peak-normalized bar modes are not exposed here.
Gaussian overlays remain explicitly peak-scaled. These differences do not
change retained records, numeric statistics or the population of a drilldown.

## Verification and qualification boundary

Run from the repository root:

```powershell
node web-prototype/scripts/viewer-ui-check.mjs chrome
node web-prototype/scripts/viewer-ui-check.mjs msedge
node web-prototype/scripts/viewer-charts-check.mjs chrome
node web-prototype/scripts/viewer-charts-check.mjs msedge
```

`viewer-ui-check.mjs` serves actual UI modules with a deterministic substitute
query provider in a fresh browser profile. It qualifies UI routing, selection,
scope payloads, safe text, pagination, dialogs/focus, transpose, settings/groups,
health scan/cancellation, retries, session-action reentrancy, missing-font
fallback, and 360-pixel layout. It does **not** establish parser, SQLite, numeric
or report correctness. The independent production-provider E2E and provider
suites establish those boundaries; see their final evidence in the delivery
record.

`viewer-charts-check.mjs` qualifies canvas rendering, interval endpoints,
legend scope, pointer and keyboard picks, zoom/pan, PNG output, nonfinite/extreme
values, orientation/aspect, all-passing stacks, disposal and 50,000-coordinate
bounded-DOM rendering. Both harnesses write screenshots and JSON summaries to
ignored `web-prototype/results/` directories and do not touch the user's saved
browser library.
