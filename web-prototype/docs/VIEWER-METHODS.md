# Viewer calculation and population reference

Applies to browser viewer version 1, introduced 2026-09-25. These rules are
separate from the native PAT experiment methods. Use the [engineer guide](VIEWER-UI.md)
for controls and the [qualification record](VIEWER-VALIDATION.md) for evidence.

## Sources, attempts and tests

Original STDF bytes remain immutable. The viewer builds a disposable database
for each saved source. An attempt is identified by source ID and its PIR record
sequence, not by its part label or display index. Display indexes follow PIR
order even when multiple sites finish in a different order. Repeated executions
are retained as separate `(record sequence, result ordinal)` observations.

Files within one group are ordered. Groups are independent comparison
populations. Under **Current attempts**, a later PRR replaces earlier attempts
only when its explicit superseding flag identifies the same head/site/part ID
(bit 0), or the same head/site/WIR context/known X/Y (bit 1). Empty part IDs and
unknown coordinates do not establish replacement. Part-ID replacement can span
ordered members of the same group. Wafer identities stay source/WIR scoped;
equal wafer names in separate files do not silently merge. **All attempts**
retains history in every selected population.

Test identity comprises record family, test number, effective name, base unit,
MPR channel and identity status. A unique omitted name can inherit its recorded
declaration. Ambiguous or unresolved names remain source scoped and never
silently match a test in another source. A physically empty recorded name is
distinct from an omitted field. First recorded defaults apply to later compact
records; local overrides affect their own observation. Raw declarations and
presence information remain inspectable.

MPR results map to PMR pin indexes only when the recorded counts permit an
unambiguous mapping. Otherwise the channel is its result ordinal. PMR names
retain source/head/site provenance. FTR plots display the raw TEST_FLG byte as
a **status value**, with no physical-unit capability calculation.

## Units and eligibility

STDF RESULT, LO_LIMIT and HI_LIMIT are already stored in their base UNITS.
RES_SCAL, LLM_SCAL and HLM_SCAL describe display scaling; they must not be applied
independently before comparison. This viewer calculates in base units. Its
record view retains the original scale fields and R4 bit patterns, including
special IEEE values.

A numeric observation is eligible when its value is finite, TEST_FLG bits 0–5
are clear, and (for PTR/MPR) PARM_FLG bits 0–2 are clear. Valid failed values
remain in numeric statistics. Invalid/nonfinite observations remain in total
and excluded counts. Pass/fail/unknown counts describe flags, independently of
numeric eligibility: TEST_FLG bit 4 or 6 means unknown; otherwise bit 7 means
fail. Device outcome is unknown for PRR aborted/unknown flags (bits 2 or 4),
otherwise bit 3 determines failure. Yield uses passed/(passed+failed), excluding
unknown outcomes, and is unavailable when that denominator is zero.

## Descriptive statistics and capability

Mean and population variance use Welford's streaming update. Population sigma
is `sqrt(sum((x - mean)^2) / n)`, not sample standard deviation. Median is exact:
value-index cursors merge the eligible source populations without loading the
whole population into an array. Even-sized medians average the two middle values.

`Cpk = min(USL - mean, mean - LSL) / (3 * population sigma)`.
Both limits must be finite, constant throughout that population and strictly
ordered, with at least one valid value and nonzero spread. Otherwise Cpk is
unavailable with a reason. Zero spread is not reported as infinite capability.
The default low-Cpk display threshold is 1.33 and is configurable; it is an
investigation marker, not a production acceptance decision. Specification
overlays use separate LO_SPEC/HI_SPEC fields; absent or changing specifications
are withheld and do not replace test limits in the Cpk formula.

## Histograms, trends and selections

Histograms default to 30 equal-width bins over the minimum/maximum eligible
value across all displayed comparison series. Bin count is configurable from
1 to 1,000. Bins are `[low, high)` except the final bin, which includes its high
endpoint. The assignment compares stored edges directly, avoiding floating-point
rounding disagreement with drilldown queries. Constant data receives a symmetric
range padded by `max(abs(value)*0.01, 0.5)`. Empty populations have no bins.

The Gaussian is peak scaled for visual comparison, not a goodness-of-fit test
or probability estimate. Mean, median, test limits, specification limits, and
±3/6/9-sigma overlays are selectable. Histogram bin edges remain common even
when a series is hidden. Zoom and pan change the viewport, not the population.

Trends retain first/last/minimum/maximum points in progressively combined
buckets. This bounds display data and preserves extrema; it is not random
sampling. Statistics and histograms still read all eligible values. Rectangle
picks query the original eligible population within the chosen bounds. Hidden
series do not participate. A picked result is a device-attempt list, so multiple
matching observations on one attempt produce one device row.

## Bins and wafer maps

Hardware/software-bin charts recompute counts from selected device attempts.
Bin 65535 (unrecorded) is excluded from percentages. Names apply only to actual
source/head/site membership, including STDF all-head/all-site summary records.
Conflicting applicable names remain visible. Pass/fail labels come from recorded
device outcomes, with unknown or mixed bins explicitly distinguished.

Wafer maps use WIR context and WCR orientation/die aspect. Unknown coordinates
are excluded. When several selected attempts occupy one die, its color shows the
last selected attempt and drilldown preserves every matching attempt. Stacked
maps count failed attempts at recorded die coordinates across selected wafers;
they do not imply cross-file die genealogy or physically registered wafers.

## Reports and reproducibility

Reports state source identities/hashes, selection, settings and methods. Trend
data in a report is the displayed reduction; histogram counts and test statistics
use full populations. Device CSV/Excel exports contain all observations for the
chosen attempt, beyond the visible page and selected-test list. CSV prefixes
formula-like text with an apostrophe for spreadsheet safety; Excel retains the
original string as a literal text cell. Record workbooks include original bytes
as chunked hex and decoded fields, including raw fallback for unknown records.

Browser and desktop results can intentionally differ: invalid values are
excluded, repeated executions are preserved, incompatible units/unknown
identities are separated, and changing-limit/zero-spread Cpk is withheld. See
[upstream behavior notes](../../docs/upstream-viewer-behavior.md) before treating
an unexplained numerical difference as equivalent analytical policy.
