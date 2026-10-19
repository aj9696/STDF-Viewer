# SemiData delivery checklist

- [x] Runtime: extension imports; original viewer import smoke check; reproducible setup.
- [x] Library: import, deduplicate, reopen, reject incomplete files; integration tests.
- [x] Explore: test selection, site/attempt filters, statistics and plots; known-vector tests.
- [x] PAT: methods, reference selection, preview, persistent runs, CSV; calculation tests.
- [x] UI: library → explore → PAT → saved run works in browser.
- [x] Documentation: installation, engineer guide, methods, architecture, API, contribution, release notes.
- [x] Evaluation data: bundled binary STDF fixtures parsed through the Rust engine.
- [x] Evaluation data: STDF.io generator recipe and observed preview documented.
- [x] External compatibility: verify the available STDF.io output end-to-end (0.1.1).
- [x] Independent review: resolve correctness/security findings; record remaining limitations.
- [x] Final local verification: 29 tests, JavaScript syntax, compilation, browser walkthrough, artifact inventory.
- [ ] Hosted CI: execute the configured workflow after publishing the branch.

The evaluation release is runnable locally. STDF.io compatibility was completed
on 2026-09-24 with the available downloaded file and compact-PTR identity fix.
Hosted CI remains an open follow-up; this task does not publish the local branch.
See [Release verification](../docs/release-verification.md) for evidence and limits.

## Import performance increment

- [x] Research STDF design from primary sources and document engineering implications.
- [x] Build deterministic large fixtures and capture unmodified phase/memory baselines.
- [x] Optimize bounded framing and avoid redundant raw-file normalization; test malformed and compressed input.
- [x] Measure and retain native database improvements with unchanged results.
- [x] Build and exercise raw-STDF Rust/WASM parsing in a browser worker.
- [x] Verify the available STDF.io source and record its provenance/hash.
- [x] Compare larger workloads, review changes, run regressions, and publish local evidence.

## Browser data logistics

- [x] Document the workflow, proposed capability boundaries, storage candidate,
  source-versus-library distinction, and paced implementation checkpoints.
- [x] **BL-1 — Prove browser persistence.** Module: browser-library.
  - Delivered: isolated synthetic-note SQLite lab; 11 checks passed in Chrome
    153.0.8010.48 and Edge 153.0.4234.48, including browser process restart.
    Embedded-browser save/reopen/reload/contention was checked separately;
    its host restart and backup/restore remain unqualified. See
    [storage validation](../web-prototype/STORAGE-VALIDATION.md).
  - Decision: retain pinned SQLite WASM 3.53.4-build1 with `opfs-sahpool` for
    BL-2. Page-at-a-time OPFS export/chunked restore preserved all 3,000 fixture
    rows with an 8 KiB transfer buffer; large-file qualification remains open.
  - Acceptance: a tiny SQLite database survives close/reopen, page reload and
    browser restart; second-tab ownership and unavailable storage are explicit;
    small export/restore succeeds and a viable bounded-export path is identified.
  - Verify: browser integration checks on desktop Chrome/Edge and the embedded
    browser separately; record versions, VFS, persistence grant and limitations.
  - Files: under `web-prototype/`, split into a pinned asset/build + minimal
    worker/harness slice, then reopen/export verification + README and
    STORAGE-VALIDATION.md. Keep each slice to at most five files. Dependencies: none.
- [x] **BL-2 — Retain one actual STDF.** Module: browser-imports; depends BL-1.
  - Acceptance: copy/hash and import the evaluation STDF in bounded batches;
    retain ordered measurements/device context and publish only after checks;
    reopen the dataset without reading or parsing the original.
  - Verify: native and independent fixture comparisons, both byte orders,
    repeated records, flags, metadata, source hash and restart behavior.
  - Files: write SPEC-browser-imports.md first; split changes to parser output,
    storage sink and UI into separately verified batches of at most five files.
