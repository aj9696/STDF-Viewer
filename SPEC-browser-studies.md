# Browser studies and DLOG feature expansion

## Objective

Implement the engineering workflows described in the supplied DLOG v1.0 manual,
with the existing compact browser UI and local storage. This extends the same
authorized browser product; earlier one-feature/PAT deferral points no longer
limit the requested scope. Original source files and retained-v1/v2 databases
stay immutable. New actions need explicit controls, real outputs and tests.

## Boundaries and contracts

The capability map in `CAPABILITIES.md` defines investigation, studies, wafer
studies, authoring and report-format modules. Manual page references use physical
PDF page numbers. The reference PDF and extracted pages stay outside tracked
source. Reimplement behavior; do not copy screenshots, branding or prose.

- Worker `viewer` action `advanced` opens the same validated viewer context and
  dispatches an allowlisted `options.kind`. Root owns this dispatch integration.
- Provider functions take `(view, options)` and return plain serializable data,
  method version, population/exclusion counts and warnings. Cancellation uses
  the existing context, with yields during long scans. Device identity includes
  comparison group, source dataset and original device ID.
- New `viewerAuthoring` worker requests take allowlisted actions and options;
  source membership and every identifier/value are validated before file access.
  Derived output is staged separately, closed and verified before publication.
- Each provider owns its query implementation. UI modules call public client
  requests, never SQL or OPFS directly. No server upload or remote data service.
- Existing exact statistics and eligibility policies remain unchanged. New
  features report explicit sampling/resource limits rather than silent truncation.
- Tests/recipes/edits preserve test identity including unit, family and MPR channel.

## Numerical behavior

Scatter joins final recorded executions of two or three numeric test identities
within the same device attempt. Select the final execution before assessing
validity; never substitute an earlier valid value for a later invalid value.
Report excluded/missing counts. Streaming full-population covariance produces
Pearson r, r², OLS slope/intercept; a deterministic bounded sample draws points.
Constant axes or insufficient pairs report unavailable regression. Every shown
point can open its actual source attempt. 3D provides rotation/pan/zoom/reset.

Compare uses existing inclusive base-unit populations. Add exact Q1/Q2/Q3 using
linear `(n-1)*p` interpolation, observed Tukey 1.5-IQR whiskers, bounded ECDF
display steps, Cp under the same stable-limit/positive-spread checks as Cpk, and
separate labelled test/DUT yields. Source/lot comparisons retain unknown results.
Explicit comparison aliases map one selected identity to each comparison group,
requiring identical numeric family, unit and channel. Original names/numbers
remain distinct; receipts retain the mapping. Histogram intervals may differ by
mapped population. No inferred name matching or implicit unit conversion occurs.

PAT uses known-pass devices and known-pass valid finite numeric test references.
Offer mean ± k·sample SD and median ± k·1.4826·MAD; default minimum reference 30,
k in [0.5,10]. Equality passes; insufficient/zero-spread references give explicit
unavailable results. Manual limits are explicit per-test overrides. Preserve
reference selection, method, multiplier, source hashes and exclusion counts.
These are open methods, not claims of equivalent undisclosed DLOG algorithms.
Reference groups must not count a retained source twice. Per-lot recipes use
explicit source membership and fit each candidate group independently by default.
The original ordered group remains intact when deciding current attempts,
including when a later retest source belongs to a different recipe lot. Manual
per-test bins take precedence only when explicitly present on a violated recipe.

GDBN/CD operate on recorded wafer coordinates within one source/WIR context.
Radius, minimum eligible neighbors/cluster size, fail fraction and connectivity
are visible recipe parameters. Never treat missing coordinates as passing dies
or mix different wafers at the same XY. Return preview decisions and counts;
application produces a derived copy. Define exact rules in the methods guide.

What-If accepts explicit inclusive lower/upper limits for selected tests. Missing
and invalid readings remain separate. Report selected-test projected outcomes
and conservative overall demotions separately; do not silently promote a failed
device when unselected tests may explain its failure.

