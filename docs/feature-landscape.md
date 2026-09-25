# Semiconductor test-data feature comparison

Reviewed: 2026-09-24. Purpose: a sourced feature inventory for deciding SemiData's
next browser features with the test engineer. This is a planning reference, not
an implementation commitment, vendor evaluation or claim of feature parity.

## How to read this comparison

Entries describe features documented by the vendors, not independently tested
behavior. **Not verified** means the reviewed public material did not establish
that capability; it does not mean the product lacks it. Features with different
names or workflows are described rather than treated as identical checkboxes.

The columns compare product families, not equivalent base licenses:

- **DR YIELD:** YieldWatchDog; Advanced Quality Module (AQM/PAT) is optional;
  [XI][D6] and [Defect Module][D7] provide additional capabilities. [AQM scope][D4]
- **Galaxy:** Examinator-Pro provides engineering analysis; Yield-Man adds data
  management/automation; PAT-Man provides screening recipes and automation.
  Lite variants expose subsets. [Examinator-Pro][G1], [Yield-Man][G2], [PAT-Man][G3]
- **yieldHUB:** the platform, NPI/Characterise, Live and outlier-detection/PAT
  offerings cover different workflows. [Platform][Y1], [Characterise][Y8], [PAT][Y3]

## Exploration and comparison

| ID | Feature | DR YIELD / YieldWatchDog | Galaxy family | yieldHUB |
| --- | --- | --- | --- | --- |
| F01 | Test/device drill-down | [Die metadata drill-down][D1] | [Interactive report drill-down][G1] | [Test and part drill-down][Y5] |
| F02 | Histograms and overlaid distributions | [Grouped/stacked; lot/site splits][D1] | [Histograms; multisite overlays][G7] | [Multi-test histograms; site coloring][Y5] |
| F03 | Box plots | [Documented][D1] | Not verified | [WAT/lot box plots][Y6] |
| F04 | Statistics and capability indices | Distributions documented; Cp/Cpk not verified | [Mean, sigma, skew, Cp/Cpk][G7] | [Cp/Cpk customer example][Y9] |
| F05 | Scatter plots and correlation | [Fitted scatter plots; R²][D1] | [Scatterplots][G8]; [correlation reports][G7] | [Scatter charts][Y7]; [indexed correlation][Y1] |
| F06 | Lot/site/equipment comparison | [Metadata splits][D1]; [equipment comparisons][D2] | [Multisite overlays; tester correlation][G7] | [Site, tester, board and program comparisons][Y2] |
| F07 | Historical trends | [Parameter/failure trends][D1] | [Trends; Yield-Man monitoring][G2] | [Historical lot and parameter trends][Y2] |
| F08 | Bin and pass/fail wafer maps | [Hard/soft-bin and fail-category maps][D1] | [Bin wafer maps][G7] | [Bin wafer maps][Y4] |
| F09 | Parametric wafer maps, galleries and stacks | [Parametric maps, galleries, stacks][D1] | [Parametric maps and stacking][G7] | [Parametric maps and wafer stacking][Y4] |
| F10 | Yield, bins and failure Pareto | [Bin/failure/yield-loss Pareto][D1] | [Bin/failure/Cpk Pareto][G7] | [Failure Pareto and bin analysis][Y2] |
| F11 | Retest and test-stage comparison | [Pass/fail flip maps][D1]; consolidation policy not verified | [Automatic retest consolidation][G2]; [virtual limit-based retest][G7] | [Rescreen/retest and CP1/CP2 analysis][Y4] |
| F12 | Test-time analysis | Not verified | [Test-time optimization][G1] | [Test-time/throughput analysis][Y1] |
| F13 | Probability plots | Not verified | [Probability plots][G7] | Not verified |

## Quality screening and characterization

