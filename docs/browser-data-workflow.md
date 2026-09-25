# Browser data workflow

Status: implemented logistics foundation, 2026-09-24. Open the
[library engineering console](http://127.0.0.1:8766/foundation.html) after following
[the build/run instructions](../web-prototype/README.md). This is a functional
console for the data interfaces. Product screens include
[library home](../web-prototype/docs/LIBRARY-HOME.md) and
[Test Explorer](../web-prototype/docs/TEST-EXPLORER.md), opened from a saved dataset
overview to inspect PTR declarations and observations. The
[feature comparison](feature-landscape.md) supports choosing later features one
at a time. Analysis design remains with the engineer.

## What is ready

Import raw STDF, close/reopen the library, and inspect saved records without
selecting or parsing the original again. Review multiple files or a source
folder, run a sequential queue, inspect failed/interrupted jobs, and transfer
source-plus-database packages between browser profiles.

The parser summary lab and synthetic SQLite proof remain separate. The native
workbench also remains runnable; its databases and analytical policies are not
automatically migrated into this browser library.

## Two places with different jobs

| Place | Purpose | Behavior |
| --- | --- | --- |
| Source folder | Your original STDF files | Read access only; originals are never renamed, edited, or deleted |
| Browser library | Saved datasets and import history | SQLite in browser-managed local storage, with copied source bytes for reproducibility |
| Export destination | A portable copy you control | Explicit export/restore; independent of a remembered source-folder permission |

Storage uses the browser's Origin Private File System (OPFS).
It belongs to a browser profile and website origin, not the selected folder,
and is not directly visible as a normal folder in File Explorer.
[MDN's OPFS explanation](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system).

Origin includes the hostname, scheme, and port: our current `127.0.0.1:8765`
and `127.0.0.1:8766` addresses represent different browser stores. Choose a
stable application address before retaining working libraries. Browser storage
can be cleared; a persistence request can reduce automatic eviction but is not
a backup. The console shows storage estimates and persistence status.
[Browser storage policy](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

## The engineer workflow

1. **Open library.** See completed imports and any interrupted jobs.
2. **Add files.** Choose one or several files, or a source folder.
3. **Review selection.** See names, relative paths, sizes, and supported formats.
   Folder selection inventories candidates before starting an import.
4. **Import.** Copy/hash the source, skip already-ready identical content, parse into bounded
   batches, validate, then publish the dataset. Progress distinguishes these
   phases. Start with one file at a time.
5. **Return later.** Open stored datasets without reading their source folder.
6. **Export or restore.** Transfer a verified dataset package when changing
   computers, browser profiles, or application addresses.

One source file produces one dataset. Identical bytes under a different name
are a duplicate; changed contents under the same name are a new source. Files
in the same folder are not automatically merged into a lot or one device history.

Folder support starts with an explicit **Rescan** action. Subfolders are an
opt-in selection, shown in the inventory. An incomplete or still-growing STDF
is reported individually and can be retried; completed imports stay available.
Nothing in this phase requires continuous watching or a browser running after
its window is closed.

Initial target: desktop Chrome and Edge, with feature detection. A supported
directory picker can retain a folder handle, but permission may need renewal.
Browsers meeting the OPFS/Web Locks storage requirements can use file/folder
input controls when the directory picker is unavailable, asking for selection
again. The fallback solves picker availability, not missing storage APIs.
[Directory picker requirements](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker),
[Chrome's permission model](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api).

## What we preserve for your later analysis plans

Keep the exact source, source hash, parser/schema versions, record order and
offsets, device attempts, test metadata, raw result bits and flags. Retain
repeated measurements instead of making a last-result decision during storage.
Unsupported record families remain recoverable from the source and are reported
as coverage gaps. Storage does not decide populations, screening methods,
derived metrics, or cross-file device identity.

## Small steps and visible checkpoints

| Step | What you should be able to try |
| --- | --- |
| 1. Persistence proof | Save a tiny database; close/reopen it and restart the browser |
| 2. One real STDF | Import the evaluation file and reopen its retained records |
| 3. Recovery and portability | Cancel/retry safely; export and restore a dataset |
| 4. Folder batches | Review a folder, import a queue, rescan, and skip duplicates |
| 5. Volume checks | Repeat at 1M and 10M measurements with storage included |

Full database imports and portable recovery are measured separately from the
earlier summary-only scans. See [validation and limits](../web-prototype/LIBRARY-VALIDATION.md)
for measured sizes, timings, browser versions, memory evidence and remaining
qualification gaps. The [frontend handoff](../web-prototype/docs/FRONTEND-HANDOFF.md)
describes how the next interface should use the tested modules.

Each import snapshots and hashes source bytes before parsing. Ready means that
initial validation passed; access checks existence, size, schema and manifests.
Use **Verify source and database** to run a current full integrity/hash check.
Known unavailable data cannot be treated as a duplicate. Recover using a verified
package in a separate profile/origin; there is no in-place repair or reset button.

Exports first create a temporary package in browser storage. Save its download,
then explicitly release listed temporary packages. A restarted console inventories
abandoned exports too. Discarding a known failed/interrupted job removes only its
unpublished source/database/journal staging and retains job history. Retrying
starts at the beginning; successful earlier queue items remain ready.

Current envelope: raw IEEE STDF V4, 2 GiB per source, 20,000 exact definitions,
16 MiB definition-tail cache, 10,000 inventory entries/jobs, 1,000 datasets and
8 GiB packages. These are guards, not claims that all boundary combinations are
qualified. Browser quota must also accommodate staging, journals and exports.
PTR measurements are normalized; MPR/FTR and unsupported families retain original
record bytes and coverage labels. Compression and automatic folder watching
remain future work.
