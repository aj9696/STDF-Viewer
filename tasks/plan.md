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
