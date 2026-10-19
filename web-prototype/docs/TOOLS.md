# Engineering tools

Open a saved file in the browser viewer, then choose a tool from **Tools** beside
the chart tabs. Processing and generated files remain in this browser profile.
Use the app through its local HTTP address, not `file://`.

The native Tools selector groups the existing tools without changing their saved
IDs. Use the arrow keys while the selector has focus, or choose with a pointer.

| Group | Tools |
| --- | --- |
| Compare | Dashboard; Compare files / lots; Compare distributions; Scatter 2D / 3D |
| Screening | PAT; PAT by lot; What-If limits; GDBN / cluster detection; Combined screening |
| Wafer | Wafer values / 3D; Wafer gallery |
| Studies | PVT corners; Gauge R&R |
| Utilities | Edit / convert; Reports |

## Investigate

| Tool | What to try |
| --- | --- |
| Dashboard | Device outcomes, site timing, failure tests and bins for the active population. |
| Compare files / lots | Switch the grouping; compare ranked yield, quantities and failing bins. |
| Compare distributions | Select a numeric test; compare histograms, empirical CDFs, box plots, mean, sigma, Cp/Cpk and test yield. |
| Scatter 2D / 3D | Choose two or three tests. Points join on the same original device attempt; missing and invalid combinations are counted separately. |
| Wafer values / 3D | Choose a wafer and test. Rotate 3D views by dragging, pan with right-drag, zoom with the wheel, and double-click to reset. Click a point to inspect its device. |
| Wafer gallery | Compare paged bin, pass/fail, value or 3D maps. Tile yields describe selected attempts; maps use the latest selected attempt at a coordinate. |

To compare renamed tests, select their identities in the catalog, open
**Compare distributions → Compare differently named tests**, and assign one
test to each group. Record family, unit and channel must agree; no unit
conversion or permanent identity merge occurs. Saved results retain the mapping.
Each mapped population uses its own histogram intervals.

**Wafer values → Mean at matching coordinates** averages valid values from each
wafer's latest selected attempt at each XY. Recorded geometry and orientation
must agree. Click a coordinate to inspect its contributors. This view reports
numeric averages, without assigning a device bin or pass/fail outcome.

The existing **Statistics** view includes a device/test matrix. Settings control
its columns, unit formatting, density, limit rows, optional statistical rows and
out-of-limit highlighting. Click a numeric test header to sort by its final
eligible execution across the whole selected population. Missing/invalid final
results appear last in either direction; an earlier valid repeat is not substituted.
The failed-test column reports recorded failing executions, including earlier
executions; it does not change the PRR device outcome.

Use **Find failing tests → Scan test health** to evaluate the full catalog
(up to 20,000 identities). **Settings → Hide tests** previews no-limit, constant,
never-judged and name-fragment rules against those statistics. Cancelled scans
remain labeled partial; unexamined tests stay visible. Exclusions affect display,
including catalog pages, without deleting selections or source records.

**Records → Record type summary** counts complete original sources once, even
when a source is used in multiple comparison groups. Click a source count to
browse that record type; open a record for decoded fields and exact bytes.

## Screen without changing the source

1. Select numeric tests and the desired heads/sites/attempt policy.
2. Open **PAT**, **PAT by lot**, **What-If limits**, **GDBN / cluster detection**, or
   **Combined screening**. Set the parameters and preview.
3. Inspect eligibility, exclusions and decisions. Save the result and recipe.
4. To produce a revised source, choose **Export screened copy**, review affected
   devices, and generate the copies. Import a derived STDF to investigate it.

PAT fits known-passing devices with known-passing, finite, valid final test
results. It requires at least 30 reference devices. Choose mean/sample sigma or
median/scaled MAD, or enter explicit limits. A per-test failure bin can override
the default: the first violated recipe with an explicit bin wins. Blank overrides
do not take precedence over later explicit overrides.

In **PAT**, the checked **Reference population** groups supply the fitted limits;
all groups in the current head/site/attempt scope remain candidates for screening.
The default checks every group. Choose non-overlapping reference groups when the
same source appears in more than one comparison group. The preview lists each
test's reference count, limits, eligibility, exclusions and fit status.

**Limit and bin overrides** holds optional per-test settings. Leave both limits
blank for a fitted interval. Entering either limit selects a manual interval;
the other blank side is unbounded. Endpoints are inclusive. The minimum reference
count applies to fitted intervals, not explicit manual limits.

The primary result counts distinguish devices with at least one eligible selected
test from those with none. Per-test exclusions also account for unavailable fits,
missing/invalid results and nonpassing/unknown outcomes. **Outcome counts** retains
the full selected and projected breakdown. **Save result & recipe** downloads JSON;
**Export screened copy** opens a separate derived-STDF workflow. Changing PAT or
Gauge R&R inputs removes the previous result's actions until the study is rerun.
Changing the viewer scope also clears the displayed study.

**PAT by lot** assigns files explicitly to recipe lots, with separate limits and
bins for each test. Save/load recipes checks source hashes and the complete
selection. The default fits each comparison group independently. Unassigned
files are disclosed and excluded; current-attempt retirement still considers
the original ordered group. **Reference population** permits an explicit
reference group without changing the candidate population.

