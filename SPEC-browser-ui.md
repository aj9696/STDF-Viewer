# Browser UI: library home

Module: browser-ui. First product frontend slice, authorized 2026-09-24.
Depends on the delivered browser-library and browser-imports interfaces. The
engineer requested a polished frontend developed one feature at a time.

## Objective and scope

A test engineer can open the same local library, find a saved STDF, import one
new source, and inspect its retained dataset metadata without using the developer
console. Use a light, restrained engineering workspace with a dark sidebar,
clear typography, blue accent, compact file table and focused dialogs. All
displayed counts come from real datasets. No sample/demo rows in production UI.

One user journey: library -> single raw STDF import -> saved dataset -> reopen.
Folder/multiple-file UX, analytics, charts, deletion, backup/restore workspace UX
and session settings remain later slices. Existing engineering tools stay usable.

## Interface and structure

Add `web-prototype/site/app.html`, `app.css`, `library-home.js`, and `library-home-view.js`.
The existing `app.js` belongs to the summary parser and remains unchanged.
Keep current parser `index.html`, synthetic proof and engineering console routes.
Use the same origin/library and DataLibraryClient; no SQL/OPFS/schema changes,
dependencies, frameworks, external fonts/CDNs or network data service.

Auto-open on load. Read catalog using pages of at most 100, with a total cap of
1,000 entries matching the provider. Keep metadata only in UI memory; render 25
rows per table page, with filename/path search and sort across loaded inventory.
Use getDataset on selection to check availability, never reparse a source to
show metadata. Unavailable entries stay visible. Counts describe measurements,
device attempts and declarations, with raw coverage limitations made explicit.

Select/drop exactly one eligible raw file. `inventoryFiles([file])` handles
eligibility; explicit Import starts `importFile`. Show worker phase/byte progress
without fabricating an overall percentage. Cancel cooperatively and retain the
actual settled outcome. Duplicate success reuses the existing dataset. Invalid
files, cancelled imports and errors never produce fake ready rows.

Serialize requests; disable overlapping actions during worker operations. Native
dialogs handle focus, Escape and keyboard navigation. During import, Escape/close
does not hide an active job; Cancel requests cancellation. pagehide terminates the
owner; bfcache return reopens and reports any interrupted job. Never reset storage.
Second-tab BUSY gets a clear message/retry. Storage status reports actual usage
and persistence; a user gesture can request persistence. Opening developer tools
uses same-tab navigation so pagehide releases library ownership.

DOM contract for the browser harness:
`#connection-status`, `#connection-error`, `#retry-open`, `#add-file`,
`#search-files`, `#sort-files`, `#dataset-rows`, `#empty-library`,
`#no-results`, `#previous-page`, `#next-page`, `#page-label`,
`#import-dialog`, `#source-file`, `#drop-zone`, `#selected-file`,
`#start-import`, `#cancel-import`, `#close-import`, `#import-status`,
`#phase-progress`, `#open-imported`, `#dataset-dialog`, `#dataset-name`,
`#dataset-info`, `#close-dataset`, `#storage-details`, `#persist-storage`.
Dataset name buttons carry `data-dataset-id`; table rows carry `data-id`.

Use textContent/createElement for source text. Example:
```js
const name = document.createElement('button');
name.textContent = dataset.name;
name.dataset.datasetId = dataset.id;
```
Two-space indentation, named helpers; no generic UI framework or worker bypass.

## Acceptance and verification

- Empty library has a working import action and no fabricated data.
- Real import, duplicate, malformed-file error, cancellation and reload/reopen
  work via the user-facing controls. Existing data remains available.
- Search, sorting, pagination and detail views reflect catalog metadata; the
  UI never labels device attempts as unique production devices.
- BUSY/unsupported/open failures, unavailable datasets and storage status are
  actionable. No confirmation or auto-reset of existing browser data.
- Long/untrusted filenames display as text. Dialogs and core workflow are
  keyboard accessible. Narrow viewports have no whole-page horizontal overflow.
- Real-browser integration uses isolated profiles/synthetic fixtures. Mocked
  catalog fixtures may exercise pagination/errors but are labeled test-only.
- Visually inspect real empty, populated, import and detail states. Document the
  feature, tested behavior and deliberately deferred workflows.

Commands from repository root:
```powershell
node --check web-prototype/site/library-home.js
node --check web-prototype/site/library-home-view.js
.venv/Scripts/python.exe web-prototype/scripts/make-library-fixtures.py
node web-prototype/scripts/frontend-check.mjs chrome
node web-prototype/scripts/frontend-check.mjs msedge
.venv/Scripts/python.exe -m http.server 8766 --bind 127.0.0.1 --directory web-prototype/site
```

## Plan and boundaries

Startup correction, 2026-09-25: direct `file://` opens must explain the local HTTP
launch address before importing application modules or creating a worker. Both
library home and Test Explorer use a classic bootstrap for this preflight.
App-module load errors and a 15-second module-load delay show deliberate reload
guidance; a late success clears that notice. This does not impose deadlines on
database operations or imports. Verify actual file URLs and HTTP failure/reload
recovery against a saved fixture in Chrome and Edge using
`node web-prototype/scripts/startup-check.mjs chrome` (and `msedge`).

1. Record scope, then build markup/view/controller/styles against existing APIs.
2. Test actual first-import/reopen workflow and targeted UI failure states;
   independently review lifecycle and rendering. Commit the verified slice.
3. Verify real browser visuals/responsive behavior, update guide and expose the
   route. Stop for engineer evaluation before the next product feature.

Always preserve saved data and professional documentation. Routine layout and
integration choices are authorized by the request to build this first feature.
Later analytical semantics and additional product workflows remain engineer
decisions. Never upload source data, silently change schema, or invent metrics.