PVT uses explicit process/voltage/temperature labels per source. Never infer
conditions from filenames. Gauge R&R requires explicit operator/part/trial
mapping, complete balanced crossed designs (≥2 parts/operators/repeats), and
two-way interaction ANOVA. Negative variance components clamp to zero with
disclosure. Site is not assumed to mean operator. Unsupported designs fail
clearly. The manual names these tools without specifying their algorithms.

## Investigation and editing

Dashboard summarizes current scope, metadata, timing, per-site yield, failure
ranking, bins and wafer preview. Grid options include visibility/density/unit
formatting, valid out-of-limit highlighting, limit/unit rows and selected-test
summary rows. Record summary groups by STDF type and supports bounded drilldown.

Wafer views include bins/pass-fail/value gradient, 2D/3D, hover/pinned die,
distribution/range and independent wafer tiles sortable by file/yield. Keep
source orientation and manual display override distinct. Settings include
pass/fail/bin/yield colors, coordinate display and hiding non-judging tests.
Numeric coordinate roll-up averages valid latest-per-wafer values only when
recorded geometry/orientation agree; retain contributor identities and never
invent an aggregate device outcome. Full-catalog exclusion scanning caches only
summary statistics for up to 20,000 identities. Partial scans disclose their
scope and never hide unexamined identities. Numeric table sorting uses final
recorded execution before assessing validity and puts invalid/missing last.

Authoring is explicit: edit one attempt's bin/outcome or recorded measurement,
edit supported header/bin/test/note fields, bulk remap with preview counts, and
apply screening recipes. Preserve untouched records exactly when possible and
recompute affected summary metadata when emitting derived STDF. Never label an
export a valid full STDF if required records/summary consistency are unresolved.
Unsupported record mutations must reject visibly. ATDF conversion follows its
documented field and flag mapping, not STDF binary field order.

Batch export offers CSV/JSON and verified format profiles. SINF/G85/E142 need
identified dialect/revision, orientation conventions and validation examples;
the manual supplies none, so request downstream tools and track unresolved
compatibility rather than emitting generic XML under a standards-compliant label.
"Full" is ambiguous and must describe the actual bundle contents.

Reports reuse the current selection/methods/source provenance and add PDF, Word,
image and PAT sections with single-file/lot scopes. Output receipt lists actual
completed files; failures and cancellations cannot claim successful outputs.
Browser file/download mechanisms replace native arbitrary output-folder writes.

## UI

Keep Library → test → chart as the default. Put additional workflows in grouped
tools/view menus and focused panels. No new marketing text or permanent ribbon
wall. Parameters remain available through disclosures; active filters and result
limitations remain visible. Preserve keyboard/focus, Escape and loading/error
behavior. English/Korean/Chinese UI choices apply to product controls, not source
data or record field names; document coverage honestly.

## Implementation and verification

Source `web-prototype/site`, Rust parser `web-prototype/rust`, harnesses
`web-prototype/scripts`, guides `web-prototype/docs`, evidence
`web-prototype/evidence`. Use existing ES modules, two-space indentation,
text-safe DOM rendering, bound SQL parameters and existing pinned dependencies.

Commands from repository root:

```powershell
./web-prototype/build.ps1
node web-prototype/scripts/frontend-check.mjs chrome
node web-prototype/scripts/viewer-e2e-check.mjs chrome
node web-prototype/scripts/viewer-e2e-check.mjs msedge
./.venv/Scripts/python.exe web-prototype/scripts/make-examples.py --check
```

Add feature-specific independent fixtures and meaningful tests before claiming
each new workflow: mismatched/sparse/repeated test joins, hand-computed quartiles
and regression, known PAT outliers and edge neighborhoods, balanced GRR oracle,
edit/derive/reimport roundtrip, original hashes unchanged, malformed ATDF and
format validation, real rendered/downloaded reports. Record additional commands
in corresponding guides. Run targeted checks per slice, existing app regression
after integration and visual inspection at desktop/360px. No throughput claim
extends old 10M evidence to newly added algorithms without measurement.
