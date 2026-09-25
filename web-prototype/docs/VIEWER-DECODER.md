# Viewer decoder contract

Status: implementation contract, version 1. The derived viewer cache is disposable.
It is built from the immutable source snapshot and does not modify retained-v1
databases, the library catalog, or portable packages. Cache identity includes the
source SHA-256, `viewer-v1` parser version, cache schema, and interpretation policy.

## Streaming interface

`new ViewerParser()`, `push(Uint8Array)`, `drain()`, `finish()`, `memory_bytes()`,
and `free()`. Push, drain, and finish return JSON strings. Input pushes are at
most 65,536 bytes; total source size is at most 2 GiB. After every push or drain,
consume the batch and call drain again while `pending` is true. Do not push or
finish with pending output. Incomplete record bytes alone do not set pending.

Each batch is `{version:1,pending,tests,observations,pinStates,devices,metadata}`.
Arrays contain positional rows described below. There are at most 2,048 rows and
2 MiB of serialized JSON per batch. Decoding retains no measurements across
completed batches, except output from one bounded STDF record awaiting drain.
Test/declaration state is limited to 20,000 identities/declarations and 16 MiB of
metadata. Exceeding a limit fails with `METADATA_LIMIT`, never silent truncation.

All IDs are source-local safe integers. Record sequence starts at one and matches
the retained index; device ID is the matching PIR sequence. Family is STDF
record subtype 10 (PTR), 15 (MPR), or 20 (FTR). JSON numbers are finite or null;
unsigned IEEE-754 bits retain NaNs, infinities, and signed zero exactly.

| Batch array | Positional row |
|---|---|
| tests | `[testId,family,testNumber,name,firstSeq,defaultMetadataJson]` |
| observations | `[recordSeq,resultOrdinal,deviceId,testId,head,site,testFlags,parmFlags,rawBits,rawValue,value,low,high,metadataId,unit,pmrIndex]` |
| pinStates | `[recordSeq,role,ordinal,pmrIndex,state]` |
| devices | `[id,head,site,prrSeq,partFlags,numTests,hardBin,softBin,x,y,testTime,partId,partText,waferId]` |
| metadata | `[id,recordSeq,type,subtype,deviceId,json]` |

PTR emits ordinal zero; MPR emits one observation per returned result. MPR with
zero results emits a single ordinal-zero observation with null numeric fields,
so its execution remains countable. FTR emits ordinal zero with null numeric
fields. `parmFlags` is null for FTR. Every source execution is preserved, including
repeated tests within a single attempt. MPR pin states have independent ordinal
and count: result and return counts need not match. Result-to-PMR mapping is
provided only when the result count equals the effective return-index count.
`role` is `RTN` or `PGM`; unresolved indexes and absent states are null.

Device coordinates retain STDF's -32768 sentinel. `waferId` is the WIR record
sequence associated with the PIR's head, not the wafer name; null means no WIR
association. This association is captured when PIR is encountered. The decoder
never suppresses attempts based on PRR supersede flags. That is a versioned query
policy, with source ordering, head/site, wafer identity, and missing coordinates
handled explicitly.

## Values and interpretation

`value`, `rawValue`, `low`, and `high` are **base-unit** physical values. `value`
equals the finite raw result; it is not prefiltered by flags. `unit` is effective
base UNITS. Analytical queries must exclude invalid flags and nonfinite values.
Scaling exponents are display metadata, not different physical quantities.

Test identity is `(family,testNumber,effectiveName)`. Explicit empty names remain
distinct from physically omitted names. An omitted name reuses a unique prior
identity of the same family and number. If multiple identities exist, a separate
unresolved identity is emitted and metadata records the ambiguity; the decoder
never arbitrarily chooses a test or fails the entire cache for that ambiguity.

The first declaration supplies defaults. A later declaration overrides fields
for that record only, and does not replace the first defaults. Optional flags
distinguish inherited limits/scales from explicitly absent limits. Empty default
strings inherit; the STDF single-NUL string explicitly clears a default string.
Limit and specification raw bits, field presence, and original declaration bytes
are retained in declaration metadata. Flags do not erase observed result bits.

