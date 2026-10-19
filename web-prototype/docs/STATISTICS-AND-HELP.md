# All-test statistics and contextual help

Implementation specification · 2026-10-18

## Engineer workflow

Open **Statistics** to read every test identity in the current workspace. No test
selection is required. Search the result and select a column heading to sort it.
Open a test name to replace the chart selection with that test and display its
histogram. **Selected tests** retains the existing statistics and device matrix
for up to twelve selected identities.

The all-test table uses the active groups, heads, sites, attempt policy and chart
series. Each independent group/head/site population has its own row. Combined
and separate-site populations overlap; do not add their counts. Display rules
that hide tests do not remove identities from this table. Opening a hidden test
from the table explicitly displays it and labels that exception.

Columns include recorded, valid, excluded, pass, fail and unknown counts; mean,
median, population standard deviation, extrema, test limits, Cp, Cpk and test
yield. FTR numeric moments and capability are unavailable because FTR values
encode status flags. A dash means unavailable, not zero. Changing limits and
unavailable capability have explanatory cell tooltips. **Column help** opens
the statistic definitions in the help panel.

## Data contract and limits

`viewer('testSummaries', selection, {tests, seriesBy, includeAggregate})` accepts
1–25 distinct exact identity keys. It returns
`{items:[{test,population,series:[{key,group,head,site,label,stats}]}]}` in request
order. Empty populations return an empty series list. The renderer retains an
explicit zero-observation row so inventory identities do not disappear.

The provider shares the existing `PopulationStats` and exact median computation
with `analyze`. It omits trend points and histogram bins and opens one context per
batch. Numerical semantics, retest rules and source identity do not change.
Requests retain the existing maximum of 64 series per test and a 2 MiB response
budget. Cancellation is checked within observation scans and between tests.

The UI reads the catalog in 200-identity pages without pin enrichment, then computes summaries in
batches of ten. It retains only catalog keys, not pin metadata. It retains at most 20,000 identities and 100,000 population rows.
Exceeding a bound produces a visible error; it never labels a truncated scan
complete. Only 50 rows are mounted at a time. Search and numeric sorting operate
on the entire completed result before pagination, with missing values last in
both directions. A cancelled or failed scan retains completed batches, labels
the result partial, and provides **Resume scan**. Unfinished batches are retried.

Summaries are cached in memory for the current scope. Source/group/filter/series
changes invalidate them. Chart selection, presentation settings, search, sort
and pagination reuse them. Reload computes them again on first entry to
Statistics; it does not change the retained source databases. The all/selected
display mode is local to this page session; the workspace format is unchanged.

## Help contract

**Help** opens a right-side native modal dialog for the active view or tool.
The topic selector also provides all other views, tools and statistical terms.
The panel works with keyboard and touch. Escape closes it and focus returns to
the opener. It respects reduced-motion preferences and fits a narrow viewport.
No network service or uploaded test data is required.

New help uses short, active sentences, explicit instructions and consistent
technical terms based on ASD-STE100. The writing review and source references
are recorded in the help guide. This is not a claim of certified conformance or
an approved-word audit of every application string.

## Acceptance checks

- More than twelve test identities appear without selecting them individually.
- Global numeric sorting, search and pagination preserve exact test keys.
- Summary values match the existing provider, including flags, empty scopes,
  retests, changing limits, source-specific unresolved identities and groups.
- Cancellation never labels partial results complete; resume has no duplicate
  rows. Scope changes cannot show stale results.
- Selected statistics, charts, device matrices and workspace transfer still work.
- Help selects the current topic, covers each shipped tool, traps keyboard focus
  and restores it on close; desktop and narrow screenshots remain readable.

Validation evidence is recorded in `VIEWER-VALIDATION.md`. Publication is recorded
separately in `DEPLOYMENT.md`.
