# ATDF v2 import profile

**Library → Import ATDF** works from an empty library. The same action is also
available under **Edit / convert → Import ATDF**. It converts a local `.atdf` file to canonical,
little-endian IEEE STDF v4 and imports it through the existing retained parser.
It supports the 25 v4 record names in the ATDF reference: FAR, ATR, MIR, MRR,
PCR, HBR, SBR, PMR, PGR, PLR, RDR, SDR, WIR, WRR, WCR, PIR, PRR, TSR, PTR,
MPR, FTR, BPS, EPS, GDR and DTR. Unknown extensions fail visibly. No records are
silently discarded.

## Representation

- FAR must declare ATDF version 2 and STDF version 4. The first separator selects
  the field separator. Printable punctuation separators are supported, excluding
  colon and space.
- Input is printable ASCII with CR, LF or CRLF line endings. A continuation line
  starts with a space, which is removed before joining the preceding field.
  Blank physical lines are ignored. Logical and physical lines are limited to
  1 MiB; original ATDF and converted STDF are each limited to 2 GiB.
- Fields follow the ATDF field order, including the different MIR, PRR, WIR,
  WRR, WCR and test-record layouts. Numeric values are checked against the
  target STDF type; malformed numbers and non-finite results are rejected.
- Test alarm, outcome, comparison, retest and abort codes are translated to their
  STDF bits. Array counts are derived and validated. GDR multi-byte numeric
  values receive the required alignment pad fields. TSR optional flags preserve
  the reserved bits and use the specified bits 4/5 for sums/squares.
- First PTR/MPR metadata and FTR generator/comparator metadata establish defaults. Later empty metadata fields use
  those defaults; a single-space string clears a default string. Default state
  is bounded to 20,000 tests and 16 MiB.
- `S` uses base-unit values and supplied display scales. `U` converts the ATDF-v2
  prefixes `f`, `p`, `n`, `u`, `m`, `%`, `K`, `M`, `G`, `T` into base units and
  generates display scales. For example, `1000 mV` becomes STDF `RESULT=1`,
  `UNITS=V`, `RES_SCAL=3`. Results and limits round to binary32.
- Dates use `hh:mm:ss DD-MMM-YYYY` and an explicit fixed UTC offset, in minutes.
  Default is UTC, **not** the browser's current timezone. The selected offset is
  recorded in provenance; no daylight-saving inference is performed.

The adapter validates required fields, FAR/MIR/MRR/PCR presence, the initial
ATR/MIR/RDR ordering, matching PIR/PRR and WIR/WRR records, and array lengths.
The retained parser independently validates the resulting binary stream before
publication. This does not claim support for arbitrary proprietary ATDF dialects.

## Deliberate restrictions

This profile rejects non-ASCII/vendor character encodings, version-3 or newer
vendor-extension records, special non-finite floating-point spellings, strings
over the one-byte STDF length limit, and dates outside the U4 timestamp range.
Multi-character C1 values are rejected rather than silently truncated. PMR
channel types use numeric decimal values; ambiguous vendor hex spellings such
as bare `A` are rejected.

MPR returned states require matching explicit/inherited pin indices. The
converter will not invent pin 0 for missing indices. Simultaneous wafers on the
same head require a separate profile because the current viewer assigns wafer
context per head. These cases produce an error; their source is not partially
published.

## Original input and provenance

The source ATDF is snapshotted unchanged under `semidata-atdf-originals-v1`, with
a JSON receipt containing its SHA-256, source name/size, canonical STDF hash,
conversion version, UTC offset and record count. This archive is separate from
temporary downloads and is not removed by generated-file cleanup. Conversion
staging is deleted on normal success, failure and cancellation.

The retained library stores the canonical STDF. A version-1 `.sdworkspace`
contains that canonical STDF, **not the separate original ATDF archive**. Download
the original ATDF and its receipt if original text provenance must travel with a
workspace. Clearing the site's browser storage also removes this archive.

The library import dialog offers original-input and receipt downloads after a
successful import. Later, **Edit / convert → Recover original ATDF → Find saved
ATDF** lists saved inputs for the selected canonical source and verifies their
checksums before download. Multiple original text inputs can identify the same
canonical dataset. Reimporting a duplicate reuses that dataset.

ATDF has a dedicated single-file import dialog; the existing STDF folder queue
continues to accept its documented binary/compressed formats. ATDF progress and
cancellation use the same owner worker. Malformed or cancelled conversions do
not publish a partial dataset or source archive.

Worker actions:

```javascript
// Returns normal dataset import result, plus atdf provenance and originalFile.
{action: 'importAtdf', options: {file, utcOffsetMinutes: 0}}

// Find saved original inputs by the canonical dataset's hash.
{action: 'atdfSources', options: {datasetId}}

// Returns {file, filename, receipt}; verifies the input checksum again.
{action: 'atdfOriginal', options: {datasetId, originalToken}}
```

## Reference and qualification

Mapping follows the original Teradyne [ATDF v2 reference](https://sourceforge.net/p/freestdf/svn/HEAD/tree/docs/atdf-spec.pdf?format=raw),
including sections 1-4/1-5 (framing), individual record tables, and table 3-2
(unit prefixes), alongside [STDF v4](https://storage.googleapis.com/google-code-archive-downloads/v2/code.google.com/stdf-eclipse/Stdf-V4-spec.pdf).
The reference files are not bundled with the product.

`authoring-model-check.mjs` verifies chunk boundaries, alternate separators,
continuations, scale/default inheritance, flags, pin arrays, timestamp offsets
and malformed input. `authoring-check.mjs` imports a 26-record independent text
fixture in Chrome/Edge, validates the resulting STDF and original checksum, and
uses a separate Python binary oracle. This is synthetic qualification; accepting
an unseen tester's ATDF dialect requires a representative real fixture.
`authoring-ui-check.mjs` additionally exercises empty-library import, malformed
input, cancellation cleanup, duplicate reuse, and input recovery through the
production Library and Viewer controls.