- [x] **BL-3 — Make retry safe.** Modules: browser-library/browser-imports;
  depends BL-2.
  - Acceptance: identical content deduplicates; changed content with the same
    name is distinct; cancellation, quota/write failure and restart never
    present unfinished data as Ready or damage a completed dataset.
  - Verify: injected failure around each publication boundary, renamed sources,
    incomplete sources, retry from the beginning, and a second tab.
  - Files: storage worker, library coordinator, storage/import harness and
    STORAGE-VALIDATION.md; split if fixture changes exceed five files.
- [x] **BL-4 — Make datasets portable.** Module: browser-transfer;
  depends BL-3.
  - Acceptance: export/restore a versioned source+database package; verify hashes
    and reject incompatible/damaged input; support large datasets without a
    full-database memory copy and without overwriting an existing dataset.
  - Verify: restore into a fresh origin/profile, small and 1M/10M fixtures,
    corruption injection, memory measurement, interrupted export/restore.
  - Files: write SPEC-browser-transfer.md first, then transfer module, worker
    integration, fixture/harness and validation notes in bounded slices.
- [x] **BL-5 — Add a folder queue.** Module: browser-imports; depends BL-4.
  - Acceptance: read-only directory selection with file-input fallback; review
    candidates with optional subfolders before import; sequential queue, explicit
    rescan, per-file outcomes and retry/reconnect controls.
  - Verify: mixed supported/unsupported files, duplicate names/content, changed
    and incomplete sources, nested directories, revoked permission and cancellation.
    Permission denial is covered by controlled tests; native OS picker/permission
    UI remains an explicit manual qualification gap. Real OPFS handles and the
    folder-input fallback passed desktop browser checks.
  - Files: source-selection module, queue module, UI, import harness and guide.
- [x] **BL-6 — Qualify the complete logistics path.** Depends BL-5.
  - Acceptance: publish full-import timing/memory/storage at 1M/10M, verify reopen
    and restore, and document supported browser/input limits and remaining gaps.
  - Verify: fresh-process/origin methodology as appropriate, sequential trials,
    source hashes, exact small fixtures and sampled large-file comparisons;
    include snapshot/hash, parsing, writes, indexes, validation and publication.
  - Files: benchmark harness, portable result file, STORAGE-VALIDATION.md,
    browser workflow guide and capability status.
  - Delivered: final Chrome imports of 1M/10M measurements in 17.22/174.45 s;
    bounded export/fresh-profile restore and full verification passed. Import
    SQLite WASM allocation stayed at 10,092,544 bytes for both sizes. See
    LIBRARY-VALIDATION.md for detailed evidence and qualification gaps; WASM
    allocations are not browser RSS or JavaScript peak-memory measurements.

The engineer subsequently authorized autonomous completion through frontend
readiness. Earlier demonstration checkpoints became recorded validation steps.
See [full-path validation](../web-prototype/LIBRARY-VALIDATION.md) and
[frontend handoff](../web-prototype/docs/FRONTEND-HANDOFF.md). Analysis and PAT
design remain with the engineer; hosted CI remains open until publication.

## Browser frontend — one feature at a time

- [x] **UI-1 — Library home.** Module: browser-ui; depends BL-6.
  - Delivered: styled local workspace, single-file import/drop, phase progress,
    duplicate/cancel/error feedback, saved-dataset search/sort/25-row pagination,
    metadata drawer and actual storage estimates/persistence status.
  - Verify: real Chrome/Edge imports, known counts/hash, renamed duplicate,
    malformed input, cancellation, reload/navigation/reopen and tab ownership;
    explicit test-only inventories exercise pagination and failure states.
    Keyboard focus, progress reset and 360/390px layout checks included.
  - Review: independently found and fixed detached dialog-opener focus;
    screenshot review found and fixed stale progress and narrow-page overflow.
  - Docs: [Library home guide](../web-prototype/docs/LIBRARY-HOME.md),
    [specification](../SPEC-browser-ui.md) and frontend browser harness.