| ID | Feature | DR YIELD / YieldWatchDog | Galaxy family | yieldHUB |
| --- | --- | --- | --- | --- |
| F14 | Static and dynamic PAT | [AQM: static/dynamic PAT][D3] | [PAT-Man: static/dynamic PAT][G3] | [Static PAT and probe DPAT][Y3] |
| F15 | Robust/non-Gaussian and spatial screening | [Gap/robust PAT; neighbor/stack screening][D3] | [Non-Gaussian, geographic and reticle PAT][G3] | [GDBN and lot-norm screening][Y10] |
| F16 | SPC/control limits and alerts | [Calculated control limits and alarms][D1] | [Programmable bin/parametric alarms][G2]; specific SPC chart rules not verified | [WAT SPC limits and alerts][Y6] |
| F17 | Statistical yield/bin screening | Specific SYL/SBL workflow not verified | [Optional SYA alarms][G2]; do not assume identical SYL/SBL behavior | [Statistical bin limits][Y10]; [SYL/SBL usage][Y0] |
| F18 | Limit/program revision comparison | Not verified | [Limit tuning][G1]; automatic revision diff not verified | [Changed limits, revisions and added/removed tests][Y4] |
| F19 | Calculated tests and derived parameters | Not verified | Not verified | [Custom calculated tests][Y1] |
| F20 | PVT/corner characterization | General product-ramp analysis; dedicated PVT wizard not verified | [Corner wizard, listed with Yield-Man Lite][G1] | [Split/temperature/voltage characterization][Y8] |
| F21 | Gage R&R and ANOVA | Specific workflows not verified | [Gage R&R][G4]; ANOVA not verified | [Gage R&R and ANOVA][Y4] |
| F22 | Reliability drift/life-test analysis | [Measurement value shifts][D3]; full life-test workflow not verified | [Accelerated life testing][G1] | [Burn-in/HTOL/life-test drift][Y10] |
| F23 | Automated spatial/defect-pattern analysis | [XI spatial-pattern classification][D6]; [Defect Module][D7] | [PAT-Man geographic/reticle screening][G3]; broader inspection platform not verified | [Spatial patterns][Y4]; [AI-assisted inspection classification][Y10] |
| F24 | PAT recipe development and evidence | [Configurable screening methods][D3]; recipe editor/audit workflow not verified | [Recipe editor, historical simulation, raw/PAT-bin retention][G9] | [Per-site DPAT limits, recorded limits and lot reports][Y3] |

## Data workflows and production operations

| ID | Feature | DR YIELD / YieldWatchDog | Galaxy family | yieldHUB |
| --- | --- | --- | --- | --- |
| F25 | STDF and additional source formats | [STDF, ATDF, CSV, RITdb, WAT/PCM][D8] | [STDF, GDF, CSV, WAT/PCM and other datalogs][G1] | [STDF plus manufacturing-data integration][Y1] |
| F26 | Persistent multi-file database | [Central data model][D5] | [MariaDB via Yield-Man/Lite][G1] | [Central manufacturing-data platform][Y1] |
| F27 | Data preparation and ingestion automation | [Converters and manufacturing interfaces][D5] | [Automated collection/insertion/consolidation][G2] | [Validation, cleansing and governance][Y1] |
| F28 | Genealogy and cross-stage traceability | [Lot/wafer/device genealogy][D5] | [Probe-to-fab correlation and die trace][G1] | [Fab-to-final-test device genealogy][Y10] |
| F29 | Reports and repeatable reporting | [HTML/PDF templates; scheduled/per-lot reports][D2] | [Customizable scheduled reports][G2] | [Automated engineering reports][Y2]; [characterization reports][Y8] |
| F30 | Live production/equipment monitoring | [Equipment and factory-event monitoring][D2] | [Real-time Yield-Man dashboards][G2]; [tester-side PAT][G3] | [Live: test-floor monitoring and OEE][Y11] |
| F31 | Collaboration, permissions and integration | [User permissions; MES interfaces][D5] | [Shared reports/dashboards][G2]; general public API not verified | [Authorized data API/downloads][Y12]; [controlled collaboration][Y10] |
| F32 | Deployment model | [Windows client/server; cloud server possible][D5] | [Analysis client plus Yield-Man database/automation][G1] | [Browser client][Y12]; [cloud/on-premises server][Y1] |

**Deployment is not feature parity:** a browser interface does not establish that
parsing, querying or persistence happens entirely on the user's device. These
sources do not document the same serverless local-browser architecture that we
are building. They also do not establish an offline session package equivalent
to our proposed Save/Open workspace flow.

## SemiData status and next candidates

This section describes our **browser application**, not the separate native
evaluation workbench. Existing browser behavior is documented in the
[library home guide](../web-prototype/docs/LIBRARY-HOME.md) and
[foundation handoff](../web-prototype/docs/FRONTEND-HANDOFF.md).

| Candidate | Current browser status | Smallest useful next increment |
| --- | --- | --- |
| Local STDF library (F25–F26) | Delivered for raw STDF; single-file product UI | Keep using and improving the current library |
| Folder imports and portable data | Foundation APIs/console available; product UX pending | Review each as its own feature |
| **Test Explorer (F01)** | Not implemented in the product UI | Search tests by number/name; inspect declarations, units, counts and measurement records |
| **Histogram (F02/F04)** | Not connected to retained browser data | One selected test, explicit population, visible units/limits and configurable binning |
| Population selection (supports F02/F06/F11/F14) | Raw flags/attempts retained; analytical policies undecided | Make included observations, validity and attempt choices visible and reproducible |
| **PAT experiment (F14/F15)** | Not implemented in the browser | Engineer-selected reference/evaluation populations, recipe preview and affected-device evidence |
| Bin/Pareto view (F10) | Not implemented in the browser | One dataset with an explicit counting and retest policy |
| Wafer map (F08/F09) | Raw source/context retained; product view pending | One wafer with coordinate/orientation checks and die drill-down |
| Comparison plots/history (F03/F05/F06/F07) | Not implemented in the browser | Add one plot or comparison after selection semantics are established |
| Production automation and advanced screening | Not implemented in the browser | Separate future designs after engineering workflows are validated |

