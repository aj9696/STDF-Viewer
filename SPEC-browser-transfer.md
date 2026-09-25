# Specification: browser-transfer

Status: implementation contract, 2026-09-24. This module is the portable backup
part of the [browser logistics capability map](CAPABILITIES.md). The library
owns staging, schema validation, recovery, and publication. This module owns
bounded byte transfer and package validation; it does not define analysis.

## Objective

Export one retained dataset together with its exact STDF source, then restore
it into new, unpublished artifacts without replacing an existing dataset.
Success means the restored source is byte-identical and the restored SQLite
database passes the library's schema, count, and integrity checks before it can
be published. An arbitrary package is untrusted input.

## Format version 1

The extension is `.sdlibrary`. The format is uncompressed and sequential:

| Bytes | Content |
| --- | --- |
| 8 | ASCII magic `SDPKG001` |
| 4 | Unsigned little-endian UTF-8 JSON header byte length |
| Header length | Header JSON, at most 65,536 bytes |
| `sourceBytes` | Exact original STDF bytes |
| `databaseBytes` | SQLite main-database pages in ascending page order |
| 64 | Lowercase ASCII SHA-256 hex digest of all preceding package bytes |

The exact total size must match; trailing and truncated bytes are rejected.
All sizes/counts are nonnegative safe integers. The package cap is 8 GiB;
the source must be nonempty and at most 2 GiB; the database is at least 512 bytes and a multiple
of 512. The header is `{formatVersion: 1, manifest, sourceBytes, databaseBytes}`.
Unsupported package, schema, or parser versions fail without output writes.

Manifest fields are `schemaVersion: 1`, `parserVersion: "retained-v1"`,
`source: {name, relativePath, size, sha256}`, `counts: {records, measurements,
devices, definitions}`, `byteOrder: "little" | "big"`, and `coverage` (a JSON
object). Source size must equal `sourceBytes`; its SHA-256 is lowercase hex.
Names are display metadata only, capped at 1,024 and 4,096 characters
respectively. They are never used as extraction paths. Additional manifest
metadata is preserved within the header size limit. Counts describe retained
rows, not analytical conclusions.

The footer checksum detects accidental corruption, not authenticity. Someone
who can rewrite a package can also recompute its checksum. The library must
still treat a verified SQLite file as untrusted and validate the exact schema,
versions, row counts, and full integrity with trusted schema disabled before
publication. Importing through the pinned SAH-pool API resets SQLite's journal
mode header bytes to rollback mode; source bytes are never modified.

## Module contract

`web-prototype/site/transfer.js` exports asynchronous functions:

```js
await exportPackage({ db, sourceFile, manifest, createHasher, writable,
  onProgress, checkCancelled, chunkBytes }); // {bytes, sha256}
await inspectPackage(file); // {header, sourceOffset, databaseOffset,
                            //  footerOffset, packageBytes}
await verifyPackage({ file, createHasher, onProgress, checkCancelled,
  chunkBytes }); // header
await restorePackage({ file, pool, databaseName, sourceWritable, createHasher,
  onProgress, checkCancelled, chunkBytes }); // header
```

`db` is the pinned SQLite OO1 connection, and `pool` is its SAH-pool utility.
The caller exclusively owns the worker/pool and serializes operations. Export
requires no preexisting transaction; it holds a read transaction for a stable
page snapshot. Consecutive pages are copied into one fixed-size transfer buffer;
each write is awaited before that buffer is reused.
Restore refuses any name already present in `pool.getFileNames()`. The target
database must be closed and its internally generated name owned by a staging
job. Names have one absolute path component (`/` followed by 1–128 letters,
digits, dots, underscores, or hyphens, starting with a letter or digit). This
avoids aliases bypassing the existing-name check. It never derives names from
a manifest.

`file`/`sourceFile` expose Blob-style `size` and `slice().arrayBuffer()`.
`createHasher()` returns `{update(Uint8Array), finish(): hexString, free()}`;
`finish` must not destroy the wrapper before `free`. The production adapter is
the Rust incremental SHA-256 hasher. Writable sinks expose awaited `write`,
`close`, and `abort`. Export closes its sink after the footer; restore closes
the source sink after both transfers succeed. Failed operations attempt to
abort their sink and release hashers, cursors, and owned read transactions.

`chunkBytes` defaults to 65,536 and is an integer from 512 to 1,048,576.
SQLite pages are limited to 65,536 bytes. No entire source, database, or package
is accumulated in a JavaScript buffer or Blob. Progress callbacks receive
`{phase, completedBytes, totalBytes}`; cancellation callbacks synchronously
throw an error (normally with code `CANCELLED`) at chunk/page boundaries.

`inspectPackage` checks framing, JSON, manifest versions, and declared sizes;
it does not verify hashes or SQLite contents. `verifyPackage` additionally
streams every payload byte, verifies the source digest and package footer,
and checks the SQLite header. Restore completes that full verification before
writing to either output, then streams the source and invokes callback-based
`pool.importDb` with a first chunk of at least 512 bytes. Restore never publishes.
The caller allocates a new staging source sink, removes its failed staging
artifacts, and validates/closes the imported database before catalog publication.

Validation errors have `Error.code` (`INVALID_REQUEST`, `INVALID_PACKAGE`,
`INCOMPATIBLE`, `ALREADY_EXISTS`, or `TRANSFER_ERROR`). Sink, hasher, progress,
and cancellation errors retain their original error details. Existing ready
artifacts remain untouched even when verification, writing, or cancellation
fails. Source and SQLite writes are separate and are not an atomic transaction.

## Implementation and verification

Implement the format/inspection and corruption checks first, then bounded
export/restore against the same fixtures. Plain JavaScript, named functions,
two-space indentation, and explicit errors match the existing worker style:

```js
throw Object.assign(new Error("Package source digest does not match."), {
  code: "INVALID_PACKAGE",
});
```

The module is under `web-prototype/site/`; deterministic Node checks live at
`web-prototype/scripts/transfer-check.mjs`. No dependency, CI, or vendored asset
changes are needed. Commands from the repository root in PowerShell:

```powershell
node --check web-prototype/site/transfer.js
node web-prototype/scripts/transfer-check.mjs
```

Tests use independent Node SHA-256 and fake SQLite page/pool interfaces to
check byte-identical round trips, bounded chunk sizes, awaited backpressure,
invalid versions and sizes, source/package corruption, truncation, cancellation,
write failures, existing-database refusal, and resource cleanup. Real-browser
library integration must separately prove the pinned SQLite APIs, source
storage, restart/reopen, validation-before-publication, and large-file memory
behavior; the Node checks alone do not qualify multi-gigabyte browser exports.

Always validate before restore writes, preserve source bytes, keep transfer
bounded, and run the focused checks. A format change requires a new explicit
version and documented compatibility behavior. Never trust checksum success
as authentication, extract manifest paths, overwrite existing datasets, relax
database validation, or add analysis/compression/network transfer in this slice.
