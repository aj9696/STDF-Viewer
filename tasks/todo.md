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

## Browser data logistics (proposed)

- [x] Document the workflow, proposed capability boundaries, storage candidate,
  source-versus-library distinction, and paced implementation checkpoints.
- [ ] **BL-1 — Prove browser persistence.** Module: browser-library. Next slice.
  - Acceptance: a tiny SQLite database survives close/reopen, page reload and
    browser restart; second-tab ownership and unavailable storage are explicit;
    small export/restore succeeds and a viable bounded-export path is identified.
  - Verify: browser integration checks on desktop Chrome/Edge and the embedded
    browser separately; record versions, VFS, persistence grant and limitations.
  - Files: under `web-prototype/`, split into a pinned asset/build + minimal
    worker/harness slice, then reopen/export verification + README and
    STORAGE-VALIDATION.md. Keep each slice to at most five files. Dependencies: none.
- [ ] **BL-2 — Retain one actual STDF.** Module: browser-imports; depends BL-1.
  - Acceptance: copy/hash and import the evaluation STDF in bounded batches;
    retain ordered measurements/device context and publish only after checks;
    reopen the dataset without reading or parsing the original.
  - Verify: native and independent fixture comparisons, both byte orders,
    repeated records, flags, metadata, source hash and restart behavior.
  - Files: write SPEC-browser-imports.md first; split changes to parser output,
    storage sink and UI into separately verified batches of at most five files.
- [ ] **BL-3 — Make retry safe.** Modules: browser-library/browser-imports;
  depends BL-2.
  - Acceptance: identical content deduplicates; changed content with the same
    name is distinct; cancellation, quota/write failure and restart never
    present unfinished data as Ready or damage a completed dataset.
  - Verify: injected failure around each publication boundary, renamed sources,
    incomplete sources, retry from the beginning, and a second tab.
  - Files: storage worker, library coordinator, storage/import harness and
    STORAGE-VALIDATION.md; split if fixture changes exceed five files.
- [ ] **BL-4 — Make datasets portable.** Module: browser-transfer;
  depends BL-3.
  - Acceptance: export/restore a versioned source+database package; verify hashes
    and reject incompatible/damaged input; support large datasets without a
    full-database memory copy and without overwriting an existing dataset.
  - Verify: restore into a fresh origin/profile, small and 1M/10M fixtures,
    corruption injection, memory measurement, interrupted export/restore.
  - Files: write SPEC-browser-transfer.md first, then transfer module, worker
    integration, fixture/harness and validation notes in bounded slices.
- [ ] **BL-5 — Add a folder queue.** Module: browser-imports; depends BL-4.
  - Acceptance: read-only directory selection with file-input fallback; review
    candidates with optional subfolders before import; sequential queue, explicit
    rescan, per-file outcomes and retry/reconnect controls.
  - Verify: mixed supported/unsupported files, duplicate names/content, changed
    and incomplete sources, nested directories, revoked permission and cancellation.
  - Files: source-selection module, queue module, UI, import harness and guide.
- [ ] **BL-6 — Qualify the complete logistics path.** Depends BL-5.
  - Acceptance: publish full-import timing/memory/storage at 1M/10M, verify reopen
    and restore, and document supported browser/input limits and remaining gaps.
  - Verify: fresh-process/origin methodology as appropriate, sequential trials,
    source hashes, exact small fixtures and sampled large-file comparisons;
    include snapshot/hash, parsing, writes, indexes, validation and publication.
  - Files: benchmark harness, portable result file, STORAGE-VALIDATION.md,
    browser workflow guide and capability status.

Checkpoint after BL-1: review persistence and export feasibility with the
engineer. Checkpoint after BL-2: demonstrate one imported/reopened real dataset.
Checkpoint after BL-4: demonstrate portable recovery before folder-scale use.
Analysis and PAT design are intentionally left for the engineer's later plan.
