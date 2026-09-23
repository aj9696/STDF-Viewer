# Specification: data-library

## Objective
An engineer imports STDF files once, returns to the same workspace, and selects
datasets for analysis. Existing upstream desktop behavior remains available.

## Contract and acceptance
- Import one local STDF (including supported compression) into a unique staging
  directory with a copied source. SHA-256 deduplicates identical source bytes.
- Parse using `rust_stdf_helper.generate_database`, never into the catalog.
- Publish a dataset only after validation and database integrity checks.
- Catalog schema is versioned. Unknown newer versions fail explicitly.
- Keep original source and parser database under workspace/imports/<id>/.
- Import failures do not publish datasets or replace existing data.
- Record filename, hash, lot/product, start time, counts, and parser duration.
- Reject truncated record framing and incomplete files for this release.

## Boundaries
No cross-file retest consolidation, no background directory watcher, no deletion
UI, no upload to outside services. An import is one independent dataset.
Repeated records for the same DUT/test inherit upstream's last-write behavior;
raw bytes remain retained for future reprocessing.

## Structure / verification
`semidata/library.py`, `semidata/ingest.py`, and `tests/test_library.py`.
Use stdlib sqlite3/pathlib; typed functions and parameterized SQL.
Run `.venv\Scripts\python.exe -m unittest discover -s tests -v`.
