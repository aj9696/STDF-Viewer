# Browser STDF and storage prototypes

This isolated experiment runs the upstream Rust STDF record parser as WebAssembly
in a dedicated browser worker. It evaluates bounded ingestion before a browser
product architecture is selected. The existing SemiData application is unchanged.

The contract and acceptance criteria are in [SPEC.md](SPEC.md).
The [next data-logistics proposal](../docs/browser-data-workflow.md) covers
SQLite persistence, reopen/recovery, export and folder batches. The parser still
performs summary scans only. The separate BL-1 storage proof below saves one
synthetic note; it does not yet persist parsed STDF records.

## Run the storage proof

From the repository root, with Node.js 22 or later:

```powershell
npm.cmd --prefix web-prototype ci --ignore-scripts
npm.cmd --prefix web-prototype run build:storage
.venv/Scripts/python.exe -m http.server 8766 --bind 127.0.0.1 --directory web-prototype/site
```

If the lab server already runs on 8766, keep it running. Open
[the storage proof](http://127.0.0.1:8766/storage.html), select **Open storage**,
save a recognizable note, then close and reopen storage. Reloading the page or
restarting the browser should recover the note at the same address/profile.
Export a saved note, change it, then restore the downloaded `.sqlite3` file.
Restore replaces only the synthetic note. Empty probes cannot be exported.

The proof owns a separate OPFS directory and Web Lock. A second tab reports
that storage is busy. Missing storage support fails explicitly; there is no
temporary fallback. Clearing site data can remove the note. The page reports
the browser's actual persistence grant and estimated usage/quota; neither is
a backup. Private sessions are not supported as durable storage.

SQLite `3.53.4-build1` is pinned by the npm lockfile, copied into `site/sqlite/`,
and served locally. There is no CDN or data API. The generated manifest records
asset hashes; the build includes [dependency notices](THIRD-PARTY-NOTICES.txt).
The small download path deliberately caps backups at 1 MiB. The independent
integration test proves a page-at-a-time path for later larger exports.

```powershell
npm.cmd --prefix web-prototype run test:storage
# Or one installed desktop browser:
npm.cmd --prefix web-prototype run test:storage -- chrome
npm.cmd --prefix web-prototype run test:storage -- msedge
```

The harness uses pinned `playwright-core` with installed Chrome/Edge, its own
loopback server, and disposable test profiles under `web-prototype/results/`.
It restarts only those test browser processes, never the engineer's profile.
No browser download is automatic. Raw results and small SQLite backups remain
beside those profiles; they are ignored by Git. See
[STORAGE-VALIDATION.md](STORAGE-VALIDATION.md) for results and untested cases.

## Run the experiment

From the repository root in PowerShell, using the repository's local Rust setup:

```powershell
./web-prototype/build.ps1
.venv/Scripts/python.exe -m http.server 8766 --bind 127.0.0.1 --directory web-prototype/site
```

Open [the browser lab](http://127.0.0.1:8766), select a raw `.stdf` file, then
choose **Scan file**. The file stays on the local machine. **Cancel** terminates
the worker immediately; no partial results are saved. **Export summary JSON**
retains all aggregate groups and the timing/provenance report. The table shows
the first 200 groups. Each subsequent scan starts a fresh worker.

`build.ps1` uses `.venv/runtime-environment.ps1`, installs the WASM standard library
into that local Rust environment, and downloads the official pinned wasm-bindgen
0.2.128 Windows CLI with its recorded SHA-256. It builds assets into `site/pkg/`
and a native comparison executable into `.venv/toolchain/web-target/release/`.
No Python packages or global toolchains are modified. Generated parser assets
are ignored by Git and rebuilt from the committed Cargo lockfile. The parser
has no npm runtime dependency, bundler, CDN, or backend API; the separate storage
proof uses the locally copied SQLite assets.

## What the numbers mean

The summary counts every completely framed record by type/subtype. Only PTR
measurement fields are decoded; other record contents are not fully validated.
For PTR records, it retains a count of each exact TEST_FLG/PARM_FLG byte pair.
Numeric statistics exclude nonfinite results, TEST_FLG bits 0–5, and PARM_FLG bits
0–2. Valid failed tests and unknown pass/fail states remain in the population.
There is no PRR-based device eligibility or retest consolidation in this proof.

Measurements are grouped by number, effective name, base unit, and effective
result-scale exponent. Statistics use raw base-unit values, with sample SD
computed incrementally using Welford's algorithm. The scaled mean is the raw mean
multiplied by `10^RES_SCAL`; its displayed unit is written as `10^-RES_SCAL unit`
instead of guessing or duplicating an SI prefix. Omitted/empty unit strings and
invalid/omitted scales use defaults from the first PTR for the test number.
Explicitly changed metadata produces a separate group. No capability or PAT
decision is calculated.

A producer compatibility rule handles records ending immediately after RESULT:
their missing test name uses the sole preceding PTR identity for that number.
Multiple preceding PTR identities, including empty names, cause an explicit
ambiguity error. An explicitly present zero-length name remains its own identity;
no preceding PTR identity means unknown identity. Non-PTR record identities do
not participate. This label policy is separate from STDF's optional-field
defaults, which begin after OPT_FLAG.

## Why memory does not grow with the measurement count

The worker awaits one `File.slice()` read at a time, using at most 4 MiB per read.
wasm-bindgen copies that input slice into WASM for one `push` call. Complete
records borrow that slice directly; only an incomplete record is copied into a
fixed 65,539-byte carry allocation (maximum U2 payload plus header). Neither JS
nor Rust stores a per-record or per-device object list.

State does grow with metadata diversity: summaries are capped at 20,000 groups,
flag counts at 65,536 possible byte combinations, and record-type counts at
65,536 possible pairs. Exceeding the summary cap fails explicitly. Final JSON
and its JS representation add bounded aggregate-output memory. Old input slices
become eligible for garbage collection, whose timing belongs to the browser.

**Peak WASM memory** is the observed WASM linear-memory allocation, not total
browser memory or operating-system RSS. It excludes at least the live JS input
slice and browser/runtime overhead. Worker termination releases its runtime.
This design bounds live parser state independently of file length; measured RSS
and throughput still depend on file composition, browser, machine, and GC.

## Validation commands

```powershell
. .venv/runtime-environment.ps1
$env:CARGO_TARGET_DIR = Join-Path (Get-Location) '.venv/toolchain/web-target'
cargo test --locked --manifest-path web-prototype/rust/Cargo.toml
.venv/Scripts/python.exe web-prototype/scripts/make-fixtures.py .venv/web-fixtures
node web-prototype/scripts/check.mjs .venv/web-fixtures/semantic-little.stdf
node web-prototype/scripts/check.mjs .venv/web-fixtures/semantic-big.stdf
node web-prototype/scripts/check.mjs ../semidata-evaluation.stdf
```

The Node harness instantiates the same browser WASM asset. It compares its result
with a native build of the same Rust source at multiple chunk sizes, and with an
independent streaming Python `struct` reference. The reference is for small
correctness fixtures, not speed tests. Use `--skip-python` for large parity runs.
The FNV-1a 64-bit PTR fingerprint hashes canonical little-endian test number,
head/site/flags, raw IEEE result bits, length-prefixed UTF-8 effective name and
unit, then the signed scale byte in source order. It checks semantics and chunk
invariance, not cryptographic source identity.

For an isolated, explicitly summary-only Node/WASM measurement:

```powershell
node web-prototype/scripts/bench.mjs .venv/bench-data/benchmark-10000d-100t.stdf
```

The harness reports read-plus-scan wall time, time spent in `push`, WASM memory,
Node peak RSS, chunk/carry bounds, record counts, and the digest. Run timing tests
without simultaneous builds or native import benchmarks. **These timings are
not comparable to full database import timings:** this proof does no database
writes, indexes, retest resolution, persisted history, or full-record decoding.

## Boundaries and next decisions

- Raw IEEE STDF v4 only; no gzip/ZIP/bzip2, VAX floats, or browser persistence.
- Structural validation covers record framing and present PTR fields. It is not
  a complete STDF conformance checker; missing MRR is reported separately.
- No database, PAT, charting, or replacement for the existing application.
- Native/WASM same-source parity alone cannot validate the underlying algorithm;
  the independent reference and known-result fixtures address that limitation.
- A production browser product would still need indexed/columnar persistence,
  queries, test metadata policy, retest semantics, compressed input, browser
  storage quota handling, and a larger real-world correctness corpus.

## Observed browser results

Actual local-file uploads were verified in the Codex in-app browser on the
development machine (Ryzen 7 7700X / Windows 11). The STDF.io and 1M files were
observed once; the 10M file was observed twice. Filesystem cache was uncontrolled;
these observations and ranges are not medians or hardware-independent targets.

| File | PTR measurements | Browser read + summary scan | Peak WASM allocation |
|---|---:|---:|---:|
| STDF.io evaluation | 44,800 | 17.4 ms | 2.50 MiB |
| Synthetic 93.65 MB | 1,000,000 | 384.4 ms | 5.81 MiB |
| Synthetic 936.50 MB | 10,000,000 | 3.587–5.986 s (2 observations) | 5.81 MiB |

These scans perform no database writes or device/retest tracking. WASM memory is
not browser RSS and excludes the input slice/runtime overhead. Every browser
result matched the native/WASM semantic digest. See [VALIDATION.md](VALIDATION.md)
for fixture identities, independent-reference checks, exact timing scopes, Node
results, and the machine-readable browser observations.

Most 10M wall-time variation was outside parser push calls, which took
2.455–2.531 seconds. The remaining interval includes file reads, scheduling, and
summary work; the individual cause of variation was not measured.

Authoritative references:
- [rust-stdf borrowed record views](https://docs.rs/rust-stdf/latest/rust_stdf/struct.RawDataElementView.html)
- [wasm-bindgen without a bundler](https://wasm-bindgen.github.io/wasm-bindgen/examples/without-a-bundler.html)
- [wasm-bindgen 0.2.128 release](https://github.com/wasm-bindgen/wasm-bindgen/releases/tag/0.2.128)
- [Teradyne STDF v4 specification, archived copy](https://storage.googleapis.com/google-code-archive-downloads/v2/code.google.com/stdf-eclipse/Stdf-V4-spec.pdf)

The framing adapter is project code. Record decoding uses the published
`rust-stdf 1.1.0` crate (MIT); this derivative prototype follows this repository's
GPL-3.0 license. Keep dependency notices with any distributed build.
