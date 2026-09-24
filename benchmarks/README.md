# Reproducible ingestion benchmarks

These opt-in tools measure the complete SemiData import path and attribute
time to source copying/hash, structural validation, native parsing/database
construction, integrity/metadata checks, and publication. They generate
deterministic synthetic STDF files without retaining the lot in memory.

Run commands from the repository root using its built Python environment.
Generated STDF, databases, manifests, and reports default to ignored
`.venv/bench-data/`. Do not commit those binary fixtures or benchmark workspaces.

## Recorded Python ingestion comparison

The portable [baseline versus chunked-framing results](results/ingestion-baseline-vs-chunked.json)
contain all twelve sample timings, phase medians/ranges, input/code/native
hashes, environment details, and sampled correctness checks. User-specific
absolute paths are removed. The native binary is identical in both cohorts.

| Workload | Baseline import median | Chunked import median | Baseline preflight | Chunked preflight |
| --- | --- | --- | --- | --- |
| 1M PTR, 93.7 MB | 2.059 s | 2.087 s | 0.791 s | 0.619 s |
| 10M PTR, 936.5 MB | 22.177 s | 20.304 s | 8.850 s | 6.024 s |

The 1M cohort demonstrates **no full-import improvement**. The 10M median
falls by **8.45% overall** and **31.93% in preflight**. Native-phase timing
drifted despite identical binaries: the 10M native median increased from
7.223 s to 8.329 s. Baseline and candidate cohorts ran consecutively, not as
interleaved A/B samples; this drift limits precise causal attribution.
Counts, database sizes, and sampled values/flags/identities match, with peak
RSS around 36 MiB. These are measurements of one machine and specific
synthetic workloads. Native retest-index measurements are a separate
comparison and must not be combined with these Python-only figures.

## Generate a workload

```powershell
./.venv/Scripts/python.exe -m benchmarks.generate --duts 10000 --tests 100
./.venv/Scripts/python.exe -m benchmarks.generate --duts 100000 --tests 100
```

The default seed is 42 and there are four sites. The first command produces
1,000,000 PTR records in approximately 93.7 MB; the second produces 10,000,000
PTR records in approximately 936.5 MB. A JSON sidecar records exact source
size, raw and encoded SHA-256, expected counts, settings, and generation time.
Existing fixture paths are never overwritten.

Every PTR carries a test name, units, scales, limits, and formatting metadata.
Results vary deterministically across DUTs, with a small site offset. One DUT
in 101 has an explicitly failing measurement. Wafers contain at most 2,048
unique DUTs. This workload exercises repeated metadata and scalar database
storage; it does not represent all ATE encodings, MPR/FTR workloads, or every
production STDF distribution.

Optional variants:

```powershell
./.venv/Scripts/python.exe -m benchmarks.generate --duts 10000 --tests 100 --gzip
./.venv/Scripts/python.exe -m benchmarks.generate --duts 10000 --tests 3 --retest part
./.venv/Scripts/python.exe -m benchmarks.generate --duts 10000 --tests 3 --retest die
```

Retest variants perform a second pass of every device within the same open
wafer. They preserve PartID, head/site, and coordinates and set the PRR PartID
or die-coordinate supersession bit. Thus 10,000 unique devices produce 20,000
attempts and 60,000 PTR records, with 10,000 superseded attempts. The source
hash changes between variants. Gzip uses an empty embedded filename and a
zero modification timestamp for repeatability within the same compression
implementation.

## Time one import

```powershell
./.venv/Scripts/python.exe -m benchmarks.ingestion `
  .venv/bench-data/benchmark-10000d-100t.stdf `
  --label baseline-1m `
  --json .venv/bench-data/reports/baseline-1m.json
