# Library home

Status: local engineering preview, updated 2026-09-25. This screen connects the browser
library to its product workflow: import STDF files or folders, see saved datasets,
and open the data viewer. It uses the same library as the engineering console.

## Try it as a test engineer

Follow the [build instructions](../README.md#run-the-library-foundation), then open
[Data library](http://127.0.0.1:8766/app.html). Keep the same address and browser
profile to use the existing library. The screen opens its library automatically.

Open the HTTP address, not the HTML file from disk. A direct `file://` launch
shows **Open SemiData from its local app address** and links to the running local
server. It does not attempt to open storage. A module-load failure offers an
explicit reload; the module loader also reports a 15-second delay. These checks
cover app-module startup, not long-running imports or all worker/storage stalls.

1. Select **Import STDF**, choose/drop completed raw `.stdf`, `.std` or `.stf`
   files, or gzip/bzip2/single-file ZIP archives. Folder selection has an explicit
   subfolder option. Import runs sequentially and shows per-file outcomes.
   The current limit is 2 GiB per raw/compressed source and per expanded STDF.
2. Watch Copy, Read, Check and Save. Byte progress describes the current phase;
   it is not a percentage of total import time. **Cancel import** waits for the
   worker's actual outcome. Closing the modal is disabled while importing.
3. Select **Open viewer**, or select a filename in the library, to go directly to
   the [investigation UI](VIEWER-UI.md). New selections show a histogram and the
   first available test. **Details** beside a file opens retained PTR counts,
   device attempts, source/database sizes, coverage and SHA-256. Its **Raw records**
   link opens the older [Test Explorer](TEST-EXPLORER.md).
4. Search by filename or recorded relative path. Sort by import date, filename
   or source size; use the arrow controls to page through 25 rows at a time.
5. Reload the page and reopen the dataset without selecting its original file.
   Importing the same expanded bytes with another filename reuses a dataset
   with the same parser/schema version. Current imports use retained-v2;
   legacy retained-v1 datasets remain intact and readable.
   Changed content creates another dataset even if its filename is unchanged.
6. Open **Storage details** in the footer to inspect this origin, estimated
   usage/quota and the browser's persistence grant. A persistence request can be
   declined. Persistence is not a backup or a reservation of disk space.

File selection does not upload data or modify the original source. Imported
snapshots and databases live in this browser profile's origin-private storage.
Browser data clearing can remove them. The library has one owning tab at a time;
close the other library page or its console connection, then select **Try again**
if it is busy. **Library tools** opens the engineering console in the same tab,
releasing this page's connection.

## What this feature includes

The page shows actual saved catalog metadata. **Try example data** offers five
small synthetic cases: clean lot, site shift, fail-to-pass retests, wafer-edge
failures, and mixed pin/digital tests. Choosing **Open** imports the actual STDF
files and opens the suggested view; download links also provide the files
directly. Nothing is imported until an example is selected. The two-file site
shift opens independent comparison groups. Reopening examples reuses matching
saved sources. See [example data and expected results](EXAMPLES.md).

Counts report device **attempts**, not unique devices. The library labels its
measurement count as **PTR measurements**; full MPR/FTR observations are available
in Viewer. Raw source records remain preserved.

The client loads catalog metadata in pages of 100, with a 1,000-dataset inventory
limit, then searches/sorts the loaded inventory. It renders at most 25 table rows.
Opening the overview checks saved availability and metadata through the existing
API; it does not read every measurement or perform a complete integrity scan.

Interrupted imports and unavailable datasets get explicit guidance and remain
inspectable through Library tools. No screen action silently resets the library.
Long or untrusted filenames and errors are rendered as text. Native dialogs
support keyboard navigation and Escape; Escape cannot dismiss an active import.

Recorded PTR browsing is available through [Test Explorer](TEST-EXPLORER.md).
Folder batches are available here; charts, scoped investigation, reports and
save/open workspaces are available in [Data viewer](VIEWER-UI.md). PAT and
dataset deletion remain separate product work. Existing
console tools remain available for folder imports and individual `.sdlibrary`
package export/restore. A package contains one dataset, not an entire workspace.
There is no offline-startup guarantee, account, hosted data service or multi-tab
collaboration. Desktop Chrome and Edge are the qualified browsers for this slice;
narrow-layout checks do not establish mobile storage support.

## Implementation and maintenance

The module contract is [SPEC-browser-ui.md](../../SPEC-browser-ui.md).

| File | Responsibility |
| --- | --- |
| `site/app.html` | Semantic page, table, import dialog, dataset drawer and storage dialog |
| `site/boot.js` | File-launch guidance and app-module loading/error handling, shared with Test Explorer |
| `site/app.css` | Workspace design, responsive layout, focus and reduced-motion styling |
| `site/library-home.js` | Serialized client operations, UI state, progress and page lifecycle |
| `site/library-home-view.js` | Text-safe rendering, icons and count/size/date formatting |
| `site/example-picker.js` | Bundled example selection, source validation and ordinary import flow |
| `scripts/frontend-check.mjs` | Isolated browser workflow and UI failure-state checks |

The screen consumes `DataLibraryClient` and `inventoryFiles`. It does not open
SQLite, issue SQL or manipulate OPFS directly. The library, import and transfer
contracts remain compatible. Compression dependencies are pinned and locally
bundled; there are no external fonts, CDN resources or frontend framework. The existing summary parser's
`site/app.js` and root route remain separate.

## Verification

From the repository root, after building the existing WASM/SQLite assets:

```powershell
node --check web-prototype/site/library-home.js
node --check web-prototype/site/library-home-view.js
node web-prototype/scripts/frontend-check.mjs chrome
node web-prototype/scripts/frontend-check.mjs msedge
node web-prototype/scripts/startup-check.mjs chrome
node web-prototype/scripts/startup-check.mjs msedge
```

The harness requires the repository's `.venv/Scripts/python.exe`, Node.js 22+
and the installed browser. It creates small known-answer synthetic STDFs and
uses or generates a 1M-measurement synthetic source for cancellation. It never
uses the engineer's browser profile. Reports, screenshots and disposable profiles
are written beneath ignored `web-prototype/results/frontend-*` directories.

After the UI simplification, Chrome 153.0.8010.48 and Edge 153.0.4234.48 each
passed 15 grouped checks with zero page errors. Local results are
`frontend-chrome-1790352018948` and `frontend-msedge-1790352060717` under
`web-prototype/results/`. They include direct filename navigation, separate file
details, import-to-viewer navigation and keyboard focus return. The
[original evidence record](../evidence/library-home.json) describes the earlier
metadata-first flow; [example evidence](../evidence/examples.json) records the
new picker and five scenario workflows. The checks cover:

| Evidence type | Scope |
| --- | --- |
| Real worker, WASM and OPFS | Empty/open, known-answer import and metadata, SHA-256 identity, renamed duplicate, invalid input, malformed STDF, cancellation, hostile filename, reload/reopen, navigation and second-tab ownership |
| Actual page and DOM | Keyboard dialogs/focus, fresh progress between imports, live phase feedback, 360/390-pixel page width and desktop screenshots |
| Explicit test-only client fixtures | 123-entry catalog pagination, full-inventory search/sort, missing dataset, unsupported storage and open failures |
| Manual embedded-browser review | Existing evaluation dataset, library and detail layouts, import and storage dialogs |

Tests use file-input automation rather than qualifying native Windows file-picker
prompts. They do not requalify large import throughput or all storage recovery
faults; those remain covered by the [foundation validation](../LIBRARY-VALIDATION.md).
No new analysis behavior is claimed by this feature.

The 2026-09-25 startup correction passed real file-URL checks in Chrome and Edge.
Six controlled HTTP module-failure/reload cases per browser preserved a saved
dataset's ID and source hash. Chrome's existing library and Explorer suites also
passed after the change. See [startup evidence](../evidence/startup-recovery.json).
The external bootstrap's own download and a nonresponding database worker remain
outside this module-loading repair; no automatic reload or storage reset occurs.