**Recommended next feature: Test Explorer.** It provides the selection and
evidence layer needed by histograms, comparisons and PAT. This is a dependency
recommendation, not a decision to prioritize yield over quality screening. PAT
remains a core product capability and an early candidate once populations are
explicit. The engineer selects the next implementation slice.

Before a chart or screening feature is specified, record its treatment of
invalid/nonfinite results, failed tests, unknown flags, repeated observations,
retests, units/scales and changing/omitted limits. Keep original results separate
from experimental labels. These are our engineering requirements, not inferred
vendor algorithms. No new analytical policy is approved by this comparison.

## Evidence boundaries and maintenance

- Public product pages can describe optional modules or suites. Confirm exact
  editions before using this document for a purchasing decision.
- The DR YIELD visualization article dates to 2022; its main chart families are
  corroborated by its product-specific engineering article. Specialized examples
  do not establish every underlying statistical rule.
- Galaxy's linked brochures provide more detail than its product landing pages.
  The reviewed Examinator-Pro brochure is dated January 2024; Yield-Man and
  PAT-Man brochures are dated February 2024 and remain linked by the current
  product pages. Cited brochure features appear on page 1 of each single-page
  PDF. They are historical vendor documentation, not release testing.
  A virtual retest using changed limits is distinct from consolidating actual
  repeat tests. Programmable alarms are not proof of every SPC rule or chart.
- yieldHUB histogram, scatter and Cp/Cpk examples include vendor-published
  customer accounts. They establish reported feature use, not independent
  accuracy or performance qualification.
- No benchmark, licensing cost, STDF record-completeness guarantee or claimed
  percentage improvement is compared here. No source data was uploaded.
- Keep feature IDs stable. When we choose a feature, link its specification and
  acceptance evidence here; update implementation status only after delivery.

[D1]: https://dryield.com/semiconductor-test-and-yield-data-visualization/
[D2]: https://dryield.com/test-and-yield-engineers-use-yield-analysis-software/
[D3]: https://dryield.com/advanced-quality-module-incl-part-average-testing-pat/
[D4]: https://dryield.com/yieldwatchdog-yield-analytics/automotive-semiconductor-quality-module/
[D5]: https://dryield.com/yieldwatchdog-semiconductor-yield-analytics-platform/faq/
[D6]: https://dryield.com/yieldwatchdog/xi/
[D7]: https://dryield.com/yieldwatchdog-yield-analytics/defect-inspection-software/
[D8]: https://dryield.com/semiconductor-data-monitoring/
[G1]: https://www.galaxysemi.com/products/examinatorpro
[G2]: https://www.galaxysemi.com/products/yield-man
[G3]: https://www.galaxysemi.com/products/pat-man
[G4]: https://www.galaxysemi.com/blogs/reduce-time-to-market-speed-up-production-launches-by-increasing-gage-study-efficiency
[G7]: https://cdn.prod.website-files.com/6615594bcb6e5acafe3828ad/6615594bcb6e5acafe382962_Examinator-Pro%20Datasheet-Jan-24-2024.pdf
[G8]: https://cdn.prod.website-files.com/6615594bcb6e5acafe3828ad/6615594bcb6e5acafe3829cf_Yield-Man-Datasheet-Feb-2024.pdf
[G9]: https://cdn.prod.website-files.com/6615594bcb6e5acafe3828ad/6615594bcb6e5acafe3829ce_PAT-Man-Datasheet-FEb-2024.pdf
[Y0]: https://www.yieldhub.com/
[Y1]: https://www.yieldhub.com/platform
[Y2]: https://www.yieldhub.com/engineering
[Y3]: https://www.yieldhub.com/part-average-test-pat
[Y4]: https://www.yieldhub.com/yield-ramp
[Y5]: https://www.yieldhub.com/success-stories/yieldhub-helps-raspberry-pi-to-high-volume-manufacture
[Y6]: https://www.yieldhub.com/blogs/what-s-wat-an-overview-of-wat-pcm-data-
[Y7]: https://www.yieldhub.com/success-stories/case-study-the-benefits-of-outsourcing-yield-management-software
[Y8]: https://www.yieldhub.com/yieldhub-characterise-speeds-up-npi
[Y9]: https://www.yieldhub.com/success-stories/testimonials
[Y10]: https://www.yieldhub.com/high-reliability
[Y11]: https://www.yieldhub.com/yieldhub-live
[Y12]: https://www.yieldhub.com/it
