# Prototype validation — 2026-09-24

This is evidence for the isolated record/PTR summary engine. It is not evidence
that database import, PAT, retest consolidation, or the full product works in a
browser.

## Build and correctness

- Rust 1.98.1, `rust-stdf 1.1.0`, `wasm-bindgen 0.2.128`; committed Cargo lockfile.
- Native and `wasm32-unknown-unknown` release builds succeeded.
- Six Rust integration tests passed: every chunk boundary of LE/BE fixtures;
  invalid measurement handling; short/truncated fields; closed-parser
  behavior; maximum record carry; name omission/ambiguity including empty
  identities; result-scale validity/defaults and separate changed-scale groups.
- Node instantiated the generated browser WASM module and compared the complete
  semantic result with both a native build and an independent Python `struct`
  oracle for the small LE/BE fixtures and the external STDF.io evaluation file.
- Both 1M and 10M PTR fixtures matched the native same-source engine using
  65,521-byte and 4 MiB chunks. The independent Python oracle was intentionally
  skipped for these large performance fixtures.

| Input | Bytes | Records | PTR records | Summary groups | Semantic PTR digest |
|---|---:|---:|---:|---:|---|
| Synthetic semantic LE | 415 | 14 | 12 | 4 | `f3aa737156b39e82` |
| Synthetic semantic BE | 415 | 14 | 12 | 4 | `f3aa737156b39e82` |
| External `semidata-evaluation.stdf` | 782,607 | 49,376 | 44,800 | 20 | `8fceda952793195d` |
| `benchmark-10000d-100t.stdf` | 93,650,444 | 1,020,013 | 1,000,000 | 100 | `3f1ca4ca37f2222f` |
| `benchmark-100000d-100t.stdf` | 936,502,821 | 10,200,101 | 10,000,000 | 100 | `a17503a85330872e` |

Small-fixture checks use 1-byte, 7-byte, 64 KiB, and 4 MiB chunk sizes. The STDF.io
file checks use 65,521 bytes and 4 MiB. Chunk boundaries change buffer metrics but
not records, flags, groups, statistics, or the semantic digest. The synthetic
fixture size should be read from the generated file when fixtures evolve.

## Isolated Node/WASM timing

Hardware: AMD Ryzen 7 7700X. OS: Windows 11 Home 10.0.26200. Node: 22.13.0. One
observed run per fixture, with native benchmarks/builds paused. Filesystem cache
was not reset; these are local warm-workflow observations, not cold-cache claims
or statistically characterized latency. WASM initialization is excluded.

| Input | Read + scan + summary | Time in parser push calls | Scan throughput | Peak WASM allocation | Node process peak RSS |
|---|---:|---:|---:|---:|---:|
| 1M PTR / 89.31 MiB | 253.8933 ms | 243.0136 ms | 351.77 MiB/s | 6,094,848 bytes | 81,207,296 bytes |
| 10M PTR / 893.12 MiB | 2,454.1814 ms | 2,402.6300 ms | 363.92 MiB/s | 6,094,848 bytes | 79,601,664 bytes |

Both runs used at most 4,194,304 input bytes per push and a 65,539-byte carry
allocation. Maximum observed carry occupancy was 94 bytes. The constant WASM
allocation across a tenfold measurement increase supports the intended bounded
working-set design for these fixtures (both have 100 groups). It does not imply
constant memory for arbitrarily increasing unique metadata, which is capped
separately at 20,000 groups.

The parity harness runs multiple parsers within the same WASM instance and
observed up to 6,291,456 bytes of linear memory. WASM allocators need not shrink
between scans; the browser UI creates/terminates one worker per file instead.

**Do not compare these numbers directly with SQLite import durations.** This
prototype omits database writes, indices, device/retest tracking, full record
decoding, and persisted analyses. Browser File API/worker results must be measured
separately from this Node harness.

Generated WASM asset for this check: 146,737 bytes; SHA-256
`97049a653dc47a5354d113851c42bbd351c44cf2c0686c3810b0ef206007ede6`.

## Actual browser verification

The parent task uploaded each real local file through the application in the
Codex in-app browser. The STDF.io and 1M files were scanned once; the 10M file
was scanned twice. All observations are retained, with no reported median;
filesystem cache was not controlled. Every browser semantic digest matched
the native/WASM correctness harness. Browser engine/version was not recorded.
Machine and generated WASM asset were the same as above.

| Input | Browser read + scan + summary | Parser push calls | WASM initialization | Peak WASM allocation |
|---|---:|---:|---:|---:|
| STDF.io / 44,800 PTR | 17.4 ms | 13.6 ms | Not recorded | 2,621,440 bytes |
| 1M PTR | 384.4 ms | 261.9 ms | 15.9 ms | 6,094,848 bytes |
| 10M PTR, observation 1 | 3,587.0 ms | 2,454.7 ms | 17.4 ms | 6,094,848 bytes |
| 10M PTR, observation 2 | 5,986.0 ms | 2,530.9 ms | 12.5 ms | 6,094,848 bytes |

The observed 10M browser wall-time range is **3.587–5.986 seconds**, not a median
or stable latency target. Most of the variation lies outside measured parser
push calls (2,454.7–2,530.9 ms). The remaining wall-time interval includes file
reads, scheduling, and summary work; their individual contributions were not
instrumented, so no specific cause is established. The second observation's
summary step was 1.2 ms. Counts, fingerprints, and memory bounds were unchanged.

The 1M/10M runs used 4 MiB input slices, 65,539 bytes of carry allocation, and
at most 94 bytes of carry occupancy. Counts/groups matched the table above.
Browser RSS was not measured. Raw observations are retained in
[validation/browser-results.json](validation/browser-results.json).
The parent also verified the rendered UI, cancelled the 10M scan at 4.5% with
Scan re-enabled and the incomplete report hidden, and selected a 17-byte
truncated file. It produced an explicit error at record offset 6 with 11 pending
bytes. No browser console errors were observed during that walk-through.