```

The harness creates a unique workspace for each run so duplicate detection
cannot bypass ingestion. `--workspace` can specify a new directory explicitly.
It prints a concise result and writes the complete JSON report. Each invocation
must be a fresh process so the peak-memory high water mark belongs to that
sample. The harness retains its workspace for inspection and later logical
comparisons.

To repeat a sample three times in separate processes:

```powershell
1..3 | ForEach-Object {
  ./.venv/Scripts/python.exe -m benchmarks.ingestion `
    .venv/bench-data/benchmark-10000d-100t.stdf `
    --label "baseline-1m-$_" `
    --json ".venv/bench-data/reports/baseline-1m-$_.json"
}
./.venv/Scripts/python.exe -m benchmarks.summarize `
  ".venv/bench-data/reports/baseline-1m-*.json" `
  --json .venv/bench-data/summaries/baseline-1m.json
```

For the larger workload, substitute `benchmark-100000d-100t.stdf` and a
different report label. Keep summary files outside the report glob. Summaries
report minimum, median, and maximum; they reject a cohort with differing input,
sampled logical content, native binaries, or application-source hashes.

## What is measured

| Field | Included work |
| --- | --- |
| `full_import_seconds` | Actual `Library.import_file`, including publication |
| `snapshot_hash_and_lock_seconds` | Initial file checks, source copying, SHA-256, source flush, and import lock acquisition |
| `preflight_normalization_seconds` | Structural validation plus any normalization the current implementation performs |
| `native_parser_database_seconds` | Native parser, SQLite writes/indexes, and its configured progress callbacks |
| `integrity_metadata_counts_seconds` | Database integrity verification, metadata extraction, counts, and small Python wrapper overhead |
| `publication_other_seconds` | Remaining provenance update, flush, rename, catalog publication, and cleanup |
| `memory_after.peak_rss_bytes` | Process peak resident working set, including native allocations |
| `database_bytes` | Published parser database file size |

The Python wrappers instrument the existing call boundary and restore it after
the run; they do not substitute a parser or disable the application's normal
validation. The native phase retains whichever progress/stop configuration the
application uses. Its current polling thread can quantize small workloads by
approximately 100 ms; do not attribute that fixed overhead to parsing speed.

Source hashing for report provenance happens before the timed region and warms
the input cache. The real import hashes the snapshot again as part of its work.
OS caches are not flushed. These are warm/unspecified-cache measurements, not
claims about cold disks. Catalog initialization, interpreter startup, report
formatting, and logical sampling are excluded from the full-import timer.

The report includes Python/platform details, logical CPU count, application
revision, tracked working-tree changes, source and implementation hashes, native
binary hashes, process CPU time, and available disk space. Windows memory uses
`GetProcessMemoryInfo`; other supported platforms use `resource.getrusage`.
Compare like workloads on the same machine. Run imports sequentially and stop
other builds, benchmarks, or heavy analysis during a timed series.

## Check the result as well as the duration

Each import performs the application's required integrity/count validation.
The harness additionally hashes logical PTR rows from evenly spaced DUT
attempts, covering values, test/parameter flags, test identity, and DUT metadata,
including supersession. Sampling runs outside the timed region. Matching sample
hashes provide useful regression evidence, but are not exhaustive database
equivalence. For semantic parser changes, compare the relevant complete tables
and run the application's regression suite as well.

Run the benchmark tooling's small correctness checks with:

```powershell
./.venv/Scripts/python.exe -m unittest benchmarks.test_tools -v
```

These checks require the real installed Rust extension. They verify deterministic
raw/gzip records, expected parser counts, PartID/coordinate retest behavior,
phase accounting, and detection of a changed numeric sample.

## Compare an isolated native build

An optional package root allows the same Python application to load a preserved
native baseline or candidate in a fresh process:

```powershell
./.venv/Scripts/python.exe -m benchmarks.ingestion `
  .venv/bench-data/benchmark-10000d-3t-retest-part.stdf `
  --native-package-root .venv/native-baseline `
  --label native-baseline-part
```

That directory must already contain the importable `rust_stdf_helper` package
for this Python/platform ABI. The harness records the actual loaded binary's
hash. It does not build, replace, or install that package. Change only one
implementation layer at a time, or state clearly when comparing combined
changes.

## Storage and cleanup

A 936.5 MB raw fixture and each completed import need roughly another 936.5 MB
source snapshot plus its parser database; intermediate normalization may also
temporarily require a full raw copy. Repeated runs intentionally retain separate
workspaces. After comparing results and stopping all processes using them, you
may remove the specific benchmark workspaces you no longer need. Retain source
manifests and JSON reports with any published performance claim.
