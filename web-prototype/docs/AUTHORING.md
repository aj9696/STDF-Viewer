# Derived revisions and conversion

The **Edit / convert** tool works on one complete original source at a time.
It never updates the retained source, retained database or viewer cache. Head,
site and retest filters do not limit a source conversion or bulk bin remap.
Screening exports instead carry explicit original PRR sequences from their
preview population.

## Workflow

1. Select a source and record, or specify a source-wide bin remap.
2. Stage changes and supply a revision reason.
3. Preview the changes and matching remap count.
4. Export a derived STDF. Import that file to investigate the changed data.

**Remove device attempts** stages original PIR sequence IDs, with per-item Undo
and a complete Revert draft action. Preview shows the number and IDs of removed
attempts. **Batch conversion** offers a checkbox for each source in the workspace;
All/None controls and the selected-source count make the eight-source limit
explicit. Choosing Original STDF for one source downloads that file directly;
multiple sources and other formats produce a ZIP with a receipt.

The original can be downloaded without a revision; that operation preserves
every byte exactly. A revision can be saved as JSON and validated again later.
It identifies the original by dataset ID and SHA-256, rather than its filename.
Revision files are declarative data; they cannot execute expressions or SQL.

## Supported changes

| Record | Editable fields |
|---|---|
| PTR | `RESULT`, finite R4 value in base STDF units |
| MPR | One or more `RTN_RSLT` ordinals, finite R4 values |
| PRR | Hardware/software bins, part ID/text, signed X/Y coordinates, outcome bits 3 and 4 |
| MIR | All typed fields, including UTC setup/start, station number and burn-in minutes |
| SDR | Equipment description strings and site-group number with linked wafer-reference updates |
| MRR | UTC finish time, disposition and descriptions |
| SBR/HBR | Bin number, head/site scope, name and declared outcome; count is regenerated |
| TSR | Test number/type, head/site scope, test name, sequence name and label; retargeted counts are regenerated |
| DTR | Note text |

SBR, HBR and DTR records can be added. Optional SBR, HBR, TSR and DTR records
can be deleted. Unsupported fields and record types fail before an export is
published. New bin counts are calculated from the resulting parts. A remap
sets an explicit outcome (`pass`, `fail` or `preserve`); the program does not
guess from a similarly numbered bin in another source/site.

The editor and worker share one field/type policy. Integers retain their STDF
width/range; strings retain C1/Cn limits. Timestamp controls explicitly use UTC
and whole U4 seconds, without a browser-timezone conversion. Changed setup/start
and start/finish pairs must remain ordered when both times are nonzero. Changing
lot timestamps does not shift device or wafer timestamps.

SDR `SITE_GRP` renumbering updates matching WIR/WRR references in the same derived
revision; preview lists those related changes. Group numbers remain unique,
unknown group 255 is not guessed, and conflicting head references fail. SDR
`HEAD_NUM`, `SITE_NUM` membership and its array count remain read-only: changing
equipment ownership is a separate structural transformation.

Bin definition edits do not move or reclassify devices. Their new scoped counts
are rebuilt from PRRs; conflicting bin definitions fail. Retargeting a TSR by
test number/type/head/site rebuilds execution, failure and alarm counts from
matching recorded tests, counting MPR records once, excluding not-executed
records, and marking failure count unknown if any executed verdict is unknown.
Per-test timing is absent from result records, so retargeted timing and numerical
result aggregates are explicitly invalid (`OPT_FLAG=255`), never copied from the
old identity. Duplicate resulting TSR identities and invalid summary scopes fail.
Computed counts, flags and summary statistics are read-only. A revision cannot
edit TSRs while also changing measurements/removing attempts, since that policy
removes those TSR records. These restrictions preserve a consistent derived file.

Measurement changes retain recorded test flags and limits. They do not imply a
new test verdict. PRR outcome edits preserve retest, abnormal and reserved bits.
One revision supports at most 10,000 field/insert/delete changes and 1 MiB of
JSON. A screening revision therefore supports at most 5,000 changed devices if
both the software bin and outcome are changed. The source-wide remap uses a
small rule and is independent of that per-field limit.

Whole recorded attempts can be removed by their original PIR sequence ID.
The revision removes precisely their indexed PIR, PTR, MPR, FTR and PRR records;
unowned notes and unknown/global records remain. Interleaved other head/site
attempts are preserved. Preview rejects incomplete or inconsistent ownership,
duplicate IDs, attempts also being edited, and deletion of a test's first
declaration when surviving results might inherit its metadata. The latter needs
an explicit metadata-materialization feature before it can be safely supported.
Coordinates are signed 16-bit STDF values; `-32768` retains its missing-coordinate
meaning. Neither operation modifies the original source.

## STDF output policy

Unchanged records and unchanged fields retain their original bytes, including
unknown record types, NaN payloads in untouched measurements, original byte
order and omitted tails. R4 edits round to IEEE binary32 and reject overflow.
An ATR immediately after FAR records the revision. Non-ASCII reason characters
are represented by `?` in the ATR; the JSON revision retains the full reason.

