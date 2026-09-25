# Browser engineering studies

The providers in this guide implement open, reproducible methods for the study
workflows named in the supplied DLOG manual. The manual does not disclose PAT,
neighborhood, PVT or Gauge R&R algorithms. These methods therefore have their own
version identifier, `open-studies-v1`; no numerical equivalence is claimed.

## Population and identity

All requests use the existing validated viewer selection: comparison groups,
ordered source IDs, heads, sites and current/all attempts. A device identity is
`{group, datasetId, deviceId}`. Test keys include record family, number, name,
unit, MPR channel and unresolved declaration scope. Different files are never
joined by row position or an unqualified part ID.

Scatter, PAT, What-If, PVT and Gauge use the final recorded execution of each
selected test within each device attempt. Select the greatest `(seq, ordinal)`
**before** checking validity. An invalid final execution does not fall back to
an earlier valid value. Missing tests and invalid numeric readings are distinct.
Normal viewer comparisons continue to include every recorded execution.

Numeric eligibility follows the viewer's existing policy: a finite value,
`TEST_FLG & 0x3f == 0`, and `PARM_FLG & 7 == 0`. Only PTR and numeric MPR channels
are accepted by these studies. Raw FTR status bytes are not physical values.
Values and limits use their STDF base units. No independent `_SCAL` conversion
is applied before comparison. Known numeric failures remain eligible for
descriptive statistics, correlation, PVT and Gauge; PAT is more restrictive.

## Comparison distributions

`compareDistributions(view, {testKey, seriesBy?, includeAggregate?, bins?,
maxCdfPoints?})` returns the normal test analysis with additional `stats.cp`,
`stats.testYield`, `distribution` on each series, and `dutGroups`.

- Mean and population standard deviation use all numerically eligible recorded
  observations, including valid failures. Retest/head/site selection still applies.
- For probability `p`, the quantile position is `(n-1)*p`. Interpolate linearly
  between the surrounding sorted observations. Q1, median and Q3 use p=.25,.5,.75.
- Box fences are `Q1 - 1.5*(Q3-Q1)` and `Q3 + 1.5*(Q3-Q1)`. Whiskers are the
  minimum/maximum observed values inside the inclusive fences. Outlier count is
  exact. A box does not discard those outliers from other statistics.
- Empirical CDF points contain `{value, probability}` with probability equal to
  the full-population proportion at or below that value, including all ties.
  Display uses at most 2,001 selected ranks (default 1,001); ties can reduce the
  returned point count. `cdfReduced` indicates a population above the display
  budget. Quantiles and counts are never calculated from sampled display points.
- `Cp=(USL-LSL)/(6σ)`. Cpk retains the existing minimum-distance formula and
  population σ. Both are unavailable for changing, missing, reversed or equal
  limits, zero spread, or no valid observations. These descriptive indices do
  not establish normality or process stability.
- Test yield is known test passes divided by known test passes plus failures.
  DUT yield is separately reported from PRR outcomes. Unknown outcomes are
  reported but omitted from either known-outcome denominator.

The comparison provider uses sorted value indexes, a bounded cursor merge and
three distribution/statistics passes. It does not load all observations into a
JavaScript array or request a population-sized SQL sort.

## Correlation and scatter

`correlateTests(view, {tests: [xKey,yKey,zKey?], maxPoints?, seriesBy?})` returns
`tests`, `population`, `displayed`, `sampled`, and `series`. Each series contains
`regression`, `correlations.xy/xz/yz`, and bounded `points` with source/device
identity, original observation identities, values and PRR outcome.

Only complete, numerically eligible device vectors contribute to the scatter
statistics. Missing has precedence over invalid in the exclusive population
counts. Streaming centered sums calculate covariance, Pearson r, r² and ordinary
least-squares Y-on-X slope/intercept. Statistics use all complete vectors. Fewer
than two vectors or either constant axis gives an explicit unavailable reason.
Three-axis results calculate all three pairwise correlations from the same
complete-vector population.

Display is a deterministic seeded reservoir of at most 20,000 devices across
all series (default 10,000). This budget is global, not per head or site. A small
series can have valid statistics but no displayed point when the sample is very
small. The sample never supplies the regression calculation.

## PAT and What-If

`previewScreening(view, options)` accepts `method: 'pat'|'whatif'`, up to twelve
`recipes: [{testKey,low?,high?,failBin?}]`, and a preview `limit` from 1 to 20,000 (default
1,000). PAT also accepts `tests: [testKey,...]` without manual limits, `fit:
'sigma'|'mad'`, `k` and `referenceGroups`. Reference groups default to all groups
in the current selection. As elsewhere, a source explicitly repeated in two
groups represents two selected populations; choose reference groups deliberately.