Declaration JSON contains `identity`, `raw`, `presentFields`, `rawTailHex`, `warnings`, and
`effective`. Identity is `resolved`, `unresolved-omitted`, or `unresolved-ambiguous`;
include this in cross-dataset identity matching, never match synthetic display
names to actual source names. Effective fields include `unit`, `scale`, `lowScale`, `highScale`,
`low`, `high`, `lowSpec`, `highSpec`, `pinIndices`, `pattern`, and `section`.
Limits/specifications in effective metadata also use base units. Cold metadata
is emitted once per distinct declaration (metadata ID is its first record
sequence). Observation rows reference that ID. Cold STDF records use their own
record sequence as ID and their decoded uppercase STDF field names in JSON.
Metadata includes FAR/ATR/VUR/MIR/MRR/PCR/HBR/SBR/SDR/PMR/PGR/PLR/RDR,
WIR/WRR/WCR/TSR/GDR/DTR/BPS/EPS; unknown record families remain source-indexed.
GDR retains typed values rather than flattening them into a display string.

`finish()` returns `{version:1,parserVersion:"viewer-v1",bytes,records,tests,
observations,devices,metadata,byteOrder,recordCounts,warnings}`. It validates the
final record boundary, MIR/MRR, and matching device starts/ends. `byteOrder` is
`little` or `big`. Warnings is a bounded list of interpretation warnings, not
one entry per measurement.

`decode_record(bytes, byteOrder)` decodes exactly one complete framed record and
returns JSON `{type,subtype,name,fields}`. Byte order must be `little` or `big`.
This is for record inspection/conversion, not an admission validator. Unknown
records return name `UNKNOWN` and raw payload hex. Finite JSON fields are usable
for display; exact source bytes remain authoritative for nonfinite float bits.

## Compatibility and primary source

This separates physical observations from original desktop implementation
choices: desktop replacement inserts collapse repeated DUT/test rows; browser
observations retain them. Desktop first-scale application to every limit is not
reproduced. Display formats must apply independent result/low/high exponents or
choose a single engineering unit consistently for a chart.

The [Teradyne STDF V4 specification, pages 47–54](https://storage.googleapis.com/google-code-archive-downloads/v2/code.google.com/stdf-eclipse/Stdf-V4-spec.pdf)
defines first-record defaults, local overrides, independent display exponents,
and base-unit numerical storage. It also permits a default-only PTR outside a
device interval. ViewerParser supports that as metadata without an observation.
The retained-v1 parser intentionally keeps its original rejection behavior.

## Additive retained-v2 admission

`RetainedParserV2` exposes the same push/finish/memory/free API and identical
positional row schema as `RetainedParser`. It admits an orphan PTR only after MIR
when TEST_FLG bit 4 is set and PARM_FLG is zero. It retains the record and its
declaration, with null record device ID and no measurement row. Its decoded JSON
is `{DEFAULT_ONLY:true,TEST_NUM,HEAD_NUM,SITE_NUM,TEST_FLG,PARM_FLG,DEFINITION_ID}`;
flags are numeric bytes. Other orphan test records remain errors. Within a
device interval, flagged PTRs remain observations, preserving existing facts.

V2 finish adds `default_only_ptr` and the same count plus `default_only_policy`
inside coverage. V1 JSON is unchanged. New imports using this class must write
manifest parserVersion `retained-v2`; physical dataset schemaVersion remains 1.
Readers and portable package validators must explicitly accept v1 and v2,
publish the manifest's parser version, and deduplicate by source/schema/parser.
Do not relabel existing datasets. The current parser version for new writes is
separate from the set of versions accepted for reading.

Independent browser fixtures are generated by the ignored Rust test
`write_browser_fixtures` in `rust/tests/viewer.rs`, using `VIEWER_FIXTURE_DIR` for
the destination. It writes little/big endian mixed-family fixtures and
default-only fixtures, with handwritten expected counts and coordinates.

Cache consumers must use bounded typed queries and composite keyset cursors
`(recordSeq,resultOrdinal)`. Do not recreate the desktop's full-file NumPy
matrices or collapse repeated rows. Create indexes before inserts to avoid
SQLite's unbounded in-memory index sort. Discard interrupted caches; source and
retained database remain the recovery authority.
