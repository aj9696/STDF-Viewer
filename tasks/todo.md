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