PCR and WRR part/good/abort counts and existing SBR/HBR counts are recomputed
from the resulting **recorded attempts**, including repeated attempts. Unknown
outcomes are not counted as good. Retest and functional summary counts are
marked unknown (`4294967295`), since those totals cannot always be reconstructed
unambiguously. A missing PCR receives an aggregate PCR. Measurement edits remove
optional TSR summaries instead of retaining stale numerical summaries. Removing
attempts also removes TSR summaries and excludes those attempts from derived
STDF summaries, CSV and record JSON. The
preview warns about these policies. Required record structure is validated by
the existing retained parser before the completed file is returned.

Wafer counts follow the existing source/WIR/head context. The implementation
supports 200,000 combined scoped bins, wafer records and summary scopes. Output
is limited to 16 GiB for bundles and 2 GiB for individual STDF files. Errors and cancellation remove incomplete output files.
Original checksum verification runs before output generation.

## Batch conversion

The worker can convert up to eight complete sources sequentially into one ZIP:

| Format key | Contents |
|---|---|
| `original` | Exact original STDF, irrespective of a supplied revision |
| `stdf` | Derived STDF when a revision is supplied, otherwise exact original |
| `csv` | Long-form observation table for every recorded PTR/MPR/FTR execution |
| `json` | Versioned complete record JSON, with exact framed bytes as `rawHex` |

CSV preserves record sequence, result ordinal, source-attempt identity, raw R4
bits, units, limits and flags. It is not limited to the table page or selected
twelve tests. Text cells that could execute spreadsheet formulas are prefixed
with an apostrophe. Record JSON is the lossless conversion: decoded numbers
alone cannot represent all binary floating-point payloads, while `rawHex` can.
CSV identifies observations by original sequences; derived record JSON identifies
the emitted sequence after ATR insertion and optional-record changes.

`receipt.json` records each completed requested output, source hash and whether
it includes a revision. Supplied revisions are also included as JSON members.
A failed batch is removed rather than returned with a success receipt. The
manual's undefined “Full” dialect is not claimed: the UI labels the actual ZIP
contents. SINF, SEMI G85 and SEMI E142 interoperability remains pending an exact
recipient profile/schema and validation file; generic XML is not exported under
those names.

## Worker API

`runViewerAuthoring(store, message, context)` handles worker requests. The
message has `{action, selection?, options}`. When supplied, `selection` restricts
which dataset IDs may be accessed; conversion still uses each whole source.

```javascript
const options = {
  datasetId,
  reason: 'Correct a documented bin assignment',
  edits: [
    {seq: prrSeq, field: 'SOFT_BIN', value: 9},
    {seq: prrSeq, field: 'PART_FLG', value: (originalFlags & ~24) | 8},
    {seq: mprSeq, field: 'RTN_RSLT', ordinal: 1, value: 0.025},
  ],
  // Optional: applies after individual edits, to all matching source attempts.
  remap: {kind: 'soft', from: 2, to: 9, outcome: 'fail'},
  insertRecords: [],
  deleteSeqs: [],
  deleteDevices: [], // Original PIR sequence IDs, never page row numbers.
};
```

- `preview`: validates `options` and returns `{plan, changes, affectedDevices,
  deletedDevices, remappedDevices, warnings}`. The edit/remap counts describe separate operations
  and can overlap.
- `edit`: validates and stores the plan; also returns its JSON download.
- `export`: `{datasetId, plan?}` → completed STDF download and receipt.
- `convert`: `{datasetIds, formats, plans?: {[datasetId]: plan}}` → ZIP download.
- `release`: `{token}` removes only a recognized authored export, idempotently.
- ATDF actions are documented in [ATDF import](ATDF.md).

Downloads return `{file, filename, token, kind: 'authoring', receipt}` and reside
in `semidata-authoring-exports-v1`. Tokens are UUID filenames with an allowlisted
extension. Saved JSON plans are revalidated against immutable records when used;
their claimed “before” values are not trusted.
The worker also recomputes `relatedEdits` (wafer group references) and
`rebuiltSummaries` (TSR identities) from source bytes on each preview/export.

## Verification

```powershell
node web-prototype/scripts/authoring-model-check.mjs
node web-prototype/scripts/authoring-check.mjs chrome
node web-prototype/scripts/authoring-check.mjs msedge
node web-prototype/scripts/authoring-ui-check.mjs chrome
node web-prototype/scripts/authoring-ui-check.mjs msedge
```

The browser harness uses isolated origins. It exercises original export,
LE/BE revisions, unknown-record preservation, multiple-result editing, remapping,
summary reconstruction, interleaved-attempt removal, signed coordinate edits,
UTC/numeric metadata, linked wafer references and retargeted test summaries,
derive/reimport, CSV/JSON/ZIP output, malformed edits,
wrong-source plans, cancellation cleanup and ATDF import. A separate Python
`struct`/CSV/ZIP oracle checks emitted artifacts without using the application's
encoder/decoder. These checks do not extend earlier parser-throughput benchmarks
to revision or conversion workloads.
