"""Run paired native builds in fresh processes and verify their stored results.

Generate the three documented fixtures first. Package roots must contain an
importable rust_stdf_helper built for the running Python/platform ABI.
"""

import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import statistics
import subprocess
import sys


CASES = {
    "part": "benchmark-10000d-3t-retest-part.stdf",
    "die": "benchmark-10000d-3t-retest-die.stdf",
    "ordinary": "benchmark-10000d-100t.stdf",
}


def stats(values):
    return {"min": min(values), "median": statistics.median(values), "max": max(values)}


def database(report):
    return Path(report["workspace"]) / "imports" / report["dataset"]["id"] / "source.db"


def compare_tables(baseline, candidate):
    """Exhaustive row equality for the small retest fixtures, outside timing."""
    tables = {}
    with closing(sqlite3.connect(database(baseline))) as left, \
            closing(sqlite3.connect(database(candidate))) as right:
        names_sql = "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        names = [row[0] for row in left.execute(names_sql)]
        if names != [row[0] for row in right.execute(names_sql)]:
            raise AssertionError("Database table sets differ")
        for name in names:
            # Names originate in the fixed native schema, not user-supplied SQL.
            quoted_name = '"' + name.replace('"', '""') + '"'
            columns = [row[1] for row in left.execute(f"PRAGMA table_info({quoted_name})")]
            if columns != [row[1] for row in right.execute(f"PRAGMA table_info({quoted_name})")]:
                raise AssertionError(f"Column sets differ: {name}")
            columns = [column for column in columns if not (name == "File_List" and column == "Filename")]
            projection = ",".join('"' + column.replace('"', '""') + '"' for column in columns)
            order = ",".join(str(index) for index in range(1, len(columns) + 1))
            query = f"SELECT {projection} FROM {quoted_name} ORDER BY {order}"
            left_rows, right_rows = left.execute(query).fetchall(), right.execute(query).fetchall()
            if left_rows != right_rows:
                raise AssertionError(f"Logical rows differ: {name}")
            encoded = json.dumps(left_rows, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode()
            tables[name] = {"rows": len(left_rows), "columns": columns,
                            "sha256": hashlib.sha256(encoded).hexdigest()}
    return {"equal": True, "excluded_columns": ["File_List.Filename"], "tables": tables}


def summarize(reports, prefix):
    output = {
        "format": "native-retest-index-v1",
        "method": {
            "samples_per_build_per_case": 3,
            "order": ["baseline", "candidate", "candidate", "baseline", "baseline", "candidate"],
            "processes": "Each sample is a fresh process and a fresh Library workspace.",
            "cache": "Input hashed before timing; OS caches not flushed.",
            "native_phase": "Parser, SQLite writes/indexes, and real application progress callbacks; polling can add about 100 ms.",
            "checks": "All six sampled hashes per case match. First pair of each retest case compared exhaustively across every table, excluding only the snapshot filename.",
            "limits": "One Windows workstation and synthetic PTR workloads; no universal parser-speed or cross-tool claim.",
        },
        "cases": {},
    }
    all_runs = []
    for case, filename in CASES.items():
        groups = {build: [json.loads((reports / f"{prefix}-{case}-{build}-{number}.json").read_text())
                          for number in range(1, 4)] for build in ("baseline", "candidate")}
        runs = [report for group in groups.values() for report in group]
        all_runs.extend(runs)
        for key in ("source_sha256", "source_bytes"):
            if len({report[key] for report in runs}) != 1:
                raise AssertionError(f"Differing inputs: {case}")
        if len({report["logical_sample"]["sha256"] for report in runs}) != 1:
            raise AssertionError(f"Sampled logical rows differ: {case}")
        first = runs[0]
        result = {"source": {"filename": filename, "bytes": first["source_bytes"],
                             "sha256": first["source_sha256"],
                             "measurements": first["dataset"]["measurements"],
                             "dut_attempts": first["dataset"]["dut_count"]},
                  "sampled_equality_all_six": True, "logical_sample": first["logical_sample"]}
        for build, samples in groups.items():
            hashes = {tuple(sorted(report["native_binaries_sha256"].values())) for report in samples}
            if len(hashes) != 1:
                raise AssertionError(f"Native binary changed within {case}/{build}")
            result[build] = {
                "native_binary_sha256": list(next(iter(hashes))),
                "samples": [{"label": report["label"], "recorded_at": report["recorded_at"],
                             "native_seconds": report["phases"]["native_parser_database_seconds"],
                             "full_import_seconds": report["full_import_seconds"],
                             "database_bytes": report["database_bytes"],
                             "peak_rss_bytes": report["memory_after"]["peak_rss_bytes"]}
                            for report in samples],
                "native_seconds": stats([report["phases"]["native_parser_database_seconds"] for report in samples]),
                "full_import_seconds": stats([report["full_import_seconds"] for report in samples]),
            }
        result["native_speedup"] = result["baseline"]["native_seconds"]["median"] / result["candidate"]["native_seconds"]["median"]
        with closing(sqlite3.connect(database(groups["candidate"][0]))) as connection:
            result["retest_indexes"] = [row[0] for row in connection.execute(
                "SELECT name FROM sqlite_schema WHERE name IN ('dutPartRetestKey','dutDieRetestKey') ORDER BY name")]
            result["supersede_counts"] = connection.execute(
                "SELECT Supersede,COUNT(*) FROM Dut_Info GROUP BY Supersede").fetchall()
        if case == "ordinary":
            if result["retest_indexes"] or result["supersede_counts"] != [(0, 10000)]:
                raise AssertionError("Ordinary workload acquired retest indexes or superseded DUTs")
        else:
            if result["supersede_counts"] != [(0, 10000), (1, 10000)]:
                raise AssertionError(f"Unexpected retest counts: {case}")
            result["exhaustive_first_pair"] = compare_tables(groups["baseline"][0], groups["candidate"][0])
        output["cases"][case] = result
    if len({json.dumps(report["code_sha256"], sort_keys=True) for report in all_runs}) != 1:
        raise AssertionError("Python application or benchmark source changed during the series")
    first = all_runs[0]
    output["environment"] = {key: first[key] for key in ("python", "platform", "processor", "logical_cpus", "git_revision")}
    output["python_code_sha256"] = {Path(key.replace("\\", "/")).name: value for key, value in first["code_sha256"].items()}
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-package-root", type=Path)
    parser.add_argument("--candidate-package-root", type=Path)
    parser.add_argument("--data-dir", type=Path, default=Path(".venv/bench-data"))
    parser.add_argument("--reports", type=Path, default=Path(".venv/bench-data/reports"))
    parser.add_argument("--prefix", default="native-index")
    parser.add_argument("--output", type=Path, default=Path(".venv/bench-data/native-retest-index.json"))
    parser.add_argument("--summarize-only", action="store_true")
    args = parser.parse_args()
    if not args.prefix or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for character in args.prefix):
        parser.error("--prefix must contain only letters, numbers, hyphens, or underscores")
    if not args.summarize_only:
        if not args.baseline_package_root or not args.candidate_package_root:
            parser.error("Both native package roots are required when running samples")
        for filename in CASES.values():
            if not (args.data_dir / filename).is_file():
                parser.error(f"Generate the documented fixture first: {filename}")
        for case, filename in CASES.items():
            for number in range(1, 4):
                order = ("candidate", "baseline") if number == 2 else ("baseline", "candidate")
                for build in order:
                    label = f"{args.prefix}-{case}-{build}-{number}"
                    report_path = args.reports / f"{label}.json"
                    if report_path.exists():
                        raise FileExistsError(f"Use a new --prefix to preserve existing evidence: {report_path}")
                    package = args.baseline_package_root if build == "baseline" else args.candidate_package_root
                    subprocess.run([sys.executable, "-m", "benchmarks.ingestion", str(args.data_dir / filename),
                                    "--native-package-root", str(package), "--label", label,
                                    "--json", str(report_path)], check=True)
    result = summarize(args.reports, args.prefix)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