- [x] Engineer evaluation of UI-1; selected Test Explorer as the next feature.

Do not interpret this checkpoint as authorization to design analytical policy
or implement all remaining frontend workflows at once.

## Test Explorer

- [x] **TE-1 — Read-only query boundary.** Add listTests/getTest and paged
  declarations/observations; validate input, index use and independent goldens.
  Files: test-queries.js, data-worker.js, data-client.js, query/browser harness.
- [x] **TE-2 — Simple explorer UI.** Same-tab dataset navigation, test search,
  declaration inspection and observation paging; keyboard/reopen/error states.
  Files: explore.html, explorer.js, explorer-view.js, explorer.css, overview link.
- [x] **TE-3 — Qualify and document.** Chrome/Edge explorer and library regressions,
  independent review, manual visuals, guide and feature-status updates.
  - Delivered: 13 grouped explorer checks and 15 library regressions per browser,
    zero page errors; independent source fixtures and executed index plans.
    Review fixes cover keyboard focus, unknown metadata and restored-inventory
    bounds. Read the [guide](../web-prototype/docs/TEST-EXPLORER.md) and
    [evidence](../web-prototype/evidence/test-explorer.json).
  - Limits: PTR inspection only; no large-query latency benchmark or analytical
    policy. Histograms and PAT remain separately specified next features.

## Full upstream browser viewer — authorized 2026-09-25

- [x] **BV-0 — Define baseline and capability map.** Inventory working upstream
  behavior, preserve native source baseline, specify browser modules and policies.
- [x] **BV-1 — Normalize a derived viewer cache.** Bounded PTR/MPR/FTR, effective
  defaults, metadata/pins/wafer context; retain-v1 compatibility and failure recovery.
- [x] **BV-2 — Query explicit populations.** Group/head/site/current/all selection,
  test/device/record tables, statistics, bounded trends/histograms/bin/wafer maps.
- [x] **BV-3 — Integrate investigation UI.** Multi-test selection, interactive
  charts, failed/low-Cpk markers and complete device drilldown.
- [x] **BV-4 — Complete data opening and workspaces.** Compressed imports, product
  multi-file/folder queue, ordered groups, settings and portable session save/open.
- [x] **BV-5 — Export reports and records.** Eight report sections, chart images,
  selected data and record conversion, with population/source provenance.
- [x] **BV-6 — Qualify and document.** Independent numerical fixtures, Chrome/Edge
  flows, library regressions, 1M/10M behavior, code/visual review and updated guides.

Delivered as an engineering browser baseline, with explicit desktop presentation
differences and resource limits. See [parity](../docs/viewer-parity.md),
[user guide](../web-prototype/docs/VIEWER-UI.md),
[methods](../web-prototype/docs/VIEWER-METHODS.md) and
[qualification](../web-prototype/docs/VIEWER-VALIDATION.md). Review corrected an
interior histogram-edge rounding error, removed a population-sized wafer sort,
and replaced repeated report offset scans with indexed streaming iteration.

Next candidate: optimize and remeasure cold viewer indexing. The recorded 10M
PTR source imported in 126.23 s and built its first analysis cache in 582.68 s;
warm cache preparation was 14.3 ms. This is a documented performance limitation,
not a parser-only benchmark or a claim of production qualification. PAT design
and broader product roadmap remain separate engineer-selected work.

## UI simplification and small examples — 2026-09-25

- [x] Replace decorative navigation and repeated copy with a compact file-to-chart flow.
- [x] Keep filters, bounds and warnings visible while placing advanced controls in disclosures.
- [x] Add five deterministic small STDF scenarios, their expected results, downloads and a picker.
- [x] Check real imports, duplicate reuse, failure recovery, presets and refresh behavior in browsers.
- [x] Review desktop/narrow layouts; rerun Chrome/Edge viewer UI and report/workspace workflows.

