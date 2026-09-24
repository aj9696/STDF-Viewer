# SemiData Workbench capability map

Status: first engineering evaluation release, 0.1.0. Working product name: SemiData.

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

The next authorized increment is measured import performance and an isolated
browser parser experiment. See SPEC-import-performance.md for its capability
map, acceptance criteria, and benchmark boundaries.
