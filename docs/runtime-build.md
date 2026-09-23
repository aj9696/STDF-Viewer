# Native runtime build

The workbench uses the repository's Rust parser through a Python extension. A
successful Python-only installation is insufficient for STDF import. Build the
extension from this checkout so the database schema matches the analysis code.

## Supported development setup

- CPython 3.13, 64 bit.
- Rust stable with Cargo.
- On Windows, Visual Studio C++ Build Tools and a Windows SDK. Run build commands
  in a developer shell that exposes the compiler, linker, headers, and libraries.
- An internet connection for the initial dependency download; subsequent builds
  can use the local caches.

The authoritative dependency declarations are `pyproject.toml` and
`deps/rust_stdf_helper/pyproject.toml`; `uv.lock` records the resolved Python
packages for each supported platform. The upstream `requirements.txt` predates
these declarations and contains an incompatible Windows Qt pin; do not use it
to set up this checkout.

From the repository root, with Python and Rust available:

```powershell
python -m venv .venv
./.venv/Scripts/python.exe -m pip install "uv==0.12.18"
./.venv/Scripts/uv.exe sync --locked --no-dev
./.venv/Scripts/python.exe -c "import rust_stdf_helper; print(rust_stdf_helper.__file__)"
```

`uv sync --locked --no-dev` installs the committed resolution and builds the
local Rust dependency in release mode. It fails if the declarations and lock
disagree, rather than silently choosing new dependencies. On Linux and macOS,
the executable directory is `.venv/bin` instead of `.venv/Scripts`. Follow the
platform's Rust compiler prerequisites; the commands above target Windows.

## Verified Windows environment

The initial local build used CPython 3.13.12, Rust 1.98.1, VS2019 MSVC
14.29.30133, and Windows SDK 10.0.19041.0. It built `rust_stdf_helper` 1.3.0
directly from source. The original Qt application also imported and constructed
its main window successfully with `QT_QPA_PLATFORM=offscreen`.

| Package | Verified version |
| --- | --- |
| uv | 0.12.18 |
| maturin | 1.9.6 |
| NumPy | 2.5.3 |
| Pydantic | 2.13.5 |
| PyQt5 | 5.15.11 |
| PyQt5-Qt5 | 5.15.2 |
| pyqtgraph | 0.14.0 |
| tomlkit | 0.15.1 |
| XlsxWriter | 3.2.9 |

These are the versions exercised locally, not additional minimum requirements.
The local `.venv/installed-versions.txt` records transitive packages for that
environment. Recreate environments from the project declarations and committed
`uv.lock`. Update the lock deliberately with `uv lock`, review its diff, and run
the verification suite before accepting changed package versions.

## Continuous verification

`.github/workflows/workbench.yml` installs the locked dependencies on Ubuntu
22.04 with Python 3.13 and Rust 1.98.1, rebuilds the local extension from source,
runs the Python unit and integration tests, and checks the browser JavaScript
with Node 22. It runs on pull requests, pushes to `main`, and manual dispatch.
The original upstream packaging workflow remains separate.

The lock was checked locally with `uv lock --check --offline` and
`uv sync --locked --no-dev --offline --dry-run`. The dry run preserves local
build tools installed in the evaluation environment. It verifies dependency
resolution, not execution of the hosted CI job.

This workstation stores its Rust installation, build output, and uv cache
inside `.venv`. Its ignored `.venv/runtime-environment.ps1` selects those paths
and the installed C++ compiler explicitly because `vswhere` did not discover
the existing Build Tools installation. It is a workstation helper, not a
portable project requirement.

To rebuild this workstation's extension after editing Rust, first close any
application processes that have imported it, then run:

```powershell
. ./.venv/runtime-environment.ps1
./.venv/Scripts/uv.exe pip install --offline --reinstall --no-build-isolation `
  --python .venv/Scripts/python.exe ./deps/rust_stdf_helper
./.venv/Scripts/python.exe -m unittest discover -s tests -p test_parser_flags.py -v
```

The offline command requires the initial dependency downloads and `maturin`
already installed. Omit `--offline` and `--no-build-isolation` when creating a
new environment. Reinstallation is needed after Rust edits; changing source
files alone does not update an already installed native extension.

## Database compatibility

New parser databases include `PTR_Data.PARM_FLAG` after `TEST_FLAG`. The parser
preserves the raw parameter flag byte so screening can identify invalid or
unreliable measurements. Existing named-column queries retain their behavior.
Old databases are not migrated by the parser; reimport their original STDF
files with the current build when parameter flags are required.

## Troubleshooting

- **`ModuleNotFoundError: rust_stdf_helper`:** use the repository's `.venv`
  interpreter and build the local extension.
- **Compiler or linker missing:** open the Visual Studio developer shell and
  verify the C++ toolset and Windows SDK are installed. Rust alone is not enough.
- **Qt package cannot be resolved on Windows:** use the current project
  declarations, which constrain the Windows Qt runtime to 5.15.2.
- **Database lacks `PARM_FLAG`:** rebuild the extension, restart its importing
  processes, and reimport the source STDF. Renaming a column or filling it with
  zero would discard the validity information.
- **Temporary-directory access denied inside a restricted Windows runner:**
  run the test command with access to its temporary directory. This is a runner
  permission issue; it does not establish a parser failure.