See [example guide](../web-prototype/docs/EXAMPLES.md),
[viewer guide](../web-prototype/docs/VIEWER-UI.md) and
[qualification](../web-prototype/docs/VIEWER-VALIDATION.md).

## DLOG manual expansion — 2026-09-25

- [x] DL-1: Manual coverage map and provider/method specifications.
- [x] DL-2: Dashboard, grid options and record summary with bounded queries.
- [x] DL-3: Joined scatter/3D, distribution comparisons and file/lot ranking.
- [x] DL-4: PAT/What-If, spatial rules, PVT and measurement-system studies.
- [x] DL-5: Wafer value/3D/gallery views, picking and display settings.
- [x] DL-6: Edit preview, derived STDF/reimport, metadata edits and bulk remap.
- [x] DL-7: ATDF and batch CSV/JSON/STDF conversion with verified round trips.
- [x] DL-8: PDF/Word/Excel/image/PAT report outputs, layout and actual output receipts.
- [x] DL-9: Independent correctness, export roundtrips, UI checks and guides.


The implementation and independent qualification are recorded in
[manual coverage](../docs/dlog-coverage.md), [engineering tools](../web-prototype/docs/TOOLS.md)
and [viewer qualification](../web-prototype/docs/VIEWER-VALIDATION.md).

- [ ] **Interoperability dependency:** SINF, G85 and E142 require the recipient
  tool/revision and an accepted profile/sample. The manual does not define them;
  a clarification is pending. Existing generic exports are not mislabeled.
- [ ] Finish localization of diagnostic messages and method explanations.
  Navigation and the documented engineering controls have explicit translations;
  source content and STDF field names stay unchanged.
- [ ] Qualify new studies/authoring/report performance on large vendor files;
  prior parser/cache benchmarks do not qualify these new operations.

## UI refinement — authorized 2026-10-18

See the matching section in [the plan](plan.md). Every slice includes the shared
visual/accessibility checks there and a short engineer exercise. These tasks
are authorized through completion. Record demonstrations without blocking on
engineer feedback; retain the feedback checkpoints for later evaluation.

Implementation and local qualification completed on 2026-10-18. UX-1 through
UX-7 are delivered; Chrome/Edge workflow, numerical fixture, export and restore
evidence is recorded in `web-prototype/docs/VIEWER-VALIDATION.md`. UX-8's local
review and production publication are complete. Release `69d4e51` is live at
`https://semidata.pages.dev/`; separate Chrome/Edge smoke checks passed against
that origin. Actual 200% browser zoom remains a qualification follow-up.
Narrow/reflow checks are passed, but are not recorded as an actual zoom test.

- [x] **UX-1 — Scan and open files in Library.** Dependencies: none. Scope: medium.
  - Delivered: compact file rows, neutral surfaces, readable filenames and
    numeric columns, touch-sized controls. Chrome examples workflow passed;
    screenshots: `examples-ui-chrome-1792369427420` in ignored results.
  - Acceptance: apply the compact type/spacing/control rules to the existing
    file flow; keep Import STDF obvious and ATDF/examples available; show honest
    PTR-only counts, duplicate outcomes and actionable loading/error states.
  - Verification: fresh before/after captures, keyboard import/open/retry, long
    names, empty/populated library and duplicate reuse; run
    `node web-prototype/scripts/examples-ui-check.mjs chrome` plus the existing
    library workflow checks where import rendering changes.
  - Likely files: `site/app.html`, `site/app.css`, `site/library-home-view.js`,
    `scripts/examples-ui-check.mjs`, `docs/LIBRARY-HOME.md` under `web-prototype/`.

