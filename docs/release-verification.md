# Release verification — SemiData Workbench

The current checkpoint is **0.1.1, 2026-09-24**, recorded below with 41
application and 3 benchmark Python tests. The opening sections preserve the
historical 0.1.0 evidence; their outstanding items are updated at that checkpoint.

Evaluation date: 2026-09-23. Base: noonchen/STDF-Viewer commit `b8deaad`.
This record describes a local Windows engineering evaluation, not a production
qualification or performance comparison with other STDF tools.

## Environment and reproducibility

The native extension was built from this checkout on Windows with Python
3.13.12, Rust 1.98.1, VS2019 MSVC 14.29.30133, and Windows SDK 10.0.19041.0.
See [Native runtime build](runtime-build.md) for dependencies, rebuild commands,
and the committed Python dependency lock. No prebuilt parser substitute or mock
parser was used for integration checks. The original Qt viewer also imported
and constructed its main window with the offscreen Qt platform.

## Automated checks

Final local result: **29 Python tests passed**, plus the syntax, compilation,
and whitespace checks below. The complete Python suite took approximately
3.2 seconds on this workstation; this is test-suite duration, not import
throughput.

Run from the repository root:

```powershell
.venv/Scripts/python.exe -m unittest discover -s tests -v
node --check semidata/static/app.js
node --check semidata/static/charts.js
node --check semidata/static/format.js
.venv/Scripts/python.exe -m compileall -q semidata
git diff --check
```

The Python suite exercises actual binary STDF import, copied-source integrity,
SHA256 deduplication, concurrent duplicate import, catalog reopening, compressed
input, truncated records, incomplete DUTs, ZIP member restrictions, expansion
limits, parse failure cleanup, repeated PTR warnings, and schema validation.

Calculation checks cover sample SD, reference methods, exact-bound inclusion,
invalid flags, unknown/failed/abnormal DUTs, invalid populations and multipliers,
nonfinite limits, histogram counts, site filtering, saved evidence persistence,
unchanged source database hashes, and safe CSV text handling. HTTP checks cover
real analysis, static modules and documentation, Host/origin/token rejection,
and path traversal. Parser regression checks preserve every PARM_FLG byte through
both batch and tail writes.

The native crate's existing two tests and formatting checks on the four modified
Rust files passed. All browser modules passed Node syntax checks; the five
frontend assets passed pinned Prettier 3.6.2 formatting checks. Dependency-lock
validation and an offline locked installation dry run passed.

Hosted CI is configured but has not been executed for this local change.
The Windows verification does not establish Linux/macOS application support.

## Browser evaluation

The local browser application was exercised with the source-built parser and
the bundled, deterministic binary STDF fixtures.

| Workflow | Observed result |
| --- | --- |
| Load examples | Three lots, 360 DUT attempts, 1,080 scalar measurements |
| Explore VDD across all lots | 360 valid values, zero excluded |
| Select site 2 | 180 valid values, 60 per lot |
| Compare datasets | Distribution, ordered plot, lot means, and statistics rendered |
| PAT: evaluate DEMO-003 against DEMO-001, MAD, k=3 | 120 reference, 119 eligible evaluation, one excluded, 32 flagged |
| Save and restart | Library and saved recipe/result reopened without reimport |
| Export saved result over HTTP | 32 CSV data rows, matching run ID and attachment header |
| Invalid import path | Actionable error; existing datasets retained |
| Documentation | Full guide, tables, internal links, and code examples rendered |
| ES module refactor | Application, charts, and saved results loaded without browser console errors |

The PAT checkpoint bounds are approximately **0.9633303657 V** and
**1.0386034474 V**. The guide specifies the complete recipe and expected
injected outliers. The examples prove repeatable behavior for these cases;
they are too small to support a throughput claim.

## Review corrections

Independent review led to retaining PTR parameter flags in the Rust database,
rejecting invalid parameter results from calculations, withholding capability
for ambiguous limits, normalizing nonfinite limits to JSON null, bounding test
numbers and multipliers before numeric conversion, and excluding abnormal DUTs
from known-pass counts. The UI also invalidates stale previews and prevents
editable recipes from drifting during a save. Saved experiment evidence remains
independent of subsequent population selections.

