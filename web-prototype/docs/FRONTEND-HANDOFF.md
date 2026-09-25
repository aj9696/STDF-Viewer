# Frontend handoff: local test-data logistics

Status: foundation reference, updated 2026-09-25. The next product work can use a
documented browser library API instead of building storage into UI components.
The console demonstrates the full logistics integration. The first product
feature, [library home](LIBRARY-HOME.md), provides single-file import,
saved-dataset search and metadata reopen. [Test Explorer](TEST-EXPLORER.md) is the
next implemented slice: recorded PTR test search, declarations and observation
paging. Its Chrome/Edge qualification and limits are recorded in that guide.
The new [Data viewer](VIEWER-UI.md) is also implemented: its
[query contract](VIEWER-CONTRACT.md), [methods](VIEWER-METHODS.md),
[transfer contract](VIEWER-TRANSFER.md) and [qualification](VIEWER-VALIDATION.md)
extend this foundation. It adds separate derived caches and never mutates
retained datasets. PAT remains a future browser capability.

## What is available

| Capability | Current behavior |
| --- | --- |
| Persistent library | Dedicated worker, local SQLite catalog, one immutable database and exact snapshot per imported source |
| Source selection | Multiple raw/compressed files, read-only directory handles, or folder file-input fallback; review before import |
| Import queue | Sequential files, content deduplication, per-file outcomes, cancellation and explicit rescans |
| Retained evidence | Ordered record indexes, PTR measurements, declaration metadata and device attempts; original bytes remain accessible |
| Test Explorer | Product UI for one dataset's PTR test-number search, recorded declarations and paged observations; no inferred analytical policy |
| Reopen and recovery | Reopen saved data without selecting original files; inspect durable job history and discard known incomplete staging |
| Portability | Versioned source-plus-database package, bounded transfer, validation before publication, explicit temporary-export cleanup |
| Data viewer | PTR/MPR/FTR investigation, groups, head/site/attempt populations, plots, records, reports and portable workspaces; see linked viewer contracts |

The JavaScript entry points are [DataLibraryClient](../site/data-client.js),
[sources.js](../site/sources.js), and [ImportQueue](../site/import-queue.js).
Use the [frontend contract](FRONTEND-CONTRACT.md) and [source contract](SOURCES.md)
for exact methods and errors. UI code must not open SQLite, mutate OPFS, issue
SQL, or bypass the client worker protocol.

## Try the console

