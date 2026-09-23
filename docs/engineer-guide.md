# SemiData engineer evaluation guide

Applies to SemiData Workbench 0.1.0. Start with the reproducible examples below,
then repeat the workflows with STDF.io-generated files. This release connects
a persistent data library, measurement investigation, lot/site comparison, and
traceable PAT experiments. It is an engineering evaluation build.

See [Installation](installation.md) to launch the application and
[Calculation methods](methods.md) for population and statistical definitions.

## 1. Build a small, repeatable library

1. Start `Start-SemiData.cmd` from the repository folder. Keep its terminal open.
2. In **Data library**, select **Load example data**. Wait for import completion.
3. Confirm that the table contains lots **DEMO-001**, **DEMO-002**, and
   **DEMO-003**, all for product **SD-DEMO-1**.
4. Each dataset should contain **120 DUTs, three tests, and 360 scalar
   measurements**. Known-passing DUT counts are 120, 119, and 119 respectively.
5. Select **Load example data** again. The library should still contain three
   example datasets: identical original bytes are detected automatically.

Each fixture has two sites and tests **1001 VDD (V)**, **1002 IDD (mA)**, and
**1003 Frequency (MHz)**. DEMO-001 is the reference population. Later lots
introduce a VDD shift; DEMO-003 also has a site offset and isolated outliers.
These small, deliberately constructed files establish repeatable checkpoints.
They do not establish real-world parser coverage or a speed benchmark.

An import retains the original source bytes and a parsed database in the
workspace. You can move the external input file after a successful import.
Exact-byte deduplication is independent of the filename. Different compressed
encodings of the same logical records are separate datasets, so avoid selecting
multiple encodings as independent populations.

## 2. Investigate a measurement and compare lots

1. Select the three demo datasets in **Data library**, then choose
   **Explore selected**.
2. Set **Measurement** to **1001 VDD**, **Site** to **All sites**, and
   **Test attempts** to **Current within each file**.
3. Review the summary, distribution, ordered measurements, and lot comparison.
   Use **Refresh analysis** if needed after changing the population.
4. Confirm **360 selected measurements, 360 valid, and zero excluded**.
   Each lot contributes 120 VDD measurements. The library holds 1,080 PTR
   measurements across all three tests; this analysis selects VDD only.
5. Compare the lot means and distributions. The later lots should shift upward.
   DEMO-003 includes VDD values around 1.11 V and above, within the original
   0.85–1.15 V specification but distinct from the reference population.
6. Set **Site** to **2**. The selected population becomes **180** measurements,
   60 per lot. Compare its behavior with site 1, then restore **All sites**.
7. Try IDD and Frequency to see how the same population supports a different
   engineering question.

The ordered plot follows dataset selection and device order; its horizontal
axis is not elapsed test time. Charts can display a subset of points, but
summary statistics and histogram counts use the full valid selected population.

Explore includes valid measurements from both passing and failing devices.
Missing, nonfinite, or invalid/unreliable results are excluded. A displayed Cpk
is a descriptive calculation against compatible, fixed source limits. Mixed
or dynamic limits withhold Cpk; the calculation does not establish process
stability or production acceptance.

## 3. Evaluate a PAT recipe against a separate reference

1. Return to **Data library**, select **Clear**, and select **DEMO-003** only.
   This is the population to evaluate.
2. Open **PAT lab**. Confirm **1001 VDD**, **All sites**, and
   **Current within each file** in the shared population controls.
3. Enter experiment name **Demo 003 VDD versus baseline — MAD 3**.
4. Set **Limit method** to **Median ± k × scaled MAD** and **Multiplier k** to
   **3**.
5. In **Reference datasets**, select **DEMO-001** only. On Windows, Ctrl-click
   changes individual selections. The selected test, site, and attempt policy
   apply to both reference and evaluation datasets.
6. Select **Preview screening**. Review the counts, limits, flagged rows, and
   source provenance before saving.

For the unchanged bundled fixtures and this exact recipe, the checkpoint is:

| Result | Expected value |
| --- | --- |
| Eligible reference measurements | 120 |
| Eligible evaluation measurements | 119 |
| Excluded evaluation measurements | 1 |
| Flagged measurements | 32 |
| Lower screening limit | Approximately 0.963330 V |
| Upper screening limit | Approximately 1.038603 V |

The flagged rows include **D0018**, **D0062**, and **D0104**. Other flagged
devices reflect the intentional lot and site shifts. The excluded device
**D0120** fails Frequency; its valid VDD value appears in Explore but its DUT is
not eligible for this PAT experiment. This distinction is why the analysis
count and PAT denominator differ.

These limits use the reference median plus or minus three times its scaled
median absolute deviation, with scale factor 1.4826. A value exactly on a
screening limit is retained. At least 30 eligible reference measurements and
nonzero spread are required. The accepted multiplier range is 0.5–10.

To compare methods, change the recipe to **Mean ± k × sample SD**, preview it,
and examine the effect before deciding which result to save. Changing the
reference to the evaluated population answers a different question: the
baseline then includes that population's shifts. An empty reference selection
means “use the selected evaluation population.”

## 4. Save, export, and reopen the evidence

1. Restore the MAD recipe above and preview it.
2. Select **Save experiment**. Saving recalculates the recipe and stores a new
   immutable result with its recipe, software version, source metadata and
   hashes, limits, and complete flagged population.
