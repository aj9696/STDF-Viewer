"""Build the small, deterministic STDF V4 examples using only Python's stdlib.

Run from the repository root:
    .venv/Scripts/python.exe web-prototype/scripts/make-examples.py
    .venv/Scripts/python.exe web-prototype/scripts/make-examples.py --check
Only the six named output files are written. No production data is read.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
from pathlib import Path


def pack(fmt, *values):
    return struct.pack("<" + fmt, *values)


def cn(value):
    encoded = value.encode("ascii")
    assert len(encoded) <= 255
    return bytes([len(encoded)]) + encoded


class Source:
    def __init__(self, lot, *, wafer=False):
        self.data = bytearray()
        self.records = self.observations = self.attempts = self.test_count = 0
        self.outcomes = {"passed": 0, "failed": 0, "unknown": 0}
        self.bins = {}
        self.wafer = wafer
        self.record(0, 10, bytes([2, 4]))
        mir = pack("IIBcccHc", 1735689600, 1735689600, 1, b"P", b" ", b" ", 65535, b" ")
        mir += b"".join(cn(s) for s in [lot, "DEMO-PMIC", "DEMO-ATE", "SYNTHETIC", "examples-v1"])
        self.record(1, 10, mir)
        self.record(50, 30, cn("Synthetic evaluation data. No production or customer measurements."))
        if wafer:
            self.record(2, 30, pack("fffBchhcc", 200, 4, 4, 3, b"D", 0, 0, b"R", b"U"))
            self.record(2, 10, pack("BBI", 1, 1, 1735689600) + cn("WAFER-01"))

    def record(self, kind, subtype, body):
        self.records += 1
        self.data.extend(pack("HBB", len(body), kind, subtype) + body)

    def begin(self, part, site=1, x=-32768, y=-32768):
        self.site, self.part, self.x, self.y = site, part, x, y
        self.test_count = 0
        self.record(5, 10, bytes([1, site]))

    def ptr(self, number, name, value, low, high, unit, *, flags=None):
        if flags is None:
            flags = 0x80 if value < low or value > high else 0
        body = pack("IBBBBf", number, 1, self.site, flags, 0, value)
        body += cn(name) + cn("") + pack("Bbbbff", 0, 0, 0, 0, low, high) + cn(unit)
        self.record(15, 10, body)
        self.test_count += 1
        self.observations += 1

    def end(self, *, failed=False, unknown=False, retest=False, digital=False):
        flags = (8 if failed else 0) | (16 if unknown else 0) | (1 if retest else 0)
        number = 4 if unknown else 3 if digital else 2 if failed else 1
        body = pack("BBBHHHhhI", 1, self.site, flags, self.test_count, number, number, self.x, self.y, 120)
        self.record(5, 20, body + cn(self.part) + cn("") + bytes([0]))
        self.attempts += 1
        self.outcomes["unknown" if unknown else "failed" if failed else "passed"] += 1
        self.bins[number] = self.bins.get(number, 0) + 1

    def finish(self):
        for subtype in [40, 50]:
            for number, outcome, name in [(1, b"P", "PASS"), (2, b"F", "PARAMETRIC"), (3, b"F", "DIGITAL"), (4, b" ", "INCOMPLETE")]:
                if number in self.bins:
                    self.record(1, subtype, pack("BBHIc", 255, 255, number, self.bins[number], outcome) + cn(name))
        if self.wafer:
            self.record(2, 20, pack("BBIIIIII", 1, 1, 1735689660, self.attempts, 0, 0, self.outcomes["passed"], 0) + cn("WAFER-01"))
        self.record(1, 20, pack("Ic", 1735689660, b" ") + cn("Synthetic evaluation lot") + cn(""))
        return bytes(self.data)


def electrical(source, i, *, current=None):
    source.ptr(1001, "VDD", 1.8 + (i % 7 - 3) * .005, 1.7, 1.9, "V")
    source.ptr(1002, "Active current", 18 + (i // 2 % 6 - 2.5) * .25 if current is None else current, 12, 24, "mA")
    source.ptr(1003, "Standby leakage", .4 + (i % 5 - 2) * .025, 0, 1, "uA")


def baseline(shift=False):
    source = Source("SITE-SHIFT" if shift else "CLEAN-LOT")
    for i in range(48):
        site = 1 + i % 2
        current = 18 + (i // 2 % 6 - 2.5) * .25 + (6 if shift and site == 2 else 0)
        source.begin(f"D{i + 1:03}", site)
        electrical(source, i, current=current)
        source.end(failed=current > 24)
    return source


def build():
    sources = {"baseline.stdf": baseline(), "site-shift.stdf": baseline(True)}
    source = Source("RETEST-LOT")
    for i in range(24):
        source.begin(f"D{i + 1:03}", 1 + i % 2)
        electrical(source, i, current=26 + i * .25 if i < 6 else None)
        source.end(failed=i < 6)
    for i in range(6):
        source.begin(f"D{i + 1:03}", 1 + i % 2)
        electrical(source, i, current=18 + i * .1)
        source.end(retest=True)
    sources["retest.stdf"] = source

    source = Source("WAFER-EDGE", wafer=True)
    for y in range(-3, 4):
        for x in range(-3, 4):
            radius = x * x + y * y
            failed = radius >= 10
            source.begin(f"X{x:+d}Y{y:+d}", 1, x, y)
            source.ptr(1001, "VDD", 1.8 + x * .005, 1.7, 1.9, "V")
            source.ptr(1003, "Standby leakage", (1.2 if failed else .3) + .025 * radius, 0, 1, "uA")
            source.end(failed=failed)
    sources["wafer-edge.stdf"] = source

    source = Source("MIXED-TESTS")
    for index, name in [(20, "GPIO0"), (21, "GPIO1"), (22, "GPIO2")]:
        source.record(1, 60, pack("HH", index, 0) + cn(f"CH{index}") + cn(f"P{index}") + cn(name) + bytes([1, 1]))
    for i in range(24):
        source.begin(f"D{i + 1:03}")
        if i not in [3, 7, 11]:
            source.ptr(1003, "Standby leakage", math.nan if i == 9 else 999 if i == 5 else .4 + (i % 5 - 2) * .025,
                       0, 1, "uA", flags=2 if i == 5 else 0)
        pin_failure = i in [4, 12]
        values = [.62 + (i % 5 - 2) * .005, 1.1 if pin_failure else .65 + (i % 7 - 3) * .005, .68 + (i % 3 - 1) * .005]
        body = pack("IBBBBHH", 2001, 1, 1, 128 if pin_failure else 0, 0, 3, 3)
        body += bytes([0x21 if pin_failure else 0x11, 0x01]) + pack("fff", *values) + cn("Diode drop") + cn("")
        body += pack("BbbbffffHHH", 0, 0, 0, 0, .4, .8, 0, 0, 20, 21, 22) + cn("V") + cn("")
        source.record(15, 15, body)
        digital_failure = i in [6, 18]
        flags = 16 if i == 19 else 128 if digital_failure else 0
        body = pack("IBBBBIIIIiiHHH", 3001, 1, 1, flags, 0, 100, 8 if digital_failure else 100, 1 if digital_failure else 0, 0, 0, 0, 0, 3, 0)
        body += pack("HHH", 20, 21, 22) + bytes([0x51 if digital_failure else 0x11, 0x01])
        body += pack("H", 3) + bytes([2 if digital_failure else 0])
        body += cn("SCAN_BASIC") + cn("100MHz") + cn("") + cn("Scan chain")
        source.record(15, 20, body)
        source.test_count += 2
        source.observations += 4
        source.end(failed=pin_failure or digital_failure, unknown=i in [5, 9, 19], digital=digital_failure)
    sources["mixed-tests.stdf"] = source

    binaries = {name: source.finish() for name, source in sources.items()}
    files = {name: {"name": name, "url": "examples/" + name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
             for name, data in binaries.items()}
    def example(id, title, description, names, expected, suggested):
        return {"id": id, "title": title, "description": description, "files": [files[name] for name in names],
                "expected": expected, "suggested": suggested}
    manifest = {"version": 1, "examples": [
        example("baseline", "Clean lot", "48 devices, two sites, three tests. All pass.", ["baseline.stdf"],
                {"devices": 48, "attempts": 48, "tests": 3, "observations": 144, "passed": 48, "failed": 0},
                {"tab": "histogram", "testNumber": 1002}),
        example("site-shift", "Site shift", "Compare two lots. Site 2 draws more current in the second.", ["baseline.stdf", "site-shift.stdf"],
                {"devicesPerFile": 48, "tests": 3, "observationsPerFile": 144, "shiftedLotPassed": 36, "shiftedLotFailed": 12,
                 "site1CurrentMean": 18, "site2CurrentMean": 24, "site2Failures": 12},
                {"tab": "histogram", "testNumber": 1002, "seriesBy": "site", "compare": True}),
        example("retest", "Fail to pass", "Six failed devices pass on retest. Switch between current and all attempts.", ["retest.stdf"],
                {"devices": 24, "attempts": 30, "tests": 3, "observations": 90, "superseded": 6,
                 "currentPassed": 24, "currentFailed": 0, "allPassed": 24, "allFailed": 6},
                {"tab": "devices", "testNumber": 1002}),
        example("wafer", "Wafer edge failures", "49 dies. High leakage follows the wafer edge.", ["wafer-edge.stdf"],
                {"devices": 49, "attempts": 49, "tests": 2, "observations": 98, "passed": 29, "failed": 20,
                 "wafer": "WAFER-01", "bounds": [-3, 3], "failureRule": "x*x + y*y >= 10"},
                {"tab": "wafers", "testNumber": 1003}),
        example("mixed", "Pins and digital tests", "24 devices with pin results, scan failures, and missing or invalid readings.", ["mixed-tests.stdf"],
                {"devices": 24, "attempts": 24, "tests": 3, "catalogueRows": 5, "observations": 117,
                 "passed": 17, "failed": 4, "unknown": 3, "leakageRecorded": 21, "leakageValid": 19,
                 "leakageMissingParts": ["D004", "D008", "D012"], "leakageInvalidParts": ["D006", "D010"],
                 "pinFailures": ["D005", "D013"], "digitalFailures": ["D007", "D019"], "digitalNotExecuted": ["D020"]},
                {"tab": "devices", "testNumber": 2001}),
    ]}
    assert sum(map(len, binaries.values())) < 200_000
    assert sources["site-shift.stdf"].outcomes == {"passed": 36, "failed": 12, "unknown": 0}
    assert sources["wafer-edge.stdf"].outcomes == {"passed": 29, "failed": 20, "unknown": 0}
    assert sources["mixed-tests.stdf"].outcomes == {"passed": 17, "failed": 4, "unknown": 3}
    for item in manifest["examples"]:
        if len(item["files"]) == 1:
            source = sources[item["files"][0]["name"]]
            assert item["expected"]["observations"] == source.observations
            assert item["expected"]["attempts"] == source.attempts
    binaries["manifest.json"] = (json.dumps(manifest, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")
    return binaries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify checked-in files without writing them")
    args = parser.parse_args()
    destination = Path(__file__).resolve().parents[1] / "site/examples"
    files = build()
    if not args.check:
        destination.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        path = destination / name
        if args.check:
            if not path.is_file() or path.read_bytes() != data:
                raise SystemExit(f"Example is missing or stale: {path}")
        else:
            path.write_bytes(data)
    print(json.dumps({"checked" if args.check else "generated": list(files), "bytes": sum(map(len, files.values()))}))


if __name__ == "__main__":
    main()