PAT fits and evaluates only final eligible numeric readings with a known-passing
test and known-passing PRR. It offers single-pass fits:

| Method | Center | Spread | Inclusive accepted interval |
|---|---|---|---|
| `sigma` | arithmetic mean | sample SD, denominator n−1 | center ± k×spread |
| `mad` | median | 1.4826 × median absolute deviation | center ± k×spread |

The multiplier is finite and in [0.5,10], default 3. At least 30 eligible
reference devices are required. Insufficient or zero-dispersion references
return a per-test unavailable reason and do not produce invented bounds.
Explicit per-test manual bounds bypass fitting and may be one-sided. Equality
passes; only strict outside values are flagged. PAT is an engineering screen,
not an AEC qualification or an iterative production DPAT implementation.

Exact median/MAD use sorted source cursors. For absolute deviations, left and
right value-index cursors move outward from the median and are merged by
distance; no `ORDER BY ABS(value-center)` temporary sort is needed.

What-If requires at least one explicit finite bound per test. A violation of any
selected test produces a selected-test failure. Otherwise a missing/invalid
selected test gives an unknown result; all selected tests inside their limits
give a selected-test pass. The conservative whole-device projection only demotes
original passing PRRs. Original failures and unknown PRRs retain their outcome
because unselected tests may explain the original disposition.

Every result contains `methodVersion`, `populationPolicy`, `sources` (including
SHA-256), the exact `recipe` and selection, `summary`, per-test fit/count data,
and `decisions`. A decision contains group/source/device/PRR identity and reasons
with original test key, sequence, ordinal, value and applied bounds. What-If
decisions include all selected-test violations; a derived conservative rebin
must apply only `originalOutcome==='pass' && projectedOutcome==='fail'`.

An optional per-test `failBin` selects a derived software bin. When several
tests fail, the first violated recipe with an explicit `failBin` supplies the
decision's `toBin`; a preceding violation without an override does not prevent
a later explicit override. If none has an override, the authoring action's
default failure bin applies. Recipe order and all violated reasons remain in
the preview. Original PRR flags are retained in decision identity so a derived
failure can preserve unrelated flag bits.

`decisionsTruncated` is explicit. Consumers must not apply a truncated preview
as if it were the full result. Narrow the selection or implement a complete
streaming application. These providers never mutate original source or cache.

## Explicit PAT recipes by lot

`previewPatLotRecipes(view, {lots, limit?})` screens explicitly assigned lot
populations. A lot has `{id, name, datasetIds, fit, k, failBin, recipes,
referenceGroups?}`. Membership is supplied by the engineer; MIR lot names do
not silently assign a policy. Each source may belong to at most one lot, with
up to eight lots and twelve numeric test recipes per lot. Unassigned selected
sources are listed explicitly and are not screened.

By default, each lot is fitted and screened independently within each existing
comparison group. This retains source/group identity and avoids weighting a
source twice merely because it appears in two groups. Explicit reference group
indices may override the reference population. References must contain sources
from the lot and must not overlap on the same source. Standalone and combined
PAT enforce the same non-overlap rule for fitted references: fifteen physical
measurements in two groups cannot satisfy the thirty-device minimum.

Lot membership filters the reference and candidate streams while keeping the
original full source context for current-attempt retirement. An earlier part
explicitly superseded by a later source remains retired even if the later
source is assigned to another lot or is not screened. Original head/site
filters, comparison group numbers and source order are preserved. Rules never
use earlier screening results as input. Manual bounds retain the same inclusive
semantics and optional per-test bin precedence as ordinary PAT.

The result contains full counts, per-lot/group fits in `runs`, a bounded union
of decisions carrying `lotId`/`lotName`, and the complete recipe/source
provenance. `limit` caps the entire result, not each lot separately. A truncated
union remains visible as a preview and cannot be exported as a complete derived
revision. Conflicting proposals for the same original part across comparison
groups are rejected by the existing derived-copy exporter.

**PAT by lot** exposes explicit source assignment, per-lot fit/multiplier/bin,
per-test manual bounds/bin, and optional reference group numbers. Recipe JSON
uses format `semidata-pat-lot-recipes`, version 1. Save/load binds recipes to
source SHA-256 and the exact normalized selection (groups, source order,
head/site filters and attempt policy). A different scope or source hash rejects
with an actionable message. Recipe uploads are limited to 1 MiB.

**Combined screening** exposes independent GDBN and CD controls for radius,
minimum known/failing neighbors, cluster size, failure density, connectivity,
uniform/distance-weighted density, exemptions and failure bins. All six PAT /
GDBN / CD precedence orders are selectable. PAT controls include per-test
limits/bins and reference groups. Each enabled method still reads original
data independently; first matching rule chooses the bin and every reason is
retained. Parameters irrelevant to a method remain recorded but do not change
that method's documented formula.

