# Browser storage proof: validation and decision

Recorded 2026-09-24 on Windows 11. Scope: BL-1, a synthetic one-row database.
The STDF parser remains a summary scanner. No STDF library, folder queue,
production backup format, or analysis changes are included.

## Decision

Continue with the official SQLite WASM `3.53.4-build1` package and
`opfs-sahpool` for the next single-file experiment. It persisted across real
browser process restarts without cross-origin isolation headers. The package
has no runtime dependencies; `playwright-core 1.63.0` is test-only. A clean
`npm ci --ignore-scripts` and local asset build passed; npm reported zero known
vulnerabilities in the three-package audit at that time.

Build/reproduction commands are in [README.md](README.md#run-the-storage-proof).
[storage-validation.json](storage-validation.json) retains browser versions,
individual checks, memory observations and SHA-256 asset hashes. Source and
runtime licenses ship in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).

## Verified behavior

| Surface | Version | Evidence |
| --- | --- | --- |
| Installed Chrome, headless isolated profile | 153.0.8010.48 | All 11 integration checks passed, including full process restart |
| Installed Edge, headless isolated profile | 153.0.4234.48 | All 11 integration checks passed, including full process restart |
| Codex embedded browser, manual visible UI | Engine version not collected | Save, close/reopen, page reload/reopen, second-tab rejection and visual layout verified |

The embedded browser's host process was not restarted; export/restore was not
manually exercised there. Its complete restart/backup support remains
unqualified. Firefox, Safari, private mode, managed-browser policies and mobile
browsers were not tested. These are observations on these installations, not
a general browser-support promise.

Each automated browser run verifies:

1. Empty export is rejected with save-first guidance.
2. Create, commit a note, close, and reopen the same row and timestamp.
3. Reload and recover the committed row.
4. Reject a second owner, then allow it to retry after release.
5. Reject invalid notes/operations without changing saved data.
6. Export a SQLite file, change the note, then restore the original row.
7. Reject corrupt, incompatible-version and oversized backups without changing
   the live row.
8. Terminate a worker and recover ownership and the committed row.
9. Close the isolated browser process, launch it again with the same profile
   and server origin, then recover the row.
10. Simulate missing OPFS and require an explicit unsupported error.
11. Export a separate 3,000-row OPFS database one page at a time, restore it in
    chunks, pass SQLite integrity verification, and compare every restored row.

The proof keeps `journal_mode=DELETE` and `synchronous=FULL`; tests do not
disable durability. Restart occurs after a completed commit. Power loss,
mid-transaction process failure, disk/quota exhaustion and import publication
recovery are later BL-3 checks, not claims of this experiment. The strict probe
schema/version is checked before writes; no automatic upgrade/reset is provided.

Independent review found an empty-export/nonempty-restore inconsistency. The
worker now requires a saved row before exporting, and the regression check
passes. Review reported no remaining P1/P2 findings. The existing parser's
STDF.io fixture also passed native/WASM and independent Python comparison:
44,800 measurements, 20 groups, fingerprint `8fceda952793195d`.

## Storage and memory observations

The probe file was 16,384 bytes: two 8,192-byte SQLite pages. The pool had six
reserved handles and one logical file. Observed SQLite WASM allocation was
8,388,608 bytes (8 MiB). This excludes JavaScript buffers, VFS/browser internals
and process RSS; it is not a measured peak for STDF ingestion.

Automatic profiles reported `persisted: false` and about 10 GiB estimated
quota; the embedded page also reported best-effort storage. Estimates fluctuate
while synchronous handles are open and are not the database's physical size or
reserved space. No persistence grant is assumed. Site-data clearing still
removes storage; keep an independent export. Profile and exact origin, including
port, determine where the database belongs.

## Bounded transfer feasibility

The user-facing probe caps backups at 1 MiB and uses the pool's whole-file
`exportFile()` helper. It is deliberately not the eventual large-file path.

The separate integration fixture instead uses the released public
`sqlite_dbpage('main')` virtual table. A read transaction remains open while a
prepared statement returns pages in order, with each OPFS writable-sink write
awaited before reading the next page. No full-database JS buffer is constructed.
The query plan has no temporary sort. Chunked `pool.importDb()` reads the
resulting file in 8 KiB slices into a separate closed target database.

Both browsers exported 172,032 bytes in 21 pages; the largest transfer buffer
was 8,192 bytes. All 3,000 restored rows matched and `integrity_check` returned
`ok`. Observed WASM allocation remained 8 MiB. This establishes a viable public
API path, not measured constant browser memory or large-database qualification.

Before BL-4 ships, add streaming hashes, versioned source-plus-database packages,
interrupted-transfer handling, user-selected output/fallbacks, and 1M/10M
measurement memory/restore tests. At very large sizes SQLite's reserved locking
page can differ from raw storage bytes; hash the actual exported artifact.
Never depend on sahpool's private physical filenames or container headers.

Sources: [released DBPAGE implementation](https://github.com/sqlite/sqlite/blob/version-3.53.4/src/dbpage.c),
[released build flags](https://github.com/sqlite/sqlite/blob/version-3.53.4/ext/wasm/GNUmakefile),
[DBPAGE API](https://sqlite.org/dbpage.html), and
[official browser persistence APIs](https://sqlite.org/wasm/doc/trunk/persistence.md).

## Next checkpoint

BL-1 is complete for the tested desktop browsers. BL-2 is one real STDF source
with preserved records, source identity and a reopened inventory. Specify its
schema and batch contract before coding. Folder queues and analysis remain
separate later features.
