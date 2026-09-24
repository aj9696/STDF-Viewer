# Why STDF looks this way

STDF solves a concrete interoperability problem: testers from different
manufacturers, and even different product families, produced incompatible
results. Teradyne designed a common exchange format that the wider ATE
industry adopted. SEMI records that rationale in its
[RITdb project proposal](https://downloads.semi.org/web/wstdsbal.nsf/c8f1681362290e72882581800081edd5/7a9b04a737d08c12882583eb00622c11!OpenDocument).

The original specification explains several choices that complicate readers:

- Typed, variable-length records serve storage and transmission independently
  of a database architecture.
- Writers use their native representation; the first record identifies it so
  readers can convert. This avoids conversion work on the tester.
- Omitted trailing optional fields save space. Flags distinguish missing or
  invalid values from usable measurements.
- Lot, wafer, device, and test records describe different levels of the run.

Source: Teradyne's *STDF Specification V4*, Introduction, Design Objectives,
Record Structure, Data Representation, and Optional Fields. The readable
[specification transcription](https://raw.githubusercontent.com/cmars/pystdf/master/docs/source/stdf.rst)
is maintained with PySTDF; the
[original PDF](https://storage.googleapis.com/google-code-archive-downloads/v2/code.google.com/stdf-eclipse/Stdf-V4-spec.pdf)
provides the complete record definitions.

## Why compact files still become enormous

Volume multiplies. One million device attempts with 1,000 scalar results each
produce a billion result records. At an illustrative 20 bytes per result that
is already 20 GB, before other records; actual size depends on the record
contents and optional fields. Compression reduces stored bytes but still
requires processing the expanded records.

## Implications for this project

Our engineering approach is to preserve the source and convert it into a query
database once. Repeated investigations should query that database. Input should
be scanned in bounded chunks and database writes batched. Record ordering and
flag semantics must survive optimization.

Measure decoding separately from decompression, validation, snapshot copying,
database writes, index creation, and integrity checks. A fast summary-only
browser scan and a complete durable database import perform different work;
their timings must be reported separately. See the import-performance report
for measured behavior of this implementation.
