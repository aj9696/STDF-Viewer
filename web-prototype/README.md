# Browser STDF viewer and local library

The browser foundation imports raw STDF into local SQLite databases, retains
exact source snapshots, reopens saved records, and exports/restores portable
packages. A Rust/WASM decoder and SQLite run in a dedicated worker. Source files
are read-only; no test-data upload or backend data service is involved. This
remains an engineering evaluation build, separate from the existing native
SemiData application. The Data viewer adds the working investigation workflows
of the upstream desktop viewer through disposable local analysis indexes.
The engineering Tools menu adds distributions/correlations, PAT and per-lot
recipes, spatial screening, PVT, Gauge R&R, 3D wafer studies, typed source
revisions and document reports. See the [tools guide](docs/TOOLS.md) and
[manual coverage](../docs/dlog-coverage.md) for exact scope and remaining gaps.

| Page | Purpose | What it retains |
| --- | --- | --- |
| [Data library](http://127.0.0.1:8766/app.html) | Import raw/compressed files or folders, search saved datasets and reopen metadata | The same retained library as the engineering console |
| [Data viewer](http://127.0.0.1:8766/viewer.html) | Compare PTR/MPR/FTR; devices, statistics, trends, histograms, bins, wafers, records, Excel and workspaces | Rebuildable per-source analysis indexes; settings and workspace state |
| Test Explorer, opened from a dataset overview | Search PTR tests, inspect recorded declarations and page observations | Reads the saved dataset without reparsing or changing it |
| [Library engineering console](http://127.0.0.1:8766/foundation.html) | Evaluate imports, folders, recovery, saved rows, and portability | Source snapshots, per-source databases, catalog and job history |
| [Summary parser lab](http://127.0.0.1:8766/) | Measure a streaming summary scan | In-memory summaries; optional JSON download |
| [Synthetic storage proof](http://127.0.0.1:8766/storage.html) | Reproduce the original SQLite persistence experiment | One note in an independent SQLite pool |

Start with Data library, import data and choose **Open data viewer** in a dataset
overview. The [viewer guide](docs/VIEWER-UI.md) covers the investigation workflow;
[calculation rules](docs/VIEWER-METHODS.md), [qualification and performance](docs/VIEWER-VALIDATION.md),
and [upstream parity](../docs/viewer-parity.md) define its boundaries.
The [Test Explorer guide](docs/TEST-EXPLORER.md)
explains recorded fields and paging. Use the [frontend handoff](docs/FRONTEND-HANDOFF.md) for the console
workflow and feature boundaries. The [frontend API](docs/FRONTEND-CONTRACT.md)
and [source/queue API](docs/SOURCES.md) define the integration surfaces. The
[library validation record](LIBRARY-VALIDATION.md) distinguishes tested behavior
from remaining qualifications. The original summary experiment has its own
[specification](SPEC.md) and [validation record](VALIDATION.md).

## Run the library foundation

For a public static release, follow the [Cloudflare Pages deployment guide](docs/DEPLOYMENT.md).

From the repository root, with Node.js 22 or later and the repository's local
Python/Rust environment available:

```powershell
npm.cmd --prefix web-prototype ci --ignore-scripts
npm.cmd --prefix web-prototype run build:storage
npm.cmd --prefix web-prototype run build:vendor
./web-prototype/build.ps1
.venv/Scripts/python.exe -m http.server 8766 --bind 127.0.0.1 --directory web-prototype/site
```

If port 8766 already serves this directory, keep that server running. Open
[Data library](http://127.0.0.1:8766/app.html).
Use this HTTP address instead of opening `site/app.html` or `site/explore.html`
directly from File Explorer. A `file://` launch cannot load the application's
module graph or provide its normal storage origin. All product pages show
launch guidance for this case before creating any library worker. Select a
dataset in Data library and choose **Open data viewer**; its URL includes the saved
dataset ID. Chrome, Edge and Codex each have separate browser-profile libraries.

For folder queues, raw row inspection, recovery and package transfer, open
[foundation.html](http://127.0.0.1:8766/foundation.html), select **Open library**,
choose raw files or a source folder, review the inventory, then choose **Import
reviewed files**. Close/reopen the library or browser at the same origin/profile
to inspect retained records without selecting the originals again.

The retained library normalizes PTR measurements and preserves repeated observations,
flags, result bits, device attempts, declarations, record order, and source byte
offsets. MPR/FTR and other unnormalized families remain accessible through raw
record indexes and the original bytes. The viewer separately normalizes
PTR/MPR/FTR with effective defaults, explicit retest rules and flag eligibility.
Its first visit builds a SQLite analysis index; later visits reuse it. Retained
coverage and viewer coverage are deliberately distinct. PAT recipes, historical
monitoring and production rebinning remain future browser capabilities.

Save a complete selection with **Save workspace** (`.sdworkspace`) and restore
with **Open workspace**, including into an empty library. Native desktop `.db`
sessions are not compatible. Session packages carry original data and settings;
derived indexes are rebuilt after restore. Use **Generated files** to recover
or remove temporary report/session files after a reload. Confirm downloads are
complete before removing their temporary copies. See [transfer contracts](docs/VIEWER-TRANSFER.md).

The database creates test/device indexes before inserting rows and maintains
them within bounded write transactions. This avoids a later whole-dataset index
sort. Import `writeMs` therefore includes index maintenance; `validationMs`
measures manifest/data checks, not a post-import index build. End-to-end
`totalMs` includes additional setup, final commit and publication work. See the
[API's metrics definitions](docs/FRONTEND-CONTRACT.md#storage-schema-and-memory)
when interpreting measurements.

Use **Export dataset package**, save the resulting `.sdlibrary` download, and
confirm it finished before **Release listed completed downloads**. Restore
checks package hashes and the staged database, including duplicate packages;
it does not overwrite an existing completed dataset. Package downloads stay
disk-backed. Temporary exports, including interrupted ones, remain discoverable
for explicit cleanup. See the [handoff](docs/FRONTEND-HANDOFF.md) for recovery.

SQLite storage belongs to the exact origin and browser profile, independently
of the source folder. Changing the port or browser profile opens another library.
Persistence requests are not backups or reserved disk space. Closing a page
terminates its worker; unfinished work must be inspected after reopening.
No service worker or offline-startup guarantee is provided.

### Foundation verification

```powershell
. .venv/runtime-environment.ps1
cargo test --locked --manifest-path web-prototype/rust/Cargo.toml
.venv/Scripts/python.exe web-prototype/scripts/make-library-fixtures.py
node web-prototype/scripts/retained-check.mjs .venv/library-fixtures/golden-little.stdf
node web-prototype/scripts/retained-check.mjs .venv/library-fixtures/golden-big.stdf
node web-prototype/scripts/sources-check.mjs
node web-prototype/scripts/source-browser-check.mjs chrome
node web-prototype/scripts/source-browser-check.mjs msedge
node web-prototype/scripts/transfer-check.mjs
node web-prototype/scripts/library-check.mjs chrome
node web-prototype/scripts/library-check.mjs msedge
```

The retained-parser checks require the built `site/pkg/` assets. Browser checks
use installed Chrome/Edge, a temporary loopback server, and disposable profiles
under ignored `web-prototype/results/`; no browser is downloaded automatically.
The browser harness also requires the external evaluation fixture at
`../semidata-evaluation.stdf` relative to the repository, with SHA-256
`792afbf3596d3b4b19fb861131310f42b9b712d6c039d359594cee3e2df7aa01`.
That file is not committed or downloaded by these commands. The generated
little/big-endian fixtures and source/transfer checks do not require it.
`source-browser-check.mjs` uses the small generated golden fixture, real OPFS
directory handles/IndexedDB, a full browser restart, and the actual folder-input
fallback in the console. It does not drive or qualify native OS picker prompts.

For the recovery harness, also generate its 1M-measurement input:

```powershell
.venv/Scripts/python.exe -m benchmarks.generate --duts 10000 --tests 100
node web-prototype/scripts/library-recovery-check.mjs chrome
node web-prototype/scripts/library-recovery-check.mjs msedge
```

Fault injection is confined to the harness's disposable profile. See
[LIBRARY-VALIDATION.md](LIBRARY-VALIDATION.md) for evidence, exact test scope, and
remaining browser/volume limits. Summary scan timings below are not import or
portability measurements.

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

## Run the summary parser experiment

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
proof and persistent library use the locally copied SQLite assets.

## What the summary numbers mean

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

## Why summary-parser state does not grow with measurement count

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

## Summary-parser validation commands

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

## Summary-lab boundaries

These boundaries apply to the summary page, not the separate persistent library
at `foundation.html`:

- Raw IEEE STDF v4 only; no gzip/ZIP/bzip2, VAX floats, or browser persistence.
- Structural validation covers record framing and present PTR fields. It is not
  a complete STDF conformance checker; missing MRR is reported separately.
- No database, PAT, charting, or replacement for the existing application.
- Native/WASM same-source parity alone cannot validate the underlying algorithm;
  the independent reference and known-result fixtures address that limitation.
- Production analytical features still need a separately designed test-metadata
  policy, retest semantics, compressed input support, and a larger real-world
  correctness corpus. The library API supplies retained evidence, not these
  decisions.

## Historical summary-scan observations

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
