# Engineering tools

Open a saved file in the browser viewer, then choose a tool from **Tools** above
the chart tabs. Processing and generated files remain in this browser profile.
Use the app through its local HTTP address, not `file://`.

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