Focused verification:

```powershell
node web-prototype/scripts/viewer-pat-recipes-check.mjs chrome
node web-prototype/scripts/viewer-pat-recipes-check.mjs msedge
```

`make-pat-lot-fixtures.py` independently encodes two distinct numeric centers,
cross-source retests, a filtered head/site, invalid final readings, unknown and
failed parts, and a fifteen-part reference. Six check groups cover exact MAD
fits/counts, cross-lot retirement, reversed comparison source order, inclusive
manual limits, bins, global truncation, cancellation, scope/hash validation,
reference duplication rejection and real browser recipe save/load. Chrome and
Edge passed on 25 September 2026; evidence is in
`results/viewer-pat-recipes-chrome-1790358014264` and
`results/viewer-pat-recipes-msedge-1790358014268`. Existing study checks also
passed all six groups after the streaming filter addition.

## PVT corners

`pvtStudy(view, {testKey, corners:[{datasetId,process,voltage,temperature}]})`
requires explicit source assignments. Process is a nonempty label; voltage and
temperature are finite numeric engineering conditions. Neither is inferred from
a filename. Sources with equal condition triples are pooled. Selection groups
retain their explicit populations, so repeating a source in groups repeats its
measurements. Unassigned devices are counted separately.

Each returned corner includes conditions, source IDs, device/missing/invalid
counts and exact mean/median/population σ/range/Cpk using the final-execution
policy. PVT labels organize descriptive measurements; the provider does not fit
an unrequested physical response model or extrapolate missing corners.

## Gauge R&R

`gaugeStudy(view, {testKey, rows:[{datasetId,deviceId,part,operator,trial}],
tolerance?})` resolves explicit device mappings to final valid observations.
`computeGauge(rows, {tolerance?})` exposes the same pure calculation for already
mapped `{part,operator,trial,value}` data. Site is never silently treated as an
operator. One original observation cannot be reused as independent trials.

The implemented design is balanced crossed random-effects ANOVA with retained
part/operator interaction: at least two parts, two operators and two repeats in
every part/operator cell. Each cell must have unique trial labels and equal
repeat count. Missing, invalid, duplicate, unbalanced and out-of-scope mappings
reject with an actionable error. The bound is 20,000 mapped measurements.

For P parts, O operators and R repeats, mean squares produce:

| Component | Raw variance estimate |
|---|---|
| Repeatability | MS(error) |
| Part × operator | [MS(interaction) − MS(error)] / R |
| Operator | [MS(operator) − MS(interaction)] / (P×R) |
| Part | [MS(part) − MS(interaction)] / (O×R) |

Negative estimates clamp to zero; raw estimates and a warning remain in output.
Reproducibility is operator plus interaction variance. Total Gauge variance is
repeatability plus reproducibility; total variance adds part variance. The
report includes ANOVA SS/df/MS, cell means/sample SD, all variance components,
standard deviations, 6σ study variation, percent variance contribution, percent
study variation and optional `100×6σ/tolerance`. Tolerance is a positive full
specification width. Zero total spread leaves percentages unavailable. Distinct
categories use `floor(1.41×σ_part/σ_gauge)` when Gauge spread is positive.
No interaction pooling, p-value threshold decision or automatic acceptance
classification is performed.

## Verification and limits

Run from the repository root:

```powershell
node web-prototype/scripts/viewer-studies-check.mjs chrome
node web-prototype/scripts/viewer-studies-check.mjs msedge
```

`make-study-fixtures.py` independently encodes small STDF files with Python's
standard library. The browser checks import through the production Rust/WASM
parser and SQLite caches. Little- and big-endian fixtures test sparse/repeated
axes, invalid final executions, deterministic 3D points, full statistics,
quartiles/CDF/Cp, unknown outcomes, What-If, PVT, PAT reference/threshold behavior,
and cancellation. The balanced 3×2×3 Gauge oracle independently supplies sums of
squares and variance components. Actual query plans reject temporary sorts in
the median/MAD scans. Results are written under ignored `results/` directories.

These checks establish correctness on bounded fixtures. Existing 10-million-
measurement viewer benchmarks do not establish throughput for these newly added
studies. Every provider remains cancellable between source/device pages or
4,096 scanned observations. Large Gauge designs reject before allocation beyond
their stated row budget. Browser memory figures are not inferred from SQL plans.

Statistical references: [NIST process capability](https://www.itl.nist.gov/div898/handbook/pmc/section1/pmc16.htm),
[NIST box plots](https://itl.nist.gov/div898/handbook/eda/section3/boxplot.htm), and
[NIST measurement repeatability](https://itl.nist.gov/div898/handbook/mpc/section4/mpc441.htm).