- [x] **UX-2 — Keep investigation scope and test selection clear.** Depends UX-1.
  Scope: medium.
  - Acceptance: one compact scope summary retains files/groups, heads, sites,
    attempts and series mode; search and selected tests are easy to reach;
    changing views preserves selection and the narrow catalog still folds.
  - Verification: Site shift comparison and Fail to pass current/all counts,
    keyboard selection across catalog pages, browser return/reload;
    `node web-prototype/scripts/viewer-ui-check.mjs chrome` and examples UI checks.
  - Likely files: `site/viewer.html`, `site/viewer.css`, `site/viewer.js`,
    `scripts/viewer-ui-check.mjs`, `docs/VIEWER-UI.md` under `web-prototype/`.

### Checkpoint after UX-1 and UX-2

- [ ] Demonstrate import → select test → compare sites with the small examples;
  record engineer feedback and adjust the next slice before extending the style.
- [x] Shared styling leaves other viewer tabs and one existing study usable.

- [x] **UX-3 — Make plots and their controls easier to read.** Depends UX-2.
  Scope: medium.
  - Acceptance: titles/units, legend and aligned statistics identify each series;
    common controls and advanced overlays have a clear hierarchy; existing
    preferences, binning, extrema, drilldowns and warnings retain their meaning.
  - Verification: compare Site shift, inspect wafer-edge failures, check mixed
    numeric/functional results and extreme values; run
    `node web-prototype/scripts/viewer-charts-check.mjs chrome` and viewer UI checks.
  - Likely files: `site/viewer-charts.js`, `site/viewer-charts.css`,
    `site/viewer-view.js`, `scripts/viewer-charts-check.mjs`, `docs/VIEWER-UI.md`
    under `web-prototype/`. Split further if settings wiring needs more files.

- [x] **UX-4 — Group the existing engineering tools.** Depends UX-2. Scope: medium.
  - Acceptance: all 15 tool IDs remain reachable under meaningful groups; PAT,
    Gauge R&R and comparison tools have visible names; navigation preserves
    scope, active tool and localization behaviour.
  - Verification: enumerate tool IDs before/after, exercise each group with
    keyboard and pointer, reload a selected tool;
    `node web-prototype/scripts/viewer-tools-ui-check.mjs chrome`.
  - Likely files: `site/viewer-study-ui.js`, `site/viewer.js`,
    `site/viewer-i18n.js`, `scripts/viewer-tools-ui-check.mjs`, `docs/TOOLS.md`
    under `web-prototype/`. Start with native grouped options before adding a
    custom menu or search component.

### Checkpoint after UX-3 and UX-4

- [ ] Engineer can identify the shifted site, inspect contributing devices and
  find PAT/Gauge R&R; record friction rather than relying on aesthetic scores.
- [x] Numerical outputs and source/attempt identity match the unchanged fixtures.

- [x] **UX-5 — Clarify the PAT form.** Depends UX-3 and UX-4. Scope: medium.
  - Acceptance: current population, reference selection and method are explicit;
    required fields and advanced options are separated; run, exclusions,
    result/recipe export and screened-copy actions have distinct meanings.
  - Verification: use the existing PAT fixture, compare decisions/provenance,
    cancel/retry and change scope; run tools UI and PAT recipe checks.
  - Likely files: `site/viewer-study-ui.js`, `site/viewer-studies.css`,
    `scripts/viewer-tools-ui-check.mjs`, `docs/TOOLS.md` under `web-prototype/`.
    Add a documented small engineer example only if existing fixtures do not
    exercise the form; keep method/default changes outside this presentation task.

- [x] **UX-6 — Clarify the Gauge R&R form.** Depends UX-5. Scope: medium.
  - Acceptance: study inputs and supported design are explicit before running;
    validation appears beside the relevant input; results retain method,
    population and missing/unsupported-condition explanations.
  - Verification: reproduce the existing independent study fixture and its
    rejection cases; run study numerical checks and tools UI checks; provide a
    small documented exercise rather than inferring a study from arbitrary STDF.
  - Likely files: `site/viewer-study-ui.js`, `site/viewer-studies.css`,
    `scripts/viewer-tools-ui-check.mjs`, `docs/TOOLS.md` under `web-prototype/`.

