# Browser data workflow

Status: proposed next increment, 2026-09-24. This is a logistics plan, not a list
of features already available. Analysis design remains with the engineer.

## The next useful result

Import one STDF, close the browser, reopen the same application, and find the
saved dataset ready without selecting or parsing the original again. Prove
that small workflow before adding a folder containing hundreds of files.

The current browser lab keeps summaries in memory. The current workbench has
a native SQLite library. This plan adds a persistent library to the browser
application; it does not automatically migrate the native workspace.

## Two places with different jobs

| Place | Purpose | Proposed behavior |
| --- | --- | --- |
| Source folder | Your original STDF files | Read access only; originals are never renamed, edited, or deleted |
| Browser library | Saved datasets and import history | SQLite in browser-managed local storage, with copied source bytes for reproducibility |
| Export destination | A portable copy you control | Explicit export/restore; independent of a remembered source-folder permission |

The candidate storage is the browser's Origin Private File System (OPFS).
It belongs to a browser profile and website origin, not the selected folder,
and is not directly visible as a normal folder in File Explorer.
[MDN's OPFS explanation](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system).

Origin includes the hostname, scheme, and port: our current `127.0.0.1:8765`
and `127.0.0.1:8766` addresses represent different browser stores. Choose a
stable application address before retaining working libraries. Browser storage
can be cleared; a persistence request can reduce automatic eviction but is not
a backup. The interface should show storage estimates and persistence status.
[Browser storage policy](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

## The intended engineer workflow

1. **Open library.** See completed imports and any interrupted jobs.
2. **Add files.** Start with one file; later choose several or a source folder.
3. **Review selection.** See names, relative paths, sizes, and supported formats.
   Folder selection inventories candidates before starting an import.
4. **Import.** Copy/hash the source, skip verified duplicates, parse into bounded
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
Other browsers can use file/folder input controls and ask for selection again.
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

SQLite is the candidate to test, not a proven browser-storage result yet. The
earlier 3.6–6.0 second summary scans do not predict database-import times. The
[provider specification](../SPEC-browser-library.md) and
[ordered tasks](../tasks/todo.md#browser-data-logistics-proposed) define the next checks.
