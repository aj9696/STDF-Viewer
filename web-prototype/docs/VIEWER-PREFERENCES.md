# Table and display preferences

Settings persist locally and travel with the portable workspace's declarative
state. Existing saved settings acquire defaults for new fields. Original source
measurements, metadata, orientation and grouping identities are never rewritten
by a display preference.

## Table

The `table` object controls separate software/hardware bins, test time, raw device
flags, test numbers, units, row density and width fitting. Units can be kept as
recorded or displayed with engineering prefixes for recognized SI unit names.
Scientific notation retains recorded-unit values; unknown unit strings are not
interpreted or converted. Charts and exports retain their existing raw numeric
contracts.

Applied-limit labels use each observation's effective low/high limits. Valid
finite numeric results outside those inclusive limits are highlighted. Invalid
measurements are explicitly marked and are not labeled out-of-spec solely from
their recorded number. Functional flags have no numeric capability interpretation.

Optional matrix header rows show stable low/high limits and units, moments,
Cp/Cpk, fail executions, test yield and valid count. Values come from full scoped
analyses supplied to `renderDevices`, never from the current device page. Where
limits change across observations or displayed series, the limit row says
**Varies** and the individual applied limits remain available. Each compared
series gets its own statistics; overlapping aggregate/site series are not pooled.
`Cp = (USL − LSL)/(6 × population sigma)` is unavailable for changing/missing or
unordered limits, zero/nonfinite spread, or FTR. Test yield is known-pass
executions divided by known-pass plus known-fail executions; it is distinct from
device yield.

`renderDevices(..., settings, analyses, sortOptions)` accepts optional
`{onSort, sort, direction}` for semantic clickable headers. Only fields supported
by the device provider's full-population sort are clickable. No current-page-only
numeric sort is presented as a whole-population sort.

## Colors and orientation

`passColor`/`failColor` set presentation colors. `yieldTiers` hold explicit
minimum yield fractions and colors; equality belongs to that tier. Unknown yield
has no inferred tier. `yieldColor(value, settings)` supplies gallery renderers.

Classic, Blue/orange and Grayscale presets set pass/fail and yield colors plus
the first palette page: bins 0–49 and sites 0–15 plus aggregate. Applying a
preset replaces the current color overrides; it does not constrain which bins
the viewer can represent. Reset all colors clears every bin/site override,
restores default outcome colors/tiers and disables yield coloring. These changes
are staged until Save settings and do not reset filters, units or table options.

`coordinateDirection` is `recorded` or RD/RU/LD/LU. The display override returned
by `orientationForDisplay` preserves recorded die aspect ratio and other
geometry. Original XY coordinates and drilldown identities remain unchanged.

## Language coverage

`locale` supports English, Korean and Simplified Chinese for navigation, the
Tools menu, settings controls, and engineering form/action labels in studies,
lot PAT, combined screening, source authoring and document export. English is
the default. Save settings applies the selection immediately; reload and
portable-workspace restore retain it. The existing control remains named
Navigation language in English for compatibility.

Coverage is deliberately explicit, not a claim of complete application
translation. Analytical explanations, technical diagnostics, existing chart
utility controls, some Library/base-viewer dialogs, and documentation remain
English. Exported report content and machine-readable receipts keep their
existing language/schema independently of the UI setting.

`viewer-i18n.js` contains local immutable dictionaries and `tr(label)`. Callers
must pass only product-owned label literals or controlled UI-label constants.
Translate the fixed suffix separately when composing a label around a lot or
source name. Only explicit UI-option lists use `uiChoices`; source/test/lot
choices must retain their labels verbatim. `applyPreferences` updates the
existing navigation IDs, marked Tools options, and document language; it never
walks arbitrary DOM text. Re-rendered engineering forms use the active locale.

Source filenames, test/lot/group names, units, STDF field identifiers, source
text and freeform inputs are never translated. Changing language does not modify
source bytes, identities, numerical inputs or saved machine-readable recipes.

## Test display exclusions

