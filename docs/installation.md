# Install and run SemiData Workbench

Applies to the 0.1.0 engineering evaluation release. SemiData is a local Python
application with a Rust STDF parser and a browser interface. It needs no
separate database server. The current launch instructions target Windows.

## Start this prepared checkout

The repository's `.venv` environment is already built on the initial evaluation
workstation. In the repository folder, double-click **Start-SemiData.cmd**.
Its terminal prints the application address and workspace location, then opens
your default browser. The default address is **http://127.0.0.1:8765**.

Keep the terminal open while using SemiData. To stop the application, wait for
imports and saves to finish, then press **Ctrl+C** in that terminal. Closing
the browser tab does not stop the service.

Open **Engineer guide** in the application for a reproducible first session,
or read [the guide](engineer-guide.md) in this repository.

## Set up a clean development machine

Install 64-bit CPython 3.13 and the Rust/Windows compiler prerequisites, then
follow the exact environment and native-extension build commands in
[Native runtime build](runtime-build.md). Build the extension from this
checkout; a Python-only setup or an older upstream binary is insufficient.

The project dependency declarations and local Rust extension define the
runtime. Do not use the upstream `requirements.txt` for this checkout; see
the build guide for the Windows Qt compatibility constraint.

After building, run these commands from the repository root:

```powershell
./.venv/Scripts/python.exe -c "import rust_stdf_helper; print(rust_stdf_helper.__file__)"
./.venv/Scripts/python.exe -m unittest discover -s tests -v
./.venv/Scripts/python.exe -m semidata --workspace ./workspace --port 8765
```

The first command checks that this interpreter can load the parser. The test
suite exercises the real parser and the workbench's data/analysis contracts.
The final command starts the service and opens the browser.

## Choose a workspace or port

`Start-SemiData.cmd` stores data in the repository's `workspace` folder by
default. To choose a different location, run from the repository root:

```powershell
./.venv/Scripts/python.exe -m semidata --workspace "C:\TestData\SemiData" --port 8765
```

If port 8765 is occupied, choose another port, for example:

```powershell
./.venv/Scripts/python.exe -m semidata --workspace "C:\TestData\SemiData" --port 8766
```

Use the exact `127.0.0.1` address printed by the terminal. The server validates
its loopback host and port. It is not a shared network service or a multiuser
deployment. Add `--no-browser` to either command when you want to open the
printed address yourself or run automated checks.

The workbench performs imports and analysis locally and does not upload test
data. Operating-system synchronization is separate: this initial repository
is under OneDrive, so its default workspace may be synchronized by OneDrive.
Choose an unsynchronized local folder when data must remain only on the
workstation. The STDF.io generator link opens an external website.

## What the workspace contains

```text
workspace/
  catalog.sqlite3          Dataset catalog and saved PAT experiments
  catalog.sqlite3-wal      SQLite transaction file, when present
  catalog.sqlite3-shm      SQLite coordination file, when present
  imports/
    <dataset-id>/
      source.stdf          Original source bytes, or source.stdf.gz/.bz2/.zip
      source.db            Parsed database for this dataset
  demo-sources/            Reproducible synthetic example inputs
```

The catalog uses SQLite WAL mode and full synchronization. Each successful
import stores its source bytes and parser database before publishing its
catalog entry. Exact source hashes detect duplicates. The interface reads
the parsed data on later visits rather than rebuilding every import.

Treat the workspace as one unit. Editing its databases or source snapshots
outside the application can invalidate provenance or break saved references.
An interrupted process can leave unreferenced staging/import directories;
they are not visible as datasets unless publication completed. There is no
workspace repair or garbage-collection command in this release.

## Back up and restore

1. Wait for active imports and saves to finish.
2. Stop the service with **Ctrl+C**.
3. Copy the **entire workspace folder**, including any remaining SQLite
   `-wal` and `-shm` files, to your backup destination. Do not copy only
   `catalog.sqlite3` while the application is running.
4. To restore, copy that backup into a new folder and launch SemiData with
   `--workspace` pointing to the restored folder.
5. Confirm that the datasets and saved runs reopen before resuming evaluation.

The retained source snapshots support future reprocessing. Saved experiments
also preserve their calculated results and source hashes. A backup of code
or the virtual environment alone is not a backup of your test data.

## Updating the native parser

After changes to Rust source, stop processes using the extension and rebuild
it using [Native runtime build](runtime-build.md). Restart the workbench after
the build. Editing Rust source alone does not update an installed binary.

This release requires `PTR_Data.PARM_FLAG` so eligibility calculations preserve
the source parameter flags. Older parser databases do not acquire that column
automatically. If the application reports that an import predates flag
preservation, create a new workspace and import the original source files
with the current extension. Reimporting identical bytes into the old workspace
will deduplicate them instead of rebuilding them. Keep the old workspace and
its saved experiments until you have verified the new one.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| Launcher says its Python environment is missing | Complete the clean-machine build instructions; the launcher does not install dependencies. |
| `rust_stdf_helper` cannot be imported | Use `.venv/Scripts/python.exe` and build this checkout's Rust extension. |
| Browser cannot connect | Keep the service terminal open and use its printed `127.0.0.1` address and port. |
| Port is already in use | Stop the other instance or choose a different `--port`. |
| Import reports missing MRR, truncated data, or an unfinished device | Obtain a complete file; this release deliberately rejects incomplete STDF streams. |
| ZIP import is rejected | Use an unencrypted archive containing exactly one STDF file, or import the raw file. |
| Import exceeds the size limit | Evaluate a smaller complete file; the original and expanded input are each limited to 2 GiB. |
| File or workspace access fails | Check the full path, folder permissions, available disk space, and whether another process has the files open. |
| Another import is busy | Wait for it to finish, then retry. Catalog writes serialize imports. |
| PAT has too few reference measurements or zero spread | Choose a compatible reference with at least 30 eligible measurements and nonzero variation. |
| Saved history seems empty | Check the workspace path printed by the terminal; a different folder is a different library. |
| An error requires terminal details | Capture the exact message and use the feedback template in the engineer guide. |

For calculation definitions and compatibility limits, read
[Calculation methods](methods.md). For current checks and remaining evaluation
gaps, read [Release verification](release-verification.md).
