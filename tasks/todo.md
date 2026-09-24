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