## Outstanding at the 0.1.0 checkpoint

The [STDF.io generator](https://stdf.io/generate) recipe in the engineer guide
was configured and its preview inspected. Browser automation could not complete
the Save download. Consequently, no STDF.io-generated file has yet passed an
end-to-end import here. This is an explicit remaining compatibility check;
the bundled fixtures do not replace independent-generator validation.

Other limits remain: scalar PTR analysis only in the new UI; single-pass
experimental PAT; no cross-file retest reconciliation; no production
qualification; and no representative large-file speed or memory benchmark.
Big-endian preflight support has not been exercised by a big-endian fixture in
this suite. See [Calculation reference](methods.md) and
[Architecture](architecture.md) before extending the supported workflows.

## 0.1.1 verification — 2026-09-24

This later checkpoint resolves the STDF.io import and synthetic performance
checks left open above. It does not imply representative production coverage
or hosted CI execution.

- **41 application Python tests passed**, including the actual rebuilt native
  extension, plus **3 benchmark-tool tests**.
- **3 native Rust tests** and **6 browser-parser Rust tests** passed.
- JavaScript syntax, Python compilation, changed-native-file Rust formatting,
  prototype formatting, and Git whitespace checks passed.
- Browser-parser native/WASM parity passed on 1M and 10M inputs at different
  chunk sizes. Independent Python decoding matched little/big-endian semantic
  fixtures and the STDF.io source. Actual browser scans, cancellation, truncated
  input errors, and workbench Explore/PAT were exercised without console errors.
- Independent review found and resolved misleading compression-suffix handling,
  omitted-name ambiguity involving empty identities, and accidental inheritance
  from FTR/MPR rather than preceding PTR records.

The final native extension SHA-256 is
`aa786a2ae035b64d3f374267ccff5fa7e589095626474670a9a64346281f5ee2`.
It was built from this checkout. Windows denied deletion of the existing
package metadata during normal replacement; the locally built wheel was
installed by verified in-place file writes. Installed files matched every
wheel RECORD hash, including the extension. No ACL changes were made.

The available external-generator file `semidata-evaluation.stdf` is 782,607
bytes, with SHA-256
`792afbf3596d3b4b19fb861131310f42b9b712d6c039d359594cee3e2df7aa01`.
It imported as lot SEMIDATA-EVAL-001, product STDF-GEN-DEVICE, 2,240 DUTs,
20 tests, 44,800 PTR measurements, and 1,691 passing DUTs, with no import
warnings. Each test retains its name, unit, limits, and 2,240 rows. Test 1000
Explore and the self-reference MAD k=3 preview matched the guide's 2,240 valid,
1,691 eligible, 549 excluded, and 7 flagged checkpoints in the browser.
See [external compatibility evidence](../benchmarks/results/stdfio-compatibility.json).

The original native application import benchmark and final combined build used
the same hashed 1M/10M fixtures. Counts, database sizes, and sampled logical
data matched. Final medians were 2.279 and 20.968 seconds respectively; this
demonstrates a modest large-input improvement and no small-input speed win.
Separate native retest experiments demonstrated approximately 31×/29× faster
native phases with exhaustive row equality for the small retest workloads.
[Performance methodology](import-performance.md) distinguishes those workloads,
the Python-only comparison, and the much smaller browser-summary workload.

The browser proof is a genuine Rust/WASM worker using local File slices.
Its two actual 10M summary scans took 3.587 and 5.986 seconds, with approximately
5.81 MiB WASM linear memory plus the input slice. These observations exclude
persistent storage and PAT; total browser RSS was not measured. The full
[prototype validation record](../web-prototype/VALIDATION.md) gives boundaries.

Hosted CI now includes benchmark tools and browser-parser Rust checks, but has
not run for this local branch. Application caps remain 2 GiB per input/expanded
stream and 500,000 selected analysis rows. Big-endian framing and prototype
decoding are tested; broad native ATE-vendor and MPR/FTR analytics qualification
remain outside this release.