What-If reports both selected-test outcomes and a conservative overall
projection. It never promotes an existing failed or unknown device to passing
from a subset of tests. Missing results remain distinguishable from passes.

Combined screening evaluates every rule against the original data. Priority
selects the output bin when rules overlap; all matching reasons are retained.
It does not cascade newly failed parts into subsequent neighborhoods.

These are documented open methods, not a claim of proprietary DLOG algorithm
equivalence or an automotive qualification. See [statistical methods](STUDIES-METHODS.md)
and [spatial methods](WAFER-STUDIES.md) for formulas and population rules.

## PVT and Gauge R&R

PVT requires an explicit process label, voltage and temperature for each source.
The app never guesses corners from filenames.

Gauge R&R uses a balanced crossed part/operator/trial design with at least
2 parts × 2 operators × 2 trials. **Download mapping template** fills source and
attempt identities from the selected population. Fill `part`, `operator`, and
`trial`, retain the identity columns, then choose the CSV and a numeric test.
`recordedPartId` is a reference label only. A tester site is not automatically an
operator. Tolerance, when supplied, is the complete USL−LSL width.

The form groups the template and CSV input under **Study mapping**. Optional
tolerance is separate and names the selected test's unit. Validation appears at
the relevant input and focuses that input after a failed submission; an invalid
field inside a closed disclosure is revealed. The worker remains authoritative
for the complete crossed design, independent trial identities, and measurement
eligibility. Unbalanced, duplicate, missing, invalid or out-of-scope observations
reject the study rather than silently dropping rows. CSV files are limited to
4 MiB and studies to 8–20,000 measurements.

The result names the retained-interaction ANOVA method and reports the complete
design, variance components and warnings. Missing tolerance appears as an
unavailable percentage, not zero. **Save result & recipe** includes the explicit
CSV mapping, selected test, tolerance, scope and source provenance, as well as
the calculation; **ANOVA** and **Method & provenance** keep supporting detail
available without expanding the initial form.

### Small reproducible studies

From the repository root, generate the same independent fixtures used by the
numerical and browser checks:

```powershell
.\.venv\Scripts\python.exe web-prototype/scripts/make-study-fixtures.py web-prototype/results/study-demo
```

- Import `study-pat.stdf`, select test **101 · MAIN**, and run PAT with the default
  mean/sample-sigma fit and multiplier 3. Expect 36 devices, 31 eligible, 5 excluded
  and 1 flagged (`PAT-30`). Median/scaled MAD also flags that device. Manual limits
  −1 and 1 retain endpoint values and flag the value 20.
- Import `study-gauge.stdf`, select **101 · MAIN**, and download its mapping
  template. This fixture deliberately encodes 3 parts × 2 operators × 3 trials.
  For each `recordedPartId` of `GRR-p-o-t`, fill `part=p`, `operator=o`, `trial=t`;
  for example `GRR-0-1-2` maps to `0,1,2`. Preserve the downloaded dataset and
  device identity columns. This interpretation is specific to this generated
  exercise; do not infer a real study from arbitrary STDF part IDs.
- Run Gauge R&R with tolerance width 30. Expect repeatability variance 1,
  reproducibility 2, combined gauge variance 3 and total variance 103. The
  negative interaction estimate is clamped to zero with a visible warning.
  Remove one mapped row to exercise the unbalanced-design error, then restore
  it and rerun. The generated `expected.json` records the independent oracle.

## Edit and export

**Edit / convert** stages typed changes and previews before/after values. A bin
remap or format conversion covers the complete source; the viewer's head/site
filters do not silently remove records from an exported STDF. Screening copies
use explicit device identities from the filtered preview instead.

Use **Reports** for PDF, Word, Excel summaries and page images. Generate a report
for the current selection, individual files, lots, or both. **Page layout** sets
page dimensions and image resolution. The footer's **Export report** provides
the existing detailed Excel workbook route. PDF pages are raster images for
consistent Unicode rendering; Word text and tables are editable. Reports include
scope and provenance. Temporary files can be downloaded again or removed through
**Downloads**, independently of the source library.

See [authoring](AUTHORING.md), [ATDF import](ATDF.md),
[document reports](DOCUMENT-REPORTS.md), and the
[manual coverage matrix](../../docs/dlog-coverage.md).

## Limits and compatibility

- Current workspaces support eight distinct sources and twelve selected tests.
- Scatter display is capped at 20,000 points; regression uses all eligible pairs.
- Wafer tools cap a request at 50,000 coordinates. Gallery pages hold at most six
  tiles in the current UI. Numeric value colors share the displayed page's range.
- Screening previews disclose truncation. Truncated decisions cannot be applied.
  A derived plan supports 10,000 changes, equivalent to 5,000 bin/outcome pairs.
- Display exclusion rules affect evaluated tests in the catalog, charts,
  statistics and matrix. They do not remove records or alter calculations.
- Navigation, Tools choices, engineering form/action labels and settings support
  English, Korean and Chinese. Diagnostics, method explanations and guides remain
  English. Source text, test names and STDF field names are never translated.
- SINF, G85 and E142 exports require a target tool's format profile/revision.
  CSV and lossless record JSON are implemented; they are not labeled as those
  standards. Explicit comparison aliases preserve the original test identities.
- Small-fixture correctness and Chrome/Edge UI checks do not establish a
  ten-million-measurement performance qualification for every new study.
