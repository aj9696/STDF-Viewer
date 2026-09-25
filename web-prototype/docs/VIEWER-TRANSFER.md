# Viewer workspace and Excel transfer

Status: browser-local implementation, format version 1. These providers run in the
library owner worker and use only same-origin, locally bundled dependencies.
They never send source or report data to a server.

## Portable workspace (`.sdworkspace`)

`site/viewer-transfer.js` exports `runViewerTransfer(store, message, context)`.
`store` must be an open `LibraryStore` holding its exclusive library lock.
`context.checkCancelled()` throws on cancellation; `context.progress(event)`
receives progress. Both callbacks are optional for direct provider callers.
The production worker exposes this through
`DataLibraryClient.viewerTransfer(action, options)`.

| Action | Input | Successful result |
| --- | --- | --- |
| `saveSession` | `{ state }` | `{ file, filename, token, bytes, sourceCount }` |
| `restoreSession` | `{ file: File }` | `{ state, datasetMap, restored, reused }` |
| `release` | `{ token }` | `{ released: true }` |

The returned save `file` is an OPFS snapshot. Download it before calling
`release`. Release is idempotent and accepts only a generated UUID followed by
`.sdworkspace`; names from imported metadata never become storage paths.

### Archive contents

The workspace is a ZIP64-capable, unencrypted ZIP using STORE (method 0).
It contains exactly one UTF-8 `manifest.json` and one existing `.sdlibrary`
package per distinct selected dataset:

```json
{
  "format": "semidata-workspace",
  "version": 1,
  "state": {
    "selection": {
      "groups": [{ "name": "Lot comparison", "datasetIds": ["old-uuid"] }],
      "heads": null,
      "sites": null,
      "attempts": "current"
    },
    "settings": { "bins": 30 },
    "tests": [],
    "tab": "overview",
    "seriesBy": "aggregate",
    "includeAggregate": false
  },
  "sources": [{
    "oldDatasetId": "old-uuid",
    "sha256": "64 lowercase hexadecimal characters",
    "member": "sources/0.sdlibrary"
  }]
}
```

The UUID and digest strings above illustrate fields; a real archive must contain
valid UUIDs and hashes. Source members are limited to `sources/0.sdlibrary`
through `sources/7.sdlibrary`. A source selected in several comparison groups
appears only once in the archive. Group order and source order are retained.

Each `.sdlibrary` preserves the original retained STDF snapshot, the normalized
database and its manifest/checksums. Derived viewer caches are disposable and
are regenerated after restore. Compression envelopes, custom font binaries,
browser permissions, temporary exports and other browser-local preferences are
not embedded. A restored custom-font preference therefore still needs the font
to be available in the destination browser.

`state.selection` follows `VIEWER-CONTRACT.md`. `state.tests` is an array of
canonical six-field test keys; `selectedTests` is also accepted and remapped for
direct provider callers. Both arrays are validated. Other state fields are
bounded JSON values, preserved without executing them; the UI must validate its
settings before applying them. Reserved prototype-related property names are
rejected. Unknown state fields must not be treated as executable code, SQL or
filesystem paths.

### Restore and failure semantics

1. Inspect the bounded ZIP directory, entry types, member inventory and manifest.
2. Extract one source package at a time into a private OPFS staging file and
   validate its ZIP CRC-32 and declared size.
3. Match its source SHA-256 to the workspace manifest. Call the existing
   `restorePackage` operation, which verifies source/database checksums, schema,
   integrity and retained relationships before deduplication/publication.
4. Reuse a valid ready dataset with the same supported source identity, or
   publish the verified restored dataset. Remove that source's staging file.
5. Only after all sources succeed, return state with remapped group dataset IDs
   and the source UUID prefix of unresolved test keys. Resolved test keys retain
   their logical identity.

This provider returns state; it never applies UI state. On failure/cancellation,
no state is returned. Sources completed before the failure remain available.
The error explicitly reports this and carries `completedDatasetIds` for direct
callers; the worker protocol currently forwards the explanatory message, not
this extra property. A later retry verifies all packages again and reuses those
completed sources. Existing ready datasets and original source snapshots are
never overwritten.

Native upstream desktop SQLite `.db` sessions are incompatible. Their schema
and contents differ from browser retained datasets, and they do not contain the
original source snapshots required here. The error directs callers to select a
`.sdworkspace` package instead.

### Resource limits and cleanup

| Resource | Limit |
| --- | --- |
| Distinct source datasets | 8 |
| Complete workspace input/output | 64 GiB |
| Individual `.sdlibrary` member | 8 GiB |
| UTF-8 manifest | 128 KiB |
| State JSON before inventory overhead | 120 KiB |
| State nesting | 12 levels |
| Selected test keys per supported array | 12 |
| ZIP members | 9 |
| Individual ZIP reader allocation | 1 MiB |

Only ZIP STORE is accepted for this format. Recompressing an archive into another
method is rejected rather than expanding an unbounded session payload. Strict
ZIP validation rejects encrypted entries, directories, links, special files,
repeated/unexpected paths, overlapping entries, bad CRCs and size mismatches.
These limits supplement the existing retained dataset/package validation.

Output and restore staging live under `semidata-viewer-exports-v1`, with random
UUID `.sdworkspace`/`.sdlibrary` names. Failed operations abort and remove their
own temporary files. Save releases each temporary library export after its
contents have been streamed successfully into the workspace. A browser/process
crash may leave temporary files. `cleanupViewerTransfers()` removes only owned
UUID files and must be called at startup while holding the exclusive library
lock, before creating new exports. It does not touch unrelated names or data.

## Streaming Excel workbook writer

`site/xlsx-writer.js` exports:

