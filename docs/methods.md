# Calculation reference

Version: SemiData engine 0.1.1. These rules apply to the workbench, not every
calculation offered by the upstream desktop viewer.

## Test identity and units

Scalar parametric results (PTR) are matched by the exact tuple of test number,
test name, and parser-stored unit. Different units are separate selections.
The parser scales results using its retained RES_SCAL policy. The workbench
uses those stored values without additional unit conversion. Test number alone
does not establish equivalence across products or program revisions. Engineers
must select compatible datasets; automated program-version reconciliation is
not implemented.

Compact PTR compatibility (0.1.1): when a PTR ends immediately after RESULT,
its TEST_TXT field is physically absent. The importer reuses the sole prior PTR
identity for that test number within the file, preserving its metadata and
defaults. Multiple prior names make the record ambiguous and import fails.
With no prior identity it remains unnamed. An explicitly encoded empty name
remains a separate identity. This is a documented producer compatibility
policy, not a claim that STDF mandates inheritance of TEST_TXT.

Existing databases are immutable and are not repaired on open. If a 0.1.0
import split compact PTRs into named and unnamed tests, import the original
source into a new workspace using 0.1.1; same-workspace deduplication otherwise
returns the existing dataset. Keep old saved runs with their original evidence.

## Attempts and device identity

The stable measurement identity is dataset ID + DUT index + test identity.
Part IDs alone are not assumed globally unique. Current means upstream
Supersede=0 within each source; All includes superseded attempts. Files are
independent. Neither mode consolidates retests across files or guarantees one
row per physical device across a selected library.

The upstream parser retains one value per DUT/test. Repeated PTRs with the same
identity overwrite earlier values. Import warnings identify a count reduction;
the original bytes remain available for future reprocessing. Screening results
refer to retained measurement attempts, not automatically unique shipped units.

## Measurement validity

Explore requires a finite numeric result, TEST_FLG bits 0–5 clear, and PARM_FLG
bits 0–2 clear. This deliberately excludes alarms, invalid/unreliable results,
timeouts, unexecuted/aborted tests, and scale/drift/oscillation errors. A known
failed measurement may still be numerically valid and is included in Explore.

PAT additionally requires TEST_FLG bits 6–7 clear and PRR PART_FLG bits 2–4
clear: a known passing test on a normally completed, known passing DUT.
Unknown pass/fail is not treated as passing. Eligibility masks are regression
tested. The PTR parameter flag byte is preserved by this fork's Rust pipeline.

Reference: STDF V4 specification, PTR TEST_FLG/PARM_FLG and PRR PART_FLG.
https://storage.googleapis.com/google-code-archive-downloads/v2/code.google.com/stdf-eclipse/Stdf-V4-spec.pdf

## Descriptive statistics

Mean is arithmetic mean; median is the usual middle value (average of the two
middle values for even n). Standard deviation is sample SD with denominator
n−1; it is unavailable for n < 2. Minimum and maximum use the valid population.

Displayed Cpk = min(USL − mean, mean − LSL) / (3 × sample SD).
It is withheld for zero dispersion, missing/nonfinite limits, reversed limits,
mixed limits, or any dynamic-limit records for that test in a selected source.
Withholding is conservative: the workbench does not infer a dynamic Cpk.
This overall-sample calculation is not a within-subgroup capability estimator;
distribution suitability and process stability remain engineering judgments.

Statistics and the histogram use every valid selected measurement up to the
500,000-row evaluation limit. The ordered plot displays at most 800 regularly
spaced measurements and labels sampling. Source order is not wall-clock time.

## PAT experiments

Each screen fits once to the eligible reference population, then evaluates
eligible measurements in the selected population. An empty reference selection
uses the evaluation population as its own reference. References must include at
least 30 eligible measurements; this is a product guardrail, not a qualification
standard. A zero-dispersion reference is rejected.

- Sigma: center = mean; spread = sample SD.
- MAD: center = median; spread = 1.4826 × median(abs(value − median)). The factor
  makes MAD a normal-consistent scale estimate; it does not establish normality.
- Lower = center − k × spread; upper = center + k × spread; 0.5 ≤ k ≤ 10.
- Values exactly on a bound remain inside. Only strictly outside values flag.
- Flagged percentage = flagged eligible measurements / all eligible evaluated
  measurements × 100. It is not final production yield or DPM.

Both methods are single-pass engineering screens. There is no iterative
outlier removal, minimum/maximum specification clamp, reference qualification,
automatic multisite normalization, AEC-Q001 certification, or qualified DPAT
recipe in this release. Evaluate performance using your own test program and
validated reference cases before extending this to production workflows.

## Reproducibility and exports

Saving recalculates the current recipe and stores its exact inputs, source
hashes, engine version, reference/eligible counts, center/spread, limits, and
all affected rows in a single catalog transaction. Saved runs never rewrite
raw data or bins. The UI/API shows the first 1,000 flagged rows; CSV contains
all rows and the run ID, method, multiplier, bounds, and unit. Textual CSV values
that could be spreadsheet formulas are prefixed with an apostrophe. Numeric
negative measurements remain numeric.

## Time interpretation

Import timestamps are UTC. Source START_T is interpreted as Unix epoch seconds
and displayed in ISO UTC. STDF producer clock/time-zone conventions vary; this
release does not reconcile tester clocks. Treat source dates as metadata until
verified against your generating system. No time-based aggregation depends on
this interpretation in 0.1.