Exclusion rules are optional and disabled by default. `previewTestExclusions`
evaluates supplied analyzed identities and returns every reason, examined count
and hidden keys. Scan test health supplies compact full-catalog statistics up to
20,000 identities; an interrupted/capped scan remains labeled partial. The
settings dialog accepts `analyses` and `scope` and shows that actual scope. It
never starts an unannounced scan. Enabling a rule affects display only, not the
retained source or test identity.

- **No limits:** every populated series has no stable lower or upper limit and
  no changing-limit indication. Changing limits are not misclassified as absent.
- **Constant value:** every populated series has equal minimum/maximum, and
  that same value holds across series. Different constant site values are not
  treated as one constant population.
- **Never judged:** recorded observations exist but all series have zero known
  pass and fail outcomes.
- **Name contains:** case-insensitive literal fragments, up to 32 values of 128
  characters. These are not regexes or SQL patterns.

The viewer shows active exclusion counts and preserves selected tests when a
rule hides them. Compare distributions can explicitly map one differently named
test per group, requiring matching family, unit and channel. This comparison
mapping never changes retained source names or the underlying test identities.

## Chart views

Histogram Auto fits the data-bin extent. Full includes available test limits
and specifications, even if their overlay switches are off. A numeric visible
range changes canvas coordinates without changing histogram bins, selections
or statistics. Hover shares and cumulative shares use supplied population bins.

Trend lines use retained source identity and invalid-run segments. Gaps breaks
those known boundaries; it does not infer devices that never executed the test.
Fails highlights retained known-failing observations. Display reduction may omit
other failures, while full-population counts and interval queries remain exact.
The sigma option shades mean ± three population standard deviations.

Two-dimensional study charts accept optional stable `specLimits` per axis and
full-population regression coefficients on each series. Full appears only when
finite limits are supplied; changing/unknown limits are not fabricated. Numeric
X/Y ranges, population visibility and opacity affect display only. Box hover
reports quartiles, whiskers and outlier counts. Full axis labels remain in the
canvas accessible description even when long visible labels are shortened.

Wafer 3D uses solid die faces, 82% of one original XY coordinate step with the
recorded physical aspect. Faces sort by camera depth, and initial scale fits all
corners; rotation, pan and zoom preserve source-device picking. The relief base
is the displayed minimum, not an implied measurement zero. Categorical bar
widths follow nearest x spacing and are capped at 80 pixels.

`renderValueRange(container, {min,max,mean,median,count,low?,high?,unit?})` draws
a compact range strip from full-population statistics. It includes supplied
limit endpoints in its scale, marks mean/median, and omits empty/nonfinite
populations. It does not recalculate from sampled chart points.

## Qualification

```powershell
node web-prototype/scripts/viewer-preferences-check.mjs
node web-prototype/scripts/viewer-preferences-browser-check.mjs chrome
node web-prototype/scripts/viewer-preferences-browser-check.mjs msedge
node web-prototype/scripts/viewer-localization-check.mjs chrome
node web-prototype/scripts/viewer-localization-check.mjs msedge
node web-prototype/scripts/viewer-charts-check.mjs chrome
node web-prototype/scripts/viewer-charts-check.mjs msedge
node web-prototype/scripts/viewer-study-charts-check.mjs chrome
node web-prototype/scripts/viewer-study-charts-check.mjs msedge
```

The pure checks cover Cp eligibility, inclusive effective-limit comparisons,
invalid values, unit/prefix conversion, yield-tier edges, immutable orientation,
rule previews and schema validation. Focused browser checks render the actual
table/settings modules, verify source text safety, column and statistics rows,
invalid-value highlighting, nested preference persistence and reversible
English/Korean/Chinese navigation, raw-record copy content and clipboard failure
recovery. Chart checks exercise actual drawing operations, viewport validation,
population visibility, regression/spec overlays, gap and failure toggles, sigma
shading, cumulative histogram hover and retained physical wafer aspect.
Provider and full-app qualification remain separate checks.

The localization qualification imports an STDF whose test and lot names match
UI dictionary keys and include hostile-looking markup. In the production
worker/viewer it switches through English, Korean and Chinese, reloads both
translated languages, opens authoring/PAT/report controls, preserves freeform
inputs under preference application, and verifies the source SHA256 and
metadata remain unchanged. It also checks that markup stays literal text.
