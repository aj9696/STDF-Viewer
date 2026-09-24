# SemiData Workbench capability map

Status: engineering evaluation release, 0.1.1. Working product name: SemiData.

The product is an open-source semiconductor test-data workbench. PAT,
characterization, interactive investigation, and historical analysis share the
same data foundation. This release proves usable workflows without claiming
Galaxy feature parity or production disposition qualification.

| Module | Responsibility | Depends on |
| --- | --- | --- |
| data-library | Import STDF through upstream Rust; immutable source snapshots and durable catalog | upstream parser |
| analysis | Explicit populations, descriptive statistics, lot/site comparison | data-library |
| pat | Reproducible sigma/MAD screening experiments and saved evidence | analysis |
| workbench | Local browser interface, loopback API, engineer evaluation guide | data-library, analysis, pat |

Build order: data-library → analysis → pat; workbench follows the documented
API contract. Runtime setup and interface construction can proceed independently.

User authorization: requested a runnable product and professional documentation
on 2026-09-23. Implementation choices remain reviewable in this repository;
the user evaluates working increments as a test engineer.

Full product direction includes MPR/FTR analysis, device genealogy, qualified
PAT/DPAT recipes, wafer analysis, historical monitoring, automation, and improved
UI. These remain separate future increments, not implied delivered features.

The measured import performance increment and isolated Rust/WASM browser parser
experiment are implemented. See SPEC-import-performance.md for acceptance and
docs/import-performance.md for results and limits. Durable browser storage,
querying, and PAT migration remain future work; the shipping product still uses
its local Python/Rust service.

## Proposed next increment: browser data logistics

Status: documented proposal, not implemented. The engineer requested a gradual
storage/import workflow on 2026-09-24 and retains ownership of the analysis
roadmap. See [Browser data workflow](docs/browser-data-workflow.md).

| Module id | Responsibility | Depends on |
| --- | --- | --- |
| browser-library | Persistent local catalog, dataset storage, ownership and recovery | Browser storage and candidate SQLite WASM |
| browser-imports | File/folder selection, retained-record ingestion, duplicate handling and queue | browser-library, existing Rust decoder |
| browser-transfer | Export and restore a versioned, verifiable dataset package | browser-library |

Build order: prove browser-library persistence → one real file through
browser-imports → failure recovery and browser-transfer → folder batches →
large-file qualification. Provider specification: [SPEC-browser-library.md](SPEC-browser-library.md).
Later module specifications are written when their slices begin; the current
plan does not select analytical schemas, calculations, or PAT workflows.
