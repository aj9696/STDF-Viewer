# Import performance and browser feasibility

Evaluation: Windows, 2026-09-24. Measurements apply to this workstation and
these synthetic workloads. They do not rank this project against other tools.
See [benchmark reproduction](../benchmarks/README.md) for commands and
[portable results](../benchmarks/results/ingestion-baseline-vs-chunked.json) for evidence.

## Full native application import

Each entry is the median of three fresh processes using the same preserved
baseline native extension, isolating the Python ingestion change. Input was
hashed before timing; operating-system caches were not flushed. Full import
includes snapshot copy/hash/fsync, validation, native parsing and SQLite
construction, integrity/count checks, and publication. Library startup and
fixture generation are excluded.

| Workload | Source bytes | Before | Chunked validation | Change |
| --- | ---: | ---: | ---: | --- |
| 1 million PTR, 10,000 DUTs, 100 tests | 93,650,444 | 2.059 s | 2.087 s | No demonstrated full-import improvement |
| 10 million PTR, 100,000 DUTs, 100 tests | 936,502,821 | 22.177 s | 20.304 s | About 8% shorter full import |

The 10M validation/normalization phase fell from 8.850 to 6.024 seconds,
approximately 32%. We removed per-record body allocations and I/O calls, and
the redundant normalized copy for ordinary raw files. Native phase timing
drifted from 7.223 to 8.329 seconds despite the identical native binary;
machine variability limits precision and explains why the isolated phase gain
is larger than the full-import gain. Phase medians need not sum to total medians.

Peak process working set stayed approximately 36 MiB. The resulting 10M
measurement database was 339,443,712 bytes. All counts, database sizes, and
sampled logical hashes matched the baseline. The hash compares complete rows
at sampled DUT indices; it is not an exhaustive equivalence proof. Smaller
regressions compare exact rows, values, flags, identities, and metadata.

Every synthetic PTR repeats its full name, units, limits, and formatting
metadata. This stresses repeated metadata and scalar storage. A compact
producer that omits optional fields can have very different byte sizes and
throughput; MPR/FTR, compression, and arbitrary production data need separate
measurements. The application retains its 2 GiB import cap and 500,000-row
selected-analysis cap; ten million imported rows do not remove the latter.

### Final combined application

After rebuilding with the compact-PTR correctness fix and retest indexes, a
separate three-run verification measured **2.279 s for 1M** and **20.968 s for
10M**. The final 10M median is about 5% shorter than the original 22.177 s;
the final 1M median is about 11% longer than the original 2.059 s. These later
cohorts were not interleaved with the baseline, so time drift and the combined
changes cannot be isolated from these totals. Do not treat the earlier 8%
Python-only improvement as the final application's speedup.

All counts, database sizes, and sampled logical hashes still match. Peak
working set was approximately 36 MiB for 1M and 36.5 MiB for 10M. The
[final six samples](../benchmarks/results/ingestion-final.json) include code,
native binary, source hashes, phase timings, and logical comparisons.

## Retests

The native builder previously scanned device rows repeatedly when superseding
prior attempts. The new path creates a matching index only when that type of
retest is first encountered. Ordinary imports avoid those extra indexes.
PartID and wafer/head/site/coordinate matching predicates remain unchanged.
The prepared statement explicitly selects the matching index; without this,
SQLite can still choose the primary-key scan before statistics exist.

The [native retest evidence](../benchmarks/results/retest-index.json) records
three interleaved baseline/candidate samples per workload using the same Python
sources. Only the native database index implementation differs; the later PTR
metadata correction is excluded from this comparison.

| Workload | Before native | Indexed native | Before full import | Indexed full import |
| --- | ---: | ---: | ---: | ---: |
| 10,000 PartID retests, 60,000 PTR | 6.220 s | 0.201 s | 6.340 s | 0.354 s |
| 10,000 coordinate retests, 60,000 PTR | 5.819 s | 0.201 s | 5.944 s | 0.322 s |
| Ordinary 1M PTR control | 0.802 s | 0.802 s | 2.065 s | 1.957 s |

These are medians from fresh processes and import workspaces with input hashing
before timing. Other builds and benchmarks were stopped. Native retest phases
improved about 31× and 29× on these synthetic fixtures. The ordinary native
control is neutral; no ordinary PTR loop acceleration is demonstrated. Native
timing includes progress polling, which can add roughly 100 ms to short runs.

For the first pair of each retest workload, every row in all 15 tables matched,
excluding only the snapshot filename. That comparison includes numeric results,
test and parameter flags, test/device identity, metadata, and supersession.
Each file contains 20,000 attempts, of which exactly 10,000 are superseded.
Sampled logical hashes match across all six runs of each workload. The ordinary
control creates no retest indexes and its database size is unchanged. Indexes
add 479,232 bytes for the PartID fixture and 376,832 bytes for coordinates;
peak process working sets remain around 37 MiB. Commands and the paired runner
are in [the benchmark guide](../benchmarks/README.md#recorded-native-retest-comparison).

## Browser experiment

The isolated [browser prototype](../web-prototype/README.md) compiles the
upstream Rust record decoder to WebAssembly and runs it in a Web Worker.
It reads bounded File slices and retains summaries rather than every result.
It establishes local browser parsing feasibility. Its scan timing excludes
durable database writes, indexing, full integrity checks, and analytics; it
must not be compared directly with complete application import timing above.

The actual Codex in-app browser completed a 1M scan in 0.384 seconds and two 10M
scans in **3.587 and 5.986 seconds** on the same files above. These are individual
observations, not medians. WASM parse calls took 2.455 and 2.531 seconds for the
10M scans; most of the wall-time difference occurred outside those calls.
We did not establish its cause. Both sizes reported 5.813 MiB peak WASM linear memory, a separate 4 MiB
JavaScript input slice, a 65,539-byte carry allocation, and 94-byte peak carry
occupancy for these fixtures. Total browser-process memory was not measured.
Counts and semantic fingerprints matched the same-source native engine.
Independent Python decoding also matched the small semantic and STDF.io
fixtures. Browser cancellation and truncated-file error recovery were exercised.

The shipping workbench still uses its local Python/Rust service. A complete
browser product needs persistent columnar or database storage, streaming
queries, migration/recovery, PAT parity, and browser quota management. The
prototype does not yet provide that product. Build and browser verification
instructions are maintained with the experiment.

## Next measured work

Move structural validation into the native scan only after equivalence tests
can replace the current permissive native EOF behavior. This could eliminate
another pass over the input. For the browser, measure parsing plus persistent
storage before selecting a database and making end-to-end speed claims.
