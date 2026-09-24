# SemiData Workbench

An open-source, local semiconductor test-data workbench built on
[Noon Chen's STDF-Viewer](https://github.com/noonchen/STDF-Viewer).

**Version 0.1.1 · engineering evaluation release · Windows verified**

Import STDF once, compare scalar measurements across lots and sites, and
evaluate reproducible PAT experiments with saved evidence. Files stay in your
chosen workspace; the application requires no database server or cloud account.

## Start

On the prepared workstation, double-click **Start-SemiData.cmd**. The application
opens at http://127.0.0.1:8765. Keep the terminal open; Ctrl+C stops the server.
For a clean checkout, follow [Installation](docs/installation.md).

1. Choose **Load example data** in Data library.
2. Open **Explore** and compare test 1001, VDD, across the three example lots.
3. Follow the [15-minute engineer walkthrough](docs/engineer-guide.md) to evaluate
   a MAD screen, save the experiment, and export its affected measurements.

The walkthrough also documents a reproducible recipe at
[STDF.io Generate](https://stdf.io/generate) for independent evaluation data.

## Delivered capabilities

| Workflow | Available in 0.1 |
| --- | --- |
| Data library | Durable catalog, source snapshots, duplicate detection, raw/gzip/bzip2/ZIP imports |
| Exploration | Scalar PTR selection, site/attempt filters, distributions, source comparison, statistics |
| PAT lab | Mean/sample-SD and median/MAD screens, separate reference populations, explicit eligibility |
| Saved runs | Exact recipes, source hashes, bounds, affected measurements, CSV export, restart persistence |
| Existing viewer | Original Qt application and its wafer/bin/report workflows remain available |

This release is for engineering evaluation. It does not claim qualified DPAT,
production disposition, cross-file retest consolidation, MPR/FTR analytics in
the new UI, or enterprise-scale performance. See [Calculation reference](docs/methods.md)
and [Architecture](docs/architecture.md) for precise boundaries and resource caps.

## Documentation

- [Installation and workspace operations](docs/installation.md)
- [Engineer walkthrough, checks, and feedback template](docs/engineer-guide.md)
- [Calculations and population semantics](docs/methods.md)
- [Architecture and recorded decisions](docs/architecture.md)
- [Local API contract](docs/api.md)
- [Native build and troubleshooting](docs/runtime-build.md)
- [Release verification](docs/release-verification.md)
- [Measured import performance](docs/import-performance.md) · [Why STDF looks this way](docs/stdf-format.md)
- [Rust/WebAssembly browser parser experiment](web-prototype/README.md)
- [Proposed browser storage and folder workflow](docs/browser-data-workflow.md)
- [Contribution guide](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)
- [Capability map](CAPABILITIES.md) · [Implementation checklist](tasks/todo.md)

## Development checks

```powershell
.venv/Scripts/python.exe -m unittest discover -s tests -v
node --check semidata/static/app.js
node --check semidata/static/charts.js
node --check semidata/static/format.js
.venv/Scripts/python.exe -m compileall -q semidata
git diff --check
```

Run the original viewer with `.venv/Scripts/python.exe STDF-Viewer.py`.
Its original instructions are preserved in [README.upstream.md](README.upstream.md).

## License and attribution

GPL v3; see [LICENSE](LICENSE). STDF parsing and the original viewer are based
on Noon Chen's work. The new workbench uses original interface assets. The
upstream viewer's icons retain their separate CC BY-NC 4.0 terms, documented
in the upstream README. Source changes and evaluation status are recorded in
the changelog; no affiliation with Galaxy Semiconductor or Stratum is implied.
