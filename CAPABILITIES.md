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
browser-only library retains STDF in local SQLite, coordinates file/folder
queues and exports/restores portable packages. Its Data viewer now supplies
the investigation workflows listed below; the native PAT lab remains separate.

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
| browser-ui | Library home and Test Explorer: imports, saved datasets, recorded PTR declarations and paged observations | browser-library, browser-imports |

The engineering console is `web-prototype/site/foundation.html`. The first
product frontend is `web-prototype/site/app.html`, documented in
[the library home guide](web-prototype/docs/LIBRARY-HOME.md) and
[SPEC-browser-ui.md](SPEC-browser-ui.md). It consumes the existing client and
source modules. Test Explorer adds bounded read-only queries and the
`explore.html?dataset=<id>` route; see [its specification](SPEC-test-explorer.md)
and [guide](web-prototype/docs/TEST-EXPLORER.md). Later product features remain
separately reviewable. Normalized
retained measurements cover PTR; MPR/FTR retain device context and exact raw
records. The separate derived viewer normalizes all three families with explicit
defaults, identity and population policy. Compression is implemented. Background
folder watching, offline asset caching and multi-tab collaboration are not.

Provider, import and transfer contracts are in SPEC-browser-library.md,
SPEC-browser-imports.md and SPEC-browser-transfer.md. Original native databases
are not migrated automatically. No release or deployment is implied.

## Browser investigation baseline (2026-09-25)

The engineer now authorized the working feature set of upstream STDF-Viewer.
This supersedes the earlier restriction to raw inspection and logistics. The
[viewer specification](SPEC-browser-viewer.md) defines the module dependency
map, data preservation and numerical policies. The [parity tracker](docs/viewer-parity.md)
separates planned from verified workflows. The existing retained library stays
immutable; derived analysis caches provide PTR/MPR/FTR, device, bin, wafer and
record queries. Workspace, chart and report modules consume those contracts.

Delivered workflows include multi-file/folder and compressed import, ordered
groups, test/device matrices and drilldown, exact statistics, trend/histogram,
bins, wafer/stacked maps, datalog/original records, low-Cpk health scanning,
settings/fonts, eight-section Excel reports, device CSV/Excel, record conversion
and portable workspace save/restore. See the [engineer guide](web-prototype/docs/VIEWER-UI.md),
[methods](web-prototype/docs/VIEWER-METHODS.md) and
[qualification](web-prototype/docs/VIEWER-VALIDATION.md). Desktop presentation
and format differences are explicit in the parity tracker. Cold viewer indexing
of the 10M PTR workload took 9m43s after import and remains an optimization target.
Browser PAT, history, SPC, correlation and production automation are future work.
