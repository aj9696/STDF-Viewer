"""Measure one real import in a fresh process without changing application code.

Run each sample as its own process. Filesystem caches are not flushed: results
are warm/unspecified-cache measurements, not cold-storage performance claims.
"""

import argparse
from contextlib import closing
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import sqlite3
import subprocess
import sys
import time
import uuid
from unittest.mock import patch

from .generate import sha256_file


def process_memory() -> dict:
    """Process working-set high water mark (includes native allocations)."""
    if sys.platform == "win32":
        class Counters(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
                (name, ctypes.c_size_t) for name in ("PeakWorkingSetSize", "WorkingSetSize",
                "QuotaPeakPagedPoolUsage", "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage",
                "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage")]
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
        psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
        if not psapi.GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
            raise ctypes.WinError(ctypes.get_last_error())
        return {"peak_rss_bytes": counters.PeakWorkingSetSize,
                "rss_bytes": counters.WorkingSetSize,
                "peak_commit_bytes": counters.PeakPagefileUsage}
    import resource
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return {"peak_rss_bytes": peak * (1 if sys.platform == "darwin" else 1024)}


def logical_sample(database: Path) -> dict:
    """Hash complete scalar rows from up to 34 evenly spaced DUT attempts.

    Timing excludes this check. It catches numeric/flag/identity regressions
    between builds without presenting a sampled check as exhaustive equality.
    """
    with closing(sqlite3.connect(database)) as connection:
        low, high = connection.execute("SELECT MIN(DUTIndex),MAX(DUTIndex) FROM Dut_Info").fetchone()
        indexes = sorted({low, high, *(low + (high - low) * i // 31 for i in range(32))})
        marks = ",".join("?" for _ in indexes)
        rows = connection.execute(f"""SELECT p.DUTIndex,t.TEST_NUM,t.TEST_NAME,t.Unit,
            p.RESULT,p.TEST_FLAG,p.PARM_FLAG,d.PartID,d.HEAD_NUM,d.SITE_NUM,
            d.Flag,d.WaferIndex,d.XCOORD,d.YCOORD,d.Supersede
            FROM PTR_Data p JOIN Test_Info t ON p.TEST_ID=t.TEST_ID
            JOIN Dut_Info d ON p.DUTIndex=d.DUTIndex
            WHERE p.DUTIndex IN ({marks}) ORDER BY p.DUTIndex,t.TEST_NUM,t.TEST_NAME,t.Unit""", indexes).fetchall()
    serialized = json.dumps(rows, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode("utf-8")
    return {"kind": "sampled-logical-PTR-v1", "dut_indexes": indexes, "rows": len(rows),
            "sha256": hashlib.sha256(serialized).hexdigest(),
            "columns": ["dut_index", "test_number", "test_name", "unit", "result", "test_flag",
                        "parm_flag", "part_id", "head", "site", "part_flag", "wafer", "x", "y", "supersede"]}


def benchmark(source: Path, workspace: Path, label: str) -> dict:
    import rust_stdf_helper
    from semidata import library as library_module

    source = source.resolve()
    workspace = workspace.resolve()
    if workspace.exists():
        raise FileExistsError("Use a fresh benchmark workspace so deduplication cannot bypass parsing.")
    if not source.is_file():
        raise FileNotFoundError(source)
    # Hash input and binaries before the timed region; this warms the input
    # cache and is explicitly recorded. The real import hashes its snapshot too.
    source_hash = sha256_file(source)
    extension = Path(rust_stdf_helper.__file__)
    binaries = ([extension] if extension.suffix in (".pyd", ".so") else
                list(extension.parent.glob("*.pyd")) + list(extension.parent.glob("*.so")))
    binary_hashes = {str(binary): sha256_file(binary) for binary in binaries}
    observed = {}
    original_preflight = library_module.preflight
    original_parse = library_module.parse_database
    original_native = rust_stdf_helper.generate_database
    import_started = None

    def timed_preflight(*args, **kwargs):
        start = time.perf_counter()
        observed["snapshot_hash_and_lock_seconds"] = start - import_started
        result = original_preflight(*args, **kwargs)
        observed["preflight_normalization_seconds"] = time.perf_counter() - start
        observed["preflight_counts"] = result
        return result

    def timed_native(*args, **kwargs):
        start = time.perf_counter()
        result = original_native(*args, **kwargs)
        observed["native_parser_database_seconds"] = time.perf_counter() - start
        observed["memory_after_native"] = process_memory()
        return result

    def timed_parse(*args, **kwargs):
        start = time.perf_counter()
        result = original_parse(*args, **kwargs)
        elapsed = time.perf_counter() - start
        observed["parse_and_validation_seconds"] = elapsed
        observed["integrity_metadata_counts_seconds"] = elapsed - observed["native_parser_database_seconds"]
        return result

    library = library_module.Library(workspace)
    before_memory = process_memory()
    cpu_start = time.process_time()
    with patch.object(library_module, "preflight", timed_preflight), \
            patch.object(library_module, "parse_database", timed_parse), \
            patch.object(rust_stdf_helper, "generate_database", timed_native):
        import_started = time.perf_counter()
        result = library.import_file(source)
        elapsed = time.perf_counter() - import_started
    cpu_elapsed = time.process_time() - cpu_start
    after_memory = process_memory()
    if result["duplicate"] or result["dataset"]["sha256"] != source_hash:
        raise AssertionError("Benchmark did not perform the expected new-source import.")
    dataset = result["dataset"]
    database = library.database_path(dataset["id"])
    observed["publication_other_seconds"] = elapsed - sum(observed[key] for key in (
        "snapshot_hash_and_lock_seconds", "preflight_normalization_seconds", "parse_and_validation_seconds"))
    revision = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=False).stdout.strip()
    tracked_state = subprocess.run(["git", "status", "--porcelain", "--untracked-files=no"],
                                   capture_output=True, text=True, check=False).stdout.strip()
    code_files = [Path("semidata/library.py"), Path("semidata/ingest.py"), Path(__file__),
                  Path(__file__).with_name("generate.py")]
    return {"benchmark_version": 1, "label": label, "recorded_at": datetime.now(timezone.utc).isoformat(),
            "python": sys.version, "platform": platform.platform(), "processor": platform.processor(),
            "logical_cpus": os.cpu_count(), "git_revision": revision, "git_tracked_changes": tracked_state,
            "code_sha256": {str(path): sha256_file(path) for path in code_files},
            "native_binaries_sha256": binary_hashes,
            "source": str(source), "source_sha256": source_hash, "source_bytes": source.stat().st_size,
            "workspace": str(workspace), "database_bytes": database.stat().st_size,
            "free_disk_bytes_after": shutil.disk_usage(workspace).free,
            "cache_policy": "Input SHA-256 read before timer; OS caches not flushed. Library init excluded.",
            "phase_notes": "Snapshot phase includes initial path checks, copying/hash/fsync, and catalog lock. "
                           "Native phase includes parser, SQLite writes/indexes, and progress-thread overhead. "
                           "Integrity phase includes integrity check, metadata extraction, and count queries.",
            "full_import_seconds": elapsed, "process_cpu_seconds": cpu_elapsed,
            "ptr_per_second": dataset["measurements"] / elapsed,
            "memory_before": before_memory, "memory_after": after_memory,
            "logical_sample": logical_sample(database),
            "dataset": dataset, "phases": observed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--label", default="sample")
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--json", type=Path)
    parser.add_argument("--native-package-root", type=Path,
                        help="Optional isolated package root for a saved native baseline.")
    args = parser.parse_args()
    if args.native_package_root:
        sys.path.insert(0, str(args.native_package_root.resolve()))
    token = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:8]
    root = Path(".venv/bench-data")
    workspace = args.workspace or root / "runs" / token
    report = benchmark(args.source, workspace, args.label)
    output = args.json or root / "reports" / f"{token}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(output.resolve()), "label": args.label,
                      "full_import_seconds": report["full_import_seconds"],
                      "native_seconds": report["phases"]["native_parser_database_seconds"],
                      "preflight_seconds": report["phases"]["preflight_normalization_seconds"],
                      "ptr_count": report["dataset"]["measurements"],
                      "peak_rss_bytes": report["memory_after"]["peak_rss_bytes"]}))


if __name__ == "__main__":
    main()
