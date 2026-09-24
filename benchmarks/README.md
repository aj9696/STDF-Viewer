# Reproducible ingestion benchmarks

Final combined application evidence is in
[ingestion-final.json](results/ingestion-final.json). Its three-run medians are
2.279 s for 1M PTR and 20.968 s for 10M PTR, including the compact-PTR identity
correction and native retest changes. Relative to the earlier baseline, 1M is
slower and 10M modestly faster; cohorts were not interleaved. The Python-only
and index-only comparisons below isolate different changes and should not be
substituted for final application totals.

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

## Recorded native retest comparison

The portable [native retest results](results/retest-index.json) isolate the
database index change from the later PTR metadata correction. Both builds use
the same Python sources. The baseline native source is revision
`74a9fa25a2049f47481aef13035d298e7017db95`; the candidate changes only
`database/context.rs` and `database/schema.rs`. Actual binary hashes are recorded.

| Workload | Baseline native median | Indexed native median | Baseline full import | Indexed full import |
| --- | ---: | ---: | ---: | ---: |
| 10,000 PartID retests, 60,000 PTR | 6.220 s | 0.201 s | 6.340 s | 0.354 s |
| 10,000 coordinate retests, 60,000 PTR | 5.819 s | 0.201 s | 5.944 s | 0.322 s |
| Ordinary 1M PTR control | 0.802 s | 0.802 s | 2.065 s | 1.957 s |

There are three fresh-process samples per build per workload, interleaved as
baseline/candidate, candidate/baseline, baseline/candidate. Builds and other
benchmarks were stopped during the series. Native retest medians improved by
about 31× and 29× on these fixtures. The ordinary native control is unchanged
within measurement resolution; this change does not accelerate the ordinary
PTR loop. These results are separate from the Python-only comparison above.

The first baseline/candidate pair for each retest fixture has equal rows across
all 15 database tables, excluding only `File_List.Filename`, which identifies
different temporary snapshots. This includes every result, both flag bytes,
device identity, test metadata, and supersession value. Both fixtures retain
10,000 superseded and 10,000 current attempts. Sampled hashes also match across
all six samples of each workload. The ordinary control creates no retest index
and has the same database size. Retest indexes add 479,232 bytes for PartID and
376,832 bytes for coordinates; process peak working sets remain around 37 MiB.

To repeat the complete sequence, generate the three fixtures documented above
and preserve the two importable native package directories. Then run:

```powershell
./.venv/Scripts/python.exe -m benchmarks.native_retests `
  --baseline-package-root .venv/native-baseline `
  --candidate-package-root .venv/native-index-candidate2 `
  --prefix native-repeat `
  --output .venv/bench-data/native-repeat.json
```

The runner executes all 18 imports sequentially, preserves their raw reports,
rejects changed Python sources or mismatched logical samples, and performs the
exhaustive retest comparisons after timing. Use a new prefix for every series.
To regenerate the published portable summary from the retained original reports:

```powershell
./.venv/Scripts/python.exe -m benchmarks.native_retests `
  --summarize-only --prefix index2 `
  --output benchmarks/results/retest-index.json
```

The summary contains no user-specific paths. Its stored table hashes use the
documented projected rows in sorted order. Native phase measurements retain
the application's progress polling overhead, which is material for the 0.2 s
candidate runs. The index is created on the first retest of its type, and
`INDEXED BY` ensures SQLite uses it even before statistics exist.

## Storage and cleanup

A 936.5 MB raw fixture and each completed import need roughly another 936.5 MB
source snapshot plus its parser database; intermediate normalization may also
temporarily require a full raw copy. Repeated runs intentionally retain separate
workspaces. After comparing results and stopping all processes using them, you
may remove the specific benchmark workspaces you no longer need. Retain source
manifests and JSON reports with any published performance claim.