3. Select **Download flags CSV** from the saved result. Confirm that the CSV
   contains 32 data rows for the unchanged checkpoint. It includes device and
   dataset identity, site/head, wafer index and coordinates when available,
   value, units, recipe parameters, and calculated limits.
4. Open **Saved runs**, select the experiment, and review it again.
5. Wait until work is idle, press **Ctrl+C** in the application terminal, and
   restart `Start-SemiData.cmd`. The datasets and saved experiment should remain.
   Reopening the workspace does not reparse its imported source files.

Each save creates a separate experiment; saves are not deduplicated. Saved
results do not change production bins, source limits, raw measurements, or
earlier experiments. The interface displays at most 1,000 flagged rows; the
saved CSV includes every flagged row.

## 5. Evaluate data from STDF.io

Open the [STDF.io generator](https://stdf.io/generate) in your browser. Use this
recipe to reproduce the initial external-generator evaluation configuration:

| Generator setting | Value |
| --- | --- |
| Lot identifier | SEMIDATA-EVAL-001 |
| Product | STDF-GEN-DEVICE, the observed default |
| Wafers | 5 |
| Wafer grid | 24 × 24 |
| Sites | 4 |
| Baseline yield | 94% |
| Random seed | 42 |
| Tests per die | 20 |
| Hotspot and scratch | Clamp patterns to wafer 5 |
| Edge pattern | Wafers 1–5, 25% |
| Lot drift | Wafers 1–5, 10%, ramp 30% |

The generator preview observed during setup reported **2,240 dies** and
**75.5% yield**. The patterned output's overall yield differs from the 94%
baseline setting. Treat the preview as a comparison checkpoint, not a
guaranteed invariant across future versions of the external generator.

The browser automation could configure and inspect this recipe but could not
complete its **Save** download. Consequently, that file has **not yet been
imported or verified by SemiData**. Complete that evaluation as follows:

1. Generate the configured data and use the generator's save/download control
   to save an STDF file locally.
2. In Windows File Explorer, use **Copy as path** on the saved file.
3. Paste the full path into SemiData's **Local file paths** field and select
   **Import files**. Quoted Windows paths are accepted. For multiple files,
   paste one full path per line; the interface imports them sequentially.
4. Confirm the lot/product, DUT count, test count, and any import warnings.
   Compare the imported count with the generator's preview and record any
   disagreement. Do not assume mismatched denominators are equivalent.
5. Select the dataset, open **Explore**, and choose a scalar measurement.
   Compare its distribution across sites 1–4.
6. Preview a PAT experiment. With no separate reference selected, the file's
   eligible population supplies its own reference. Save and export the result.
7. To investigate a historical shift, generate a second file with a different
   lot identifier and a deliberately changed parameter, import it, and compare
   the same test identity and units. Keep a written record of both recipes.

This release does not render wafer maps or model those spatial patterns
directly. Imported spatial information can appear in flagged-device evidence;
measurement and site comparisons are the currently available investigation
tools.

## Evaluation checklist

- Library persists across application restarts and duplicate imports are clear.
- Source metadata, test names, units, and counts match the expected input.
- Changing lot, test, site, or attempt selection updates the shown population.
- Reference and evaluation populations are understandable and reproducible.
- PAT flags include the injected outliers, with the expected denominator.
- Saved results and CSV agree, and identify their source data and recipe.
- Errors identify a useful next step for incomplete, unsupported, or inaccessible
  input files.
- Record import and interaction times for your data size. The displayed parser
  duration excludes source copying and preflight validation.

## Release boundaries

Analysis currently covers scalar PTR measurements. The parser database retains
other supported STDF data, including MPR/FTR records and raw PTR test/parameter
flags, but MPR/FTR analysis, correlation, wafer maps, automated monitoring,
and production disposition are future capabilities.

“Current” excludes attempts marked superseded by the upstream parser within
each source file. Device identities are not consolidated across files. Repeated
PTR records for one device/test inherit the upstream parser's last-result
behavior; the source snapshot remains available and an import warning identifies
this case.

PAT implements one pass of mean/SD or median/MAD population screening. It is
not qualified iterative DPAT, wafer-adaptive screening, or AEC certification.
Its current eligibility rule requires a valid finite PTR measurement and a
known-passing test and DUT.

Imports accept complete STDF V4 IEEE big/little-endian streams, with raw, gzip,
bzip2, or single-file ZIP input. Both input and uncompressed STDF are limited
to 2 GiB. The library/history lists show the most recent 200 items. Analysis
accepts at most 20 datasets and 500,000 selected measurement rows; ordered
plots show at most 800 points.

## Feedback template

Copy this into an issue or your evaluation notes. A minimal synthetic file is
usually the easiest way to reproduce an engineering problem.

```text
SemiData version:
Operating system:
Workflow: Data library / Explore / PAT lab / Saved runs
Input: generator recipe or file description, byte size, source hash
Selected datasets, test number/name/unit, site, attempt policy:
PAT reference datasets, method, k, saved run ID if relevant:
Steps to reproduce:
Expected result and how it was established:
Actual result, including counts and exact error text:
Elapsed time / input size for a performance concern:
Screenshot or exported evidence:
Engineering task this prevented or made difficult:
```
