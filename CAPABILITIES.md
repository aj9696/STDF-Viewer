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

The native evaluation workbench above remains runnable and unchanged. A separate
browser-only data foundation now retains STDF in local SQLite, coordinates
file/folder queues and exports/restores portable packages. Analysis is not yet
connected to the browser library.

## Browser data logistics

Status: implemented engineering foundation, 2026-09-24. The engineer authorized
completing BL-2 through BL-6 while away, through frontend readiness. See
[Browser data workflow](docs/browser-data-workflow.md),
[full-path validation](web-prototype/LIBRARY-VALIDATION.md) and
[frontend handoff](web-prototype/docs/FRONTEND-HANDOFF.md).

| Module id | Responsibility | Depends on |
| --- | --- | --- |
| browser-library | Local catalog, immutable per-source SQLite, ownership, recovery, bounded reads | OPFS and pinned SQLite WASM |
| browser-imports | Retained Rust decoding, file/folder inventory, sequential import queue and content identity | browser-library, Rust/WASM |
| browser-transfer | Versioned source+database packages, bounded export/restore and checksums | browser-library |

The engineering console is `web-prototype/site/foundation.html`. The product
frontend can consume the documented client and source/queue modules. Normalized
measurements currently cover PTR; MPR/FTR retain device context and exact raw
records. Effective STDF defaults, cross-file identity, analysis and PAT policy
remain separate decisions. Compression, background folder watching, offline
asset caching and multi-tab collaboration are not implemented.

Provider, import and transfer contracts are in SPEC-browser-library.md,
SPEC-browser-imports.md and SPEC-browser-transfer.md. Original native databases
are not migrated automatically. No release or deployment is implied.
