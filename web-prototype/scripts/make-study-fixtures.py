"""Small independently encoded STDF studies and Python standard-library oracles."""
from pathlib import Path
import importlib.util
import json
import math
import statistics
import sys

spec = importlib.util.spec_from_file_location("populations", Path(__file__).with_name("make-viewer-populations.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
Source = module.Source


class ReportSource(Source):
    def __init__(self, lot):
        self.lot = lot
        super().__init__()

    def record(self, kind, subtype, body):
        if (kind, subtype) == (1, 10):
            body += self.cn(self.lot)
        return super().record(kind, subtype, body)


def main(destination):
    destination.mkdir(parents=True, exist_ok=True)
    expected = {"files": {}}
    for big in (False, True):
        source = Source(big)
        for i, name in enumerate("ABCDEFGH", 1):
            attempt = source.begin(1, 1, name)
            if name == "A": source.ptr(attempt, 101, 99, high=200)
            source.ptr(attempt, 101, i, high=200)
            if name == "E": source.ptr(attempt, 101, 500, flag=2, high=200)
            if name != "B": source.ptr(attempt, 202, 2 * i + 1, flag=2 if name == "D" else 0, high=200)
            source.ptr(attempt, 303, -i, high=200)
            source.end(attempt, flags=8 if name == "G" else 16 if name == "H" else 0)
        source.record(1, 30, source.pack("BBIIIII", 1, 1, 8, 0, 0, 6, 0))
        filename = f"study-{'big' if big else 'little'}.stdf"
        expected["files"][filename] = source.save(destination / filename)
    expected["correlation"] = {"devices": 8, "complete": 5, "missing": 1, "invalid": 2, "parts": ["A", "C", "F", "G", "H"], "slope": 2, "intercept": 1, "r": 1}
    values = sorted([99] + list(range(1, 9)))
    expected["distribution"] = {"count": len(values), "mean": statistics.mean(values), "stdev": statistics.pstdev(values), "median": 5, "q1": 3, "q3": 7, "whiskerLow": 1, "whiskerHigh": 8, "outlierCount": 1}
    source = Source()
    values = [-1, 0, 1] * 10 + [20]
    for i, value in enumerate(values):
        attempt = source.begin(1, 1, f"PAT-{i}")
        source.ptr(attempt, 101, value, high=200)
        source.end(attempt)
    for name, value, part_flag, test_flag in [("failed", 1000, 8, 0), ("unknown", 2000, 16, 0), ("test-failed", 2, 0, 128), ("invalid-final", -1, 0, 0)]:
        attempt = source.begin(1, 1, name)
        source.ptr(attempt, 101, value, flag=test_flag, high=200)
        if name == "invalid-final": source.ptr(attempt, 101, 999, flag=2, high=200)
        source.end(attempt, flags=part_flag)
    attempt = source.begin(1, 1, "missing")
    source.ptr(attempt, 202, 10)
    source.end(attempt)
    expected["files"]["study-pat.stdf"] = source.save(destination / "study-pat.stdf")
    expected["pat"] = {"referenceCount": 31, "devices": 36, "eligible": 31, "excluded": 5, "flagged": 1,
                       "sigmaCenter": statistics.mean(values), "sigmaSpread": statistics.stdev(values), "madCenter": 0, "madSpread": 1.4826}
    source = Source()
    rows = []
    for part in range(3):
        for operator in range(2):
            for trial in range(3):
                value = 10 * part + 2 * operator + trial
                attempt = source.begin(1, 1, f"GRR-{part}-{operator}-{trial}")
                source.ptr(attempt, 101, value, high=200)
                source.end(attempt)
                rows.append({"deviceId": attempt["id"], "part": str(part), "operator": str(operator), "trial": str(trial), "value": value})
    expected["files"]["study-gauge.stdf"] = source.save(destination / "study-gauge.stdf")
    # Hand-derived balanced design: trial values 0,1,2 give MSE=1; part means
    # differ by10 and operator means by2; interaction is exactly zero.
    expected["gauge"] = {"rows": rows, "mean": 12, "repeatability": 1, "operator": 2, "interaction": 0, "part": 100, "gauge": 3, "total": 103,
                         "ssPart": 1200, "ssOperator": 18, "ssInteraction": 0, "ssError": 12}
    for index, lot in enumerate(["REPORT-A", "REPORT-A", "REPORT-B"], 1):
        source = ReportSource(lot)
        attempt = source.begin(1, 1, f"REPORT-{index}")
        source.ptr(attempt, 101, index, high=200)
        source.end(attempt)
        source.save(destination / f"report-{index}.stdf")
    (destination / "expected.json").write_text(json.dumps(expected, indent=2), encoding="utf8")
    print(destination)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
