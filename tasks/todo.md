# SemiData 0.1.0 delivery checklist

- [x] Runtime: extension imports; original viewer import smoke check; reproducible setup.
- [x] Library: import, deduplicate, reopen, reject incomplete files; integration tests.
- [x] Explore: test selection, site/attempt filters, statistics and plots; known-vector tests.
- [x] PAT: methods, reference selection, preview, persistent runs, CSV; calculation tests.
- [x] UI: library → explore → PAT → saved run works in browser.
- [x] Documentation: installation, engineer guide, methods, architecture, API, contribution, release notes.
- [x] Evaluation data: bundled binary STDF fixtures parsed through the Rust engine.
- [x] Evaluation data: STDF.io generator recipe and observed preview documented.
- [ ] External compatibility: download STDF.io output and verify end-to-end import.
- [x] Independent review: resolve correctness/security findings; record remaining limitations.
- [x] Final local verification: 29 tests, JavaScript syntax, compilation, browser walkthrough, artifact inventory.
- [ ] Hosted CI: execute the configured workflow after publishing the branch.

The first evaluation release is runnable locally. The two open items are explicit
follow-up checks: browser automation could not complete STDF.io's Save download,
and this task does not publish the local branch. Neither is reported as passed.
See [Release verification](../docs/release-verification.md) for evidence and limits.
