# Small example datasets

Five synthetic STDF files cover common investigation tasks. They contain no customer data and total about 33 KB. Use **Try example data** in the library, or import the files from [`site/examples`](../site/examples/).

| Example | Size of population | What to try | Expected result |
| --- | --- | --- | --- |
| Clean lot | 48 devices, 2 sites, 3 tests | Open the Active current histogram | All pass; mean 18 mA. |
| Site shift | Two files, 48 devices each | Compare Active current by site | The second file's site 2 shifts from 18 to 24 mA; 12 of its 24 devices fail the 24 mA limit. Site 1 stays at 18 mA. |
| Fail to pass | 24 parts, 30 attempts, 3 tests | Switch current/all attempts | D001–D006 fail initially and pass on retest. Current: 24 pass. All: 24 pass and 6 fail. |
| Wafer edge failures | 49 dies, 2 tests | Open the wafer map; pick an edge die | 20 fail leakage where `x² + y² ≥ 10`; 29 pass. Coordinates span −3 through 3. |
| Pins and digital tests | 24 devices, 3 tests, 5 catalogue rows | Inspect pin channels and device rows | 17 pass, 4 fail, 3 unknown. Missing readings remain blank; invalid readings are excluded from numeric statistics. |

The comparison reuses `baseline.stdf`. Importing it again does not duplicate it. Keep the clean and shifted files in **separate comparison groups**. These are crafted teaching populations, not process capability studies or performance benchmarks.

## Mixed-test details

- **Standby leakage (PTR 1003):** D004, D008 and D012 have no record. D006 has a flagged invalid value; D010 contains NaN. Numeric statistics use 19 of 21 recorded readings.
- **Diode drop (MPR 2001):** GPIO0, GPIO1 and GPIO2 each have 24 readings. GPIO1 is above its limit on D005 and D013. The MPR's shared failure flag applies to all three channels of those two records; a channel's failure count is not an inferred per-pin limit decision.
- **Scan chain (FTR 3001):** D007 and D019 fail; D020 is marked not executed. Functional results represent recorded status, not an electrical measurement.
- The three unknown device outcomes are D006, D010 and D020. Their PRR records explicitly mark pass/fail as unknown.

## Regenerate and verify

From the repository root, using Python 3 and Node with the existing browser-test dependencies:

```powershell
.venv/Scripts/python.exe web-prototype/scripts/make-examples.py
.venv/Scripts/python.exe web-prototype/scripts/make-examples.py --check
node web-prototype/scripts/examples-check.mjs chrome
node web-prototype/scripts/examples-check.mjs msedge
node web-prototype/scripts/examples-ui-check.mjs chrome
node web-prototype/scripts/examples-ui-check.mjs msedge
```

The generator uses Python's standard library and fixed values/timestamps. It writes only the five named STDF files and `manifest.json`. `--check` verifies byte-for-byte reproducibility without writing anything. No parser code contributes to the expected values.

The browser check creates an isolated library, imports the actual files through the production parser, checks the original SHA-256 hashes, and queries the production viewer. It verifies site separation, comparison groups, explicit retest identity, every wafer coordinate, missing/invalid observations, pin labels, digital flags, duplicate handling and cache reuse. Results are written under ignored `web-prototype/results/examples-<browser>-<timestamp>/`.

The UI check exercises the real picker, direct downloads, list-load dismissal, failed downloads, hash mismatches and retry. It opens every example with its intended test/view, verifies separate site-comparison groups, checks duplicate reuse, and captures desktop/360 px screenshots. Both checks pass in Chrome and Edge; the portable run record is [`evidence/examples.json`](../evidence/examples.json).

[`manifest.json`](../site/examples/manifest.json) has version `1` and an `examples` array. Each example contains `id`, `title`, `description`, `files`, `expected` and `suggested`. Each file includes its name, site-relative URL, byte count and SHA-256. `expected` records the scenario oracle; `suggested` gives the initial viewer `tab`, `testNumber`, optional `seriesBy`, and a `compare` hint for separate groups. Test counts mean distinct STDF tests; `catalogueRows` additionally counts MPR pin channels.
