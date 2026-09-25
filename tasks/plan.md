# Implementation plan — SemiData 0.1.0

## Decisions
Keep the upstream Rust parser. Add a durable catalog of independent immutable
parse databases rather than modifying the upstream destructive database builder.
A local browser UI makes inspection accessible while a Python service owns files
and numerical semantics. No new application runtime dependencies are required.

The capability map and module specs define the release. `docs/api.md` defines
the contract shared by backend and UI. The task checklist is `tasks/todo.md`.

## Risks
| Risk | Mitigation |
| --- | --- |
| Windows Rust toolchain missing | Prove build/runtime early; document provenance of any binary fallback |
| Malformed/truncated STDF accepted upstream | Validate record framing before publishing imports |
| Incorrect populations | Explicit attempt policy, flags, source IDs, known-vector tests |
| PAT used beyond qualification | Clear method labels, saved evidence, no raw-data mutation |
| Data volume exceeds initial implementation | Document caps, return actionable errors, benchmark before expanding |
| Documentation diverges | Verify examples against actual API and record release checks |

## Build sequence
1. Runtime and persistent library import, then import regression checks.
2. Measurement exploration and calculation tests.
3. PAT preview/save/export and reproducibility tests.
4. Browser integration, user evaluation script, review and fixes.

No deployment or publication is part of this local evaluation release.

## 2026-09-24: measured import performance and browser parsing

Follow SPEC-import-performance.md. Establish process-isolated baselines before
editing the measured paths. Optimize framing/I/O and native database costs in
separate verifiable slices, then compare unchanged workloads. Build a separate
browser parser prototype using the same inputs, with its smaller workload made
explicit. Finish with review, documentation, and a runnable demonstration.

## 2026-09-24: browser data logistics — initial plan (historical)

The engineer requested a slower, documented progression and owns the analysis
roadmap. This phase plans persistence, file handling, and library operations.
The earlier hosted-CI follow-up remains open; this section extends the project
plan without replacing its history.

Read [Browser data workflow](../docs/browser-data-workflow.md), the proposed
module map in [CAPABILITIES.md](../CAPABILITIES.md), and
[SPEC-browser-library.md](../SPEC-browser-library.md). The ordered task source
of truth remains `tasks/todo.md` under Browser data logistics.

### Sequence and checkpoints

1. **BL-1: persistence proof.** Create a tiny database, restart, recover access,
   and export/restore it. Record the actual SQLite/VFS/browser decision.
2. **BL-2: one real source.** Extend the Rust decoder's output to retained
   records and write bounded batches into staged storage; show a reopened
   dataset inventory. This is the first engineer-facing import checkpoint.
3. **BL-3: failure and duplicate handling.** Exercise failures and retries at
   each publication boundary before increasing the volume.
4. **BL-4: portable storage.** Prove bounded export/restore, including a new
   browser origin/profile. This must precede recommending the library for work.
5. **BL-5: folder queue.** Select, inventory, import and rescan a directory;
   keep each source independent and make per-file results understandable.
6. **BL-6: volume qualification.** Measure persistence-inclusive 1M/10M runs,
   restart, and folder batches. Publish the actual supported envelope.

The following checkpoint instructions describe the initial limited authorization;
the autonomous-completion section below supersedes them. BL-1 was implemented in
[storage validation](../web-prototype/STORAGE-VALIDATION.md). The next slice is
BL-2. Show each checkpoint to the engineer; do not run the entire roadmap as
one unattended change. At each later slice, write its module-specific interface
and acceptance details before coding. The engineer reaffirmed one feature at
a time on 2026-09-24.

### Decisions to test early

| Question | Proposed experiment / consequence |
| --- | --- |
| Can SQLite reopen reliably here? | Verify close/reopen, reload and browser restart on a fixed origin |
| Can large data leave browser storage safely? | Test a bounded export path before committing to a VFS |
| What survives an interrupted import? | Publish via catalog only after finalization; recover staging explicitly |
| How much storage is needed? | Measure snapshots, databases, journals and export, rather than using source size alone |
| What does a remembered folder mean? | Separate stored handle from permission; provide reconnect and file-picker fallback |
| How do we preserve future analysis freedom? | Keep original bytes, ordered records, raw flags and repeated observations |

One worker and one active library owner are the starting proposal. Sequential
per-file jobs keep memory and contention measurable. Folder monitoring, source
deletion, cross-file merging, compression, analytical features, and a hosted
release are not part of BL-1. BL-1 pinned SQLite WASM 3.53.4-build1 and test-only
playwright-core 1.63.0 in the prototype's npm lockfile. The existing parser and
native workbench have no new runtime dependency on them.

## 2026-09-24: autonomous logistics completion

The engineer authorized continuing BL-2 through BL-6 while away, stopping at a
frontend-ready foundation. Earlier human demonstration checkpoints now become
recorded test/demo checkpoints; do not stop between authorized logistics slices.
Keep analysis and production UX outside scope. Define import/transfer contracts,
then implement bounded record retention, publication/recovery, portable transfer,
folder coordination and frontend adapters in independently verified commits.
Parallel work is limited to Rust decoding, source discovery, and transfer helpers
once their interfaces are written; the root owns catalog/storage integration.
Finish with independent review, browser tests, 1M/10M measurements, a runnable
engineering console and a frontend handoff guide listing remaining limitations.

## 2026-09-24: first browser frontend feature

The engineer requested a polished frontend developed one feature at a time.
Follow SPEC-browser-ui.md: deliver library home, single-file import with honest
progress/outcomes, saved-dataset search/sort/pagination and metadata reopen.
Keep the same browser origin and existing storage interfaces. Parallelize styling
and browser workflow checks against the agreed markup; independently review
focus/lifecycle and text rendering. Record a user guide and browser evidence.
Stop after this runnable feature for engineer evaluation. Folder UX, workspace
save/open and all analytical workflows remain separate future increments.

## 2026-09-24: Test Explorer

The engineer approved the first basic phase and autonomous continuation through
completion. Follow SPEC-test-explorer.md. Define bounded read-only query methods,
then implement the saved-dataset test/declaration/measurement explorer. Query
implementation and independent fixture/browser checks can run alongside UI work
after the contract is fixed. Validate existing library behavior, inspect actual
browser visuals, document coverage and commit each verified slice. No statistical
population, default-inheritance or retest policy is decided in this phase.
