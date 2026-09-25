# SemiData Workbench

An open-source, local semiconductor test-data workbench built on
[Noon Chen's STDF-Viewer](https://github.com/noonchen/STDF-Viewer).

Import STDF into a local browser library, investigate PTR/MPR/FTR results, and
run explicit screening experiments. Rust/WebAssembly and SQLite process the
files on your machine. No account, test-data upload or database server is needed.

## Start the browser workbench

On the prepared workstation, open [Data library](http://127.0.0.1:8766/app.html).
If the server is stopped, run this from the repository root:

```powershell
.venv/Scripts/python.exe -m http.server 8766 --bind 127.0.0.1 --directory web-prototype/site
```

For a clean checkout, follow the [browser build/run guide](web-prototype/README.md).
Use the HTTP address; opening the HTML through `file://` does not work.

1. Open **Examples** for small scenarios, or import your STDF files/folder.
2. Open a file, select tests and use the chart tabs.
3. Choose **Tools** for comparison studies, screening, editing and reports.

| Workflow | Browser capabilities |
| --- | --- |
| Library | Raw/compressed STDF, ATDF, folder queues, content-based duplicates, portable workspaces |
| Investigation | Device/test matrix, exact statistics, histograms, trends, bins and original records |
| Comparison | Ordered source groups, file/lot ranking, CDF/box plots, explicit test aliases, 2D/3D correlation |
| Wafers | Bin/value maps, numeric coordinate means, 3D relief, gallery and device picking |
| Studies | PAT and lot recipes, What-If, GDBN/CD, combined screening, PVT and crossed Gauge R&R |
| Authoring | Typed changes, bin remaps, attempt removal, preview and separate derived STDF copies |
| Outputs | CSV/JSON/STDF bundles, Excel, PDF, editable Word, chart/page images and receipts |

This is an engineering evaluation build. The [tools guide](web-prototype/docs/TOOLS.md),
[manual coverage matrix](docs/dlog-coverage.md) and
[qualification record](web-prototype/docs/VIEWER-VALIDATION.md) distinguish working
features, limits and remaining interoperability work. Original sources remain
immutable. Browser profile/origin determines where the library persists.

## Earlier applications

The Python workbench (**v0.1.1**) remains available through `Start-SemiData.cmd`
at port 8765. Its [walkthrough](docs/engineer-guide.md),
[methods](docs/methods.md) and [architecture](docs/architecture.md) describe that
separate application and its scalar-PTR PAT experiments. Its file-based workspace
is separate from the browser library.

Run the original Qt viewer with `.venv/Scripts/python.exe STDF-Viewer.py`.
Its instructions are preserved in [README.upstream.md](README.upstream.md).

## Documentation

- [Installation and workspace operations](docs/installation.md)
- [Engineer walkthrough, checks, and feedback template](docs/engineer-guide.md)
- [Calculations and population semantics](docs/methods.md)
- [Architecture and recorded decisions](docs/architecture.md)
- [Local API contract](docs/api.md)
- [Native build and troubleshooting](docs/runtime-build.md)
- [Release verification](docs/release-verification.md)
- [Measured import performance](docs/import-performance.md) · [Why STDF looks this way](docs/stdf-format.md)
- [Rust/WebAssembly browser data foundation](web-prototype/README.md)
- [Browser storage and folder workflow](docs/browser-data-workflow.md)
- [Feature comparison and browser feature candidates](docs/feature-landscape.md)
- [Contribution guide](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)
- [Capability map](CAPABILITIES.md) · [Implementation checklist](tasks/todo.md)

## Python application checks

```powershell
.venv/Scripts/python.exe -m unittest discover -s tests -v
node --check semidata/static/app.js
node --check semidata/static/charts.js
node --check semidata/static/format.js
.venv/Scripts/python.exe -m compileall -q semidata
git diff --check
```

## License and attribution

GPL v3; see [LICENSE](LICENSE). STDF parsing and the original viewer are based
on Noon Chen's work. The new workbench uses original interface assets. The
upstream viewer's icons retain their separate CC BY-NC 4.0 terms, documented
in the upstream README. Source changes and evaluation status are recorded in
the changelog; no affiliation with Galaxy Semiconductor or Stratum is implied.
