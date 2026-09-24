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

## 2026-09-24: browser data logistics — proposed next work

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

BL-1 is the next implementation slice. Show each checkpoint to the engineer;
do not run the entire roadmap as one unattended change. At each later slice,
write its module-specific interface and acceptance details before coding.

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
release are not part of BL-1. Dependencies are evaluated locally and pinned
when selected; no new dependency has been installed by this planning change.