### Checkpoint after UX-5 and UX-6

- [ ] Engineer can explain the selected study population/method and distinguish
  an exported result from a derived source file. Record feedback on both forms.

- [x] **UX-7 — Make workspace and export actions easy to find.** Depends UX-2 and
  UX-4. Scope: medium.
  - Acceptance: save/open/export/download actions have consistent placement;
    opening a saved workspace is discoverable from an empty library; distinguish
    a portable workspace from a report and keep storage/origin guidance concise.
  - Verification: roundtrip a workspace into an isolated profile, verify selected
    tests/settings/sources, open from an empty library and recover downloads;
    `node web-prototype/scripts/viewer-transfer-check.mjs chrome` plus viewer UI.
  - Likely files: `site/app.html`, `site/viewer.html`, `site/viewer-actions.js`,
    `scripts/viewer-ui-check.mjs`, `docs/VIEWER-TRANSFER.md` under `web-prototype/`.
    Reuse the existing viewer action boundary and empty-library restore path;
    split additional routing work into a separate slice if necessary.

- [ ] **UX-8 — Qualify and hand off the refined UI.** Depends UX-1 through UX-7.
  Scope: small documentation/release slice.
  - Delivered: guides, independent review, clean package, production deployment
    and isolated Chrome/Edge live checks. See `docs/DEPLOYMENT.md` under
    `web-prototype/` for revision, hashes and smoke evidence.
  - Remaining qualification: actual browser 200% zoom; effective viewport
    reflow is covered. Engineer feedback checkpoints remain separate.
  - Acceptance: all five example workflows and the two study exercises work on
    desktop Chrome/Edge; screenshots and guides describe the delivered revision;
    production verification is recorded separately from local validation.
  - Verification: focused regressions on both browsers, keyboard/zoom/narrow
    layouts, workspace restore, export contents and bounded long-catalog
    rendering; `npm.cmd --prefix web-prototype run package:pages`, then deployed
    smoke checks when the release is published.
  - Likely files: `web-prototype/docs/VIEWER-VALIDATION.md`,
    `web-prototype/docs/DEPLOYMENT.md`, `tasks/plan.md`, `tasks/todo.md`.
    Review shared changes independently before release; retain any remaining
    qualification gaps explicitly.


### All-test statistics and help — 2026-10-18

- [x] Compact provider summaries share exact existing calculations and scope.
- [x] All-test table supports search, global numeric sort, pagination and drilldown.
- [x] Partial scans retain completed batches and resume; scope changes invalidate.
- [x] Selected-test statistics and matrix remain available.
- [x] Contextual right help panel covers every view, all 15 tools and definitions.
- [x] Controlled-English writing policy, API bounds and engineer guide documented.
- [x] Independent review and local Chrome/Edge provider, UI, real E2E and help checks.
- [x] Publish clean package and verify the public revision in Chrome and Edge.

### Yield Manager — 2026-10-19

- [x] Confirm lots, source-time yield trends and failing bins as the first scope.
- [x] Document identity, denominator, time, retest and drill-down contracts.
- [x] Implement and verify bounded device-only source summaries.
- [x] Build lot review, failing bins, site results and source-time view.
- [x] Integrate tab, cache lifecycle, workspace persistence and contextual help.
- [x] Independent review; real-provider and Chrome/Edge UI regression checks.
- [x] Publish clean release and verify the public assets and workflows.

### Library organization and report filters — 2026-10-19

- [x] Specify metadata, multi-selection and consistent report population rules.
- [x] Add bounded metadata extraction/cache for existing and newly saved sources.
- [x] Add Library grouping/search and selection of up to eight files.
- [x] Add coherent report outcome scope, chart capture and export provenance.
- [x] Verify report contents, retest behavior and Chrome/Edge Library/report UI.
- [ ] Review, document, publish and verify the public release.