```js
await writeWorkbook({
  writable, // fresh file stream: async write(bytes), close(), abort(error)
  sheets: [{
    name: 'DUT Summary',
    headers: ['Part ID', 'Test value'], // optional; do not repeat in rows
    rows: asyncRowIterable,            // arrays; sync iterable also accepted
    freezeRows: 1,                    // default: 1 with headers, otherwise 0
    autoFilter: true                  // optional
  }],
  images: [{                         // optional PNGs
    sheet: 0,                       // logical sheet index or exact input name
    blob: pngBlob,
    anchor: { column: 2, row: 3, width: 640, height: 360 }
  }],
  context: { checkCancelled, progress }
});
```

`rows` supplies data only when `headers` is provided. Column/row anchors are
zero-based; image dimensions are pixels and default to the PNG IHDR dimensions.
When input sheet names repeat, use the numeric image sheet index to disambiguate.
The writer checks the PNG signature/IHDR, then embeds the original Blob. It does
not decode/render PNG pixels or generate charts; the report assembler provides
chart images.

On success the writer closes the supplied stream and returns:

```js
{ bytes, sheets: [{ name, rows, columns, sourceSheet, part }], images }
```

`sourceSheet` is the zero-based logical input sheet index, and `part` starts at 1.
`rows` includes repeated headers. On any error the writer calls `abort`, closes
active row generators and throws. The caller owns the output file and must
remove an unpublished handle; the production report provider does so. Do not
replace an existing user file before this complete output is ready for download.

### Values, XML and workbook layout

| JavaScript value | Excel representation |
| --- | --- |
| `string` | Literal `inlineStr`, including leading `=`, `+`, `-` or `@` |
| finite `number` | Numeric cell |
| `boolean` | Boolean cell |
| `null` / `undefined` | Blank cell |
| non-finite number or object | Explicit error; caller must format deliberately |

There are no formulas, macros, external links or a shared-string table. XML
metacharacters are escaped. Actual LF and CR characters round-trip; literal
OOXML `_xHHHH_` strings are protected, forbidden XML controls use OOXML escapes,
and unpaired UTF-16 surrogates are replaced with U+FFFD. Supplementary Unicode
characters are preserved. Excel itself has finite numeric precision; identifiers
requiring more than Excel's significant digits must be supplied as strings.

Sheet names are sanitized, limited to 31 UTF-16 code units and made unique without
regard to case; reserved `History` becomes `History_`. Headers use a bold style.
Freeze panes and autofilter apply to each physical part. PNG drawings use OOXML
relationships with no external targets.

Data automatically continues in a suffixed sheet when it reaches Excel's
1,048,576-row limit, including its header. Headers repeat; input order is preserved
with one-row lookahead. Charts remain on the first part of their logical sheet.
For example, 1,048,579 data rows plus a header produce physical row counts
1,048,576 and 5. No rows are silently truncated.

### Writer limits

| Resource | Limit |
| --- | --- |
| Logical sheets | 64 |
| Physical sheets after splitting | 1,024 |
| Columns per row | 16,384 |
| Characters per text cell | 32,767 UTF-16 code units |
| Escaped text per row | 1 MiB |
| Encoded XML per data row | 2 MiB |
| Total PNG data / number of images | 64 MiB / 256 |
| Individual image width/height | 100,000 pixels |
| Workbook output | 64 GiB |

The production report provider has tighter limits where appropriate (currently
16 GiB output, 12 selected tests and 128 images). Oversized cells/rows/columns
fail explicitly; the assembler must split long record JSON/hex into labeled
adjacent cells. Ordinary XML rows are batched around 64 KiB, streamed to ZIP
STORE, and never accumulated as a complete sheet/package. Cancellation checks
occur during row generation and each output write; periodic event-loop yields
allow a real worker cancellation message to arrive.

## Reproducible verification

Build pinned local vendor assets with `node scripts/build-vendor.mjs`. Generate
the mixed-family fixtures as documented in `VIEWER-DECODER.md`, then run from
`web-prototype`:

```text
node scripts/viewer-transfer-check.mjs chrome
node scripts/viewer-transfer-check.mjs msedge
node scripts/viewer-e2e-check.mjs chrome
node scripts/viewer-e2e-check.mjs msedge
```

Each run creates isolated browser profiles and an ephemeral loopback fixture
server. It does not read or modify the user's library. Generated artifacts and
results stay in ignored `results/viewer-transfer-<browser>-<timestamp>/` folders.
The test server receives generated test artifacts only so Python's independent
standard-library ZIP/XML reader can inspect them; production transfer code has
no such network path.

Coverage includes real two-source SQLite package save/restore/deduplication,
fresh-profile ID/key remapping, hostile manifests and nested package corruption,
partial restore/cancellation, owned-orphan cleanup, 70,000-row output, an actual
1,048,579-row split, literal formula-looking cells, LF/CR/Unicode/OOXML escapes,
PNG relationships, failure/abort cleanup and real worker cancellation. Production
worker routes additionally generate all eight report sections with mixed
PTR/MPR/FTR data, verify record-converter bytes against every original STDF record,
and exercise report failure cleanup and workspace client methods.

`viewer-e2e-check.mjs` additionally drives the production viewer UI in isolated
profiles: mixed PTR/MPR/FTR selection, ordered groups and retests, all eight tabs,
scoped chart-to-device picks, nested original-record dialogs, CSV/XLSX device
downloads, report generation with real chart images, workspace save/restore into
existing and empty libraries, generated-file inventory after reload, and explicit
temporary-file removal followed by original-source verification. Independent
Python ZIP/XML/CSV checks inspect its actual browser downloads. Each run includes
desktop and 360 px screenshots; CSS dialog animations finish before capture.
The network audit excludes Edge's internal `edge://` download UI resources and
records their count separately from external requests.
