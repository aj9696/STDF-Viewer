"""Summarize repeated ingestion JSON reports for one input and implementation."""

import argparse
import glob
import json
from pathlib import Path
import statistics


def summarize(paths: list[Path]) -> dict:
    reports = [json.loads(path.read_text(encoding="utf-8")) for path in paths]
    if not reports:
        raise ValueError("No benchmark reports matched.")
    signatures = {(report["source_sha256"], report["logical_sample"]["sha256"],
                   tuple(sorted(report["native_binaries_sha256"].values())),
                   tuple(sorted((key, value) for key, value in report["code_sha256"].items()
                                if key.replace("\\", "/").startswith("semidata/")))) for report in reports}
    if len(signatures) != 1:
        raise ValueError("Reports differ in input, sampled logical data, native binary, or application code; summarize separate cohorts.")

    def distribution(values):
        return {"min": min(values), "median": statistics.median(values), "max": max(values)}

    phases = ("snapshot_hash_and_lock_seconds", "preflight_normalization_seconds",
              "native_parser_database_seconds", "integrity_metadata_counts_seconds", "publication_other_seconds")
    return {"samples": len(reports), "reports": [str(path) for path in paths],
            "source_sha256": reports[0]["source_sha256"], "source_bytes": reports[0]["source_bytes"],
            "logical_sample_sha256": reports[0]["logical_sample"]["sha256"],
            "dataset_counts": {key: reports[0]["dataset"][key] for key in (
                "dut_count", "test_count", "measurements", "pass_count")},
            "full_import_seconds": distribution([r["full_import_seconds"] for r in reports]),
            "peak_rss_bytes": distribution([r["memory_after"]["peak_rss_bytes"] for r in reports]),
            "database_bytes": distribution([r["database_bytes"] for r in reports]),
            "phases": {phase: distribution([r["phases"][phase] for r in reports]) for phase in phases}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+", help="Report paths or quoted glob patterns")
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()
    paths = sorted({Path(path) for pattern in args.reports for path in glob.glob(pattern)})
    summary = summarize(paths)
    encoded = json.dumps(summary, indent=2) + "\n"
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(encoded, encoding="utf-8")
    print(encoded)


if __name__ == "__main__":
    main()