Follow the [build and run instructions](../README.md#run-the-library-foundation),
then open [the engineering console](http://127.0.0.1:8766/foundation.html).
Use the same origin and browser profile throughout the reopen experiment.

1. Select **Open library**. Review the actual persistence status and approximate
   quota. A second owner tab reports BUSY; close its library connection before
   retrying. **Request persistent storage** reports the browser's actual answer.
2. Choose one completed raw STDF or a source folder. Inspect candidate and skipped
   entries. Subfolders are excluded unless selected. A candidate means its
   metadata is eligible; full STDF validation happens during import.
3. Select **Import reviewed files**. Review individual outcomes and durable jobs.
   A duplicate reuses the existing dataset; changed bytes produce another dataset
   even when the filename matches. Files are not automatically merged into lots.
4. Select a dataset to read its metadata. Choose Records, Measurements, Device
   attempts, or Definitions and use **Read first 100 rows**. The console is a
   bounded preview; it has no complete browsing or analysis interface.
5. Close/reopen the library, reload the page, or restart the browser. Saved datasets
   reopen without source-folder access. Source selections, inventory, and queue
   progress are session state; the catalog and job history are durable.
6. Select **Verify source and database** when a full integrity check is needed.
   Opening metadata checks availability/schema/manifest but does not hash every
   source byte or establish every database page's integrity. Verification checks
   scalar types/bounds, record spans and device/measurement references as well
   as SQLite integrity and the source hash.
7. Select **Export dataset package**, then click its download link and save the
   `.sdlibrary` file. Confirm the browser finished saving before **Release listed
   completed downloads**. The release button removes only the displayed temporary
   export batch, not completed datasets or copies already downloaded elsewhere.
8. Select the saved package and choose **Restore selected package**. To test actual
   recovery, restore into a separate browser profile/library. A duplicate restore
   still verifies and stages the whole package before returning the existing
   dataset; it needs working disk space. Completed datasets are not overwritten.

A package contains one source and its database. It is not an export of the whole
catalog, all datasets, job history, UI settings, or remembered folder permissions.
Older/newer unsupported versions fail explicitly; there is no automatic schema
migration, native-workbench database conversion, or library reset.

## Folder behavior and interruption

The selected folder supplies files; it is not the database destination. The
browser stores the library in origin-private storage. A remembered handle is
only a way to reconnect to a source folder, and the browser may require read
permission again. The folder file-input fallback must be selected again to
refresh its File snapshots. There is no background folder watcher.

Use **Rescan selected folder** to inventory changes. Every examined entry counts
toward the 10,000-entry bound, including skipped files and directories. Inventory
and outcome tables display their first 100 entries, while the queue processes all
reviewed eligible items. Files whose name, size, or modification time changed
after inventory fail with SOURCE_CHANGED; rescan deliberately. Metadata checks
do not guarantee an atomic view of a file still being written by a test system.

**Cancel operation** requests a cooperative stop. A completed import remains
completed; pending queue entries do not start. Some synchronous SQLite work can
delay cancellation. Leaving or reloading the page terminates the worker, so its
last visible progress message is not a commit receipt. Reopen, refresh datasets
and jobs, and inspect the outcome before retrying. Unfinished jobs become
interrupted; no byte-offset resume is implied.

Failed/cancelled jobs normally clean up their own unpublished staging. If staging
remains, select that known incomplete job and use **Discard selected staging**.
History remains, and completed datasets are preserved. A missing or inconsistent
published artifact becomes unavailable instead of being replaced with an empty
database. Preserve the affected profile for diagnosis and recover a verified
package in a separate library; clearing site data is not a recovery procedure.

The temporary-export inventory includes prior sessions and interrupted files,
including zero-byte entries. Download links exist only for exports created in
the current console session. After a reload, create a new export from the saved
dataset if another download is needed; release old temporary files explicitly
when no download needs them. The app cannot detect browser download completion.

## Integration rules for the production frontend

- Serialize library operations. Keep navigation and controls honest about an
  active mutation; do not share one client between concurrent queues. Keep
  cooperative cancellation available and show its eventual outcome.
- Use phase and byte progress, and show per-file errors. Do not turn separate
  snapshot/parse/validation passes into an invented overall completion percentage.
- Render filenames, decoded text, and error messages as text. Treat packages and
  all test data as inputs; checksums provide integrity, not sender authentication.
- Respect pagination. Catalog/export pages have at most 100 entries. Row pages
  have a 2 MiB JSON-data budget and can be shorter than requested; continue with
  `nextAfter`, not an assumption about page length.
- Keep exports disk-backed using the returned File and object URLs. A completed
  download is a separate user action from generating a package or clicking a link.
- Present storage usage as an estimate, persistence as the browser's actual grant,
  and the local origin/profile as the library's location. Account for snapshots,
  databases, journals, restore staging, and retained exports. No quota reservation
  or offline-startup guarantee is provided.

The library home implements open/reopen, saved-dataset search and single-file
import feedback. The latest product slice, Test Explorer, reads saved PTR
declarations and observations through bounded queries; it does not perform
analysis. Review these workflows with the engineer before expanding them.
Keep folder batches, portability and recovery as separately reviewable user
journeys backed by the existing methods.

## Analytical boundary and evidence

Only PTR produces normalized measurement rows. MPR/FTR retain device context and
raw indexes, and other record families remain framed/indexed as declared by
`manifest.coverage`. Repeated results and attempts, raw flags/bits, and omitted
versus empty PTR declarations remain available. They do not define a population,
effective limit, retest rule, pass/fail decision, yield, PAT method, or cross-file
part identity. Those decisions belong to the engineer's later analysis design.
Test Explorer displays this evidence literally: omitted/empty fields remain
distinct, floating-point special values come from retained bits, and result or
limit scaling/defaults are not applied. Its [feature guide](TEST-EXPLORER.md)
and [specification](../../SPEC-test-explorer.md) define the inspection boundary,
verification commands and completed browser evidence independently of the
earlier foundation qualification.

Use [LIBRARY-VALIDATION.md](../LIBRARY-VALIDATION.md) for recorded evidence and
open qualification limits; use the [README](../README.md#foundation-verification)
for commands and fixture prerequisites. Passing Node source/queue tests does
not establish native folder-picker permissions or IndexedDB handle serialization
in every browser. The separate source-browser harness checks real OPFS handles,
IndexedDB restart persistence and the file-input fallback in installed Chrome
and Edge; it does not qualify native OS picker prompts. Historical summary-scan
results measure a different workload
and must not be presented as persistent import or package-transfer performance.
