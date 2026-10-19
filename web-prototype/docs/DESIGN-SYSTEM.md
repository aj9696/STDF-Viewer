# SemiData interface direction

## Intent and screen questions

This is a working instrument for a test engineer, not a yield marketing dashboard.
Library answers “Which source should I open or compare?” Viewer answers “What does
this test do in the selected populations?” A study answers “What inputs and method
produced this result?” The interface does not invent a finding from the selected
test. Numbers, source names and eligibility statements come from the provider.

The design uses these product facts: retained STDF sources; multiple independent
comparison populations; test numbers and record families; head/site identities;
retest policy; original die coordinates; explicit engineering units; full-population
statistics; source fingerprints; local browser persistence; portable workspaces;
and deliberate reference/mapping selection for PAT and Gauge R&R.

## Direction and identity

Taste app-screen draw, seed `20261019`, analytics/detail/list/settings, light theme.
Considered accent-ladder, framed-sheet and achromatic-ledger. Selected framed-sheet:
one cool grey frame around a white work sheet, without resting shadows. It gives
the plots a continuous surface while keeping the catalog and navigation distinct.
There is no global sidebar because the app has only two primary destinations.

The face is a low-chroma teal-grey frame with IBM Plex Sans and restrained Plex Mono
for test identifiers, byte records and library figures. A notched wafer with a die
grid is the product mark. The selected test’s numbered catalog row and matching
plot identity are the signature: a real investigation state, not a decorative card.

## Tokens and layout

`site/app.css` owns shared semantic tokens; viewer, chart and study CSS consume them.

| Token | Value | Use |
| --- | --- | --- |
| `--ground` | `#eaf0f0` | Frame |
| `--surface` | `#ffffff` | Work sheet and plots |
| `--raised` | `#f4f7f7` | Catalog and grouped fields |
| `--ink` | `#172b2d` | Main text |
| `--muted` | `#58696b` | Labels and secondary text |
| `--blue` | `#1b6c80` | Existing accent token, now teal |
| `--action` | `#183d43` | Primary action |
| `--border` / `--rule` | `#dce4e4` / `#e9eeee` | Structural and table rules |
| `--control` | `#bac8ca` | Input edges |

The top bar is 48px. The sheet is inset 8px with 16px corners and 24px content
padding. The desktop test catalog is 228px; remaining width belongs to results.
At 760px and below the outer sheet becomes the screen and the catalog collapses.
Wide tables scroll internally. Controls use at least 44px touch targets on phones.

Titles use 22–26px, section titles 16px, normal controls 14px and dense labels 12px.
Values retain the requested precision and notation. Table figures align right.
Default chart fonts are loaded before canvas labels are painted or exported.
Existing saved system/local font choices remain authoritative, including identifiers.

## Assets, compatibility and scope

The app serves the bundled IBM Plex WOFF2 files from its own origin. Exact upstream
revision, source paths and OFL license are in `site/fonts/README.md` and `LICENSE.txt`.
No new runtime service, framework, analysis method or data migration is introduced.
The previous font names remain accepted in settings and portable workspaces.

Data colors remain under existing site/bin and user preferences. Engineering
comparisons need more than three distinguishable series; the marketing color-budget
rule does not justify suppressing series or changing their meanings. Full extrema,
limits, source labels, unavailable values and reduction notices remain visible.
Mono is used for real identifiers and figures, as allowed by the dealt app sheet.
Inset selection/tab rules are state indicators, not decorative shadows. Overlays
retain shadows for separation. Numeric/source tables may overflow inside their own
scroll containers, never the page.

## Review protocol

Inspect real synthetic STDF workflows at 1440, 768 and 390px, including empty states,
Library, site comparison, PAT and Gauge forms. Use the existing suites for import,
selection, chart inspection, settings, exports and workspace round trips. Run Taste
static lint and browser inspection and record justified exceptions. Production
publication requires a clean package and separate deployed-asset/workflow checks.

### Visual review record

Three corrections after the first screenshot pass: replaced the external header
image with the inline wafer SVG, replaced a text chevron with a CSS shape to avoid
server-encoding dependence, and made the higher-specificity header actions 44px
on phones. Removed an inherited rotation from the mark. Independent review also
corrected the bundled-font failure notice to direct users to Settings, including
when an imported workspace saves the fallback font.

Taste lint and browser inspection report no failures. Remaining warnings have
specific reasons: 11–12px text is used for source sublines, chart legends, axes,
metadata and table headings; test titles and actionable primary fields are larger.
The empty Library keeps a full-height work sheet rather than stretching a content
card. Static lint sees legacy eyebrow selectors, a storage-context label, monospace
identifiers, overlay shadows and inset active-state rules. These are not marketing
ornaments. The only gradient is an existing moving indeterminate import-progress
indicator; reduced-motion handling remains in place. The phone header uses a 16px
edge margin after review.

Self-review using the app-screen rubric: design 8, usability 8, creativity 7,
content 9 (weighted 7.9). This is an internal design judgment, not a user-study
result. The main remaining compromise is the vertical space required by explicit
multi-source legends and touch controls on phones; desktop investigation remains
the primary workflow. No label is shortened at the expense of source identity.
