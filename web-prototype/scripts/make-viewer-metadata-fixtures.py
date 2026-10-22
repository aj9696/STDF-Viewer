"""Independent STDF V4 fixture for the viewer's retained declaration budget.

Only struct/hashlib encode the source and expectations. No application decoder
contributes expected values. All records are synthetic and generated on demand.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import struct
from pathlib import Path


def make_source(test_count: int, big: bool) -> tuple[bytes, dict]:
    endian = ">" if big else "<"
    output = bytearray()
    sequence = 0
    devices = []
    selected_records = []

    def pack(fmt, *values):
        return struct.pack(endian + fmt, *values)

    def cn(value):
        encoded = value.encode("ascii")
        assert len(encoded) <= 255
        return bytes([len(encoded)]) + encoded

    def record(kind, subtype, body):
        nonlocal sequence
        sequence += 1
        output.extend(pack("HBB", len(body), kind, subtype) + body)
        return sequence

    def ptr(index, value, limits=(-1.0, 1.0), compact=False):
        body = pack("IBBBBf", 10000 + index, 1, 1, 0, 0, value)
        if not compact:
            body += cn(f"PARAMETER_{index:05d}") + cn("")
            body += pack("Bbbbff", 0, 0, 0, 0, *limits) + cn("V")
            body += cn("%7.3f") * 3 + pack("ff", -0.8, 0.8)
        seq = record(15, 10, body)
        if index == 0:
            selected_records.append({"seq": seq, "value": value, "low": limits[0], "high": limits[1]})

    record(0, 10, bytes([1 if big else 2, 4]))
    mir = pack("IIBcccHc", 1792600000, 1792600000, 1, b"P", b" ", b" ", 65535, b" ")
    mir += b"".join(cn(value) for value in ["SYNTHETIC-METADATA", "TEST-DEVICE", "FIXTURE", "SIMULATOR", "METADATA-REGRESSION"])
    record(1, 10, mir)
    for device in range(2):
        devices.append(record(5, 10, bytes([1, 1])))
        for index in range(test_count):
            ptr(index, (index % 5 - 2) * 0.25 + device * 0.125)
        if device:
            ptr(0, 1.5, limits=(-2.0, 2.0))
            # An omitted tail inherits the first declaration, not the local override.
            ptr(0, 0.25, compact=True)
        prr = pack("BBBHHHhhI", 1, 1, 0, test_count + (2 if device else 0), 1, 1, -32768, -32768, 20)
        record(5, 20, prr + cn(f"PART-{device + 1}") + cn("") + bytes([0]))
    record(1, 20, pack("I", 1792600001) + b" " + cn("") + cn(""))
    raw = bytes(output)
    return raw, {"purpose": "accounting", "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "records": sequence,
                 "tests": test_count, "declarations": test_count + 2, "devices": 2,
                 "observations": test_count * 2 + 2, "deviceIds": devices,
                 "retainedCounts": {"records": sequence, "measurements": test_count * 2 + 2, "devices": 2, "definitions": test_count + 2},
                 "firstTest": {"number": 10000, "name": "PARAMETER_00000", "unit": "V", "observations": selected_records,
                               "mean": 0.21875, "median": -0.0625}}


def make_turnover_source():
    output = bytearray()
    sequence = 0
    values = []

    def record(kind, subtype, body):
        nonlocal sequence
        sequence += 1
        output.extend(struct.pack("<HBB", len(body), kind, subtype) + body)
        return sequence

    def cn(value):
        encoded = value.encode("ascii")
        return bytes([len(encoded)]) + encoded

    def mpr(declaration, value, compact=False):
        body = struct.pack("<IBBBBHHBf", 700, 1, 1, 0, 0, 1, 1, 1, value)
        if not compact:
            body += cn("MPR_METADATA") + cn(f"DECL-{declaration:05d}")
            body += struct.pack("<BbbbffffH", 0, 0, 0, 0, -1.0, 1.0, 0.0, 0.5, 42)
            body += cn("V") + cn("V") + cn("%7.3f") * 3 + struct.pack("<ff", -0.8, 0.8)
        values.append(value)
        return record(15, 15, body)

    record(0, 10, bytes([2, 4]))
    record(1, 10, bytes(15))
    device = record(5, 10, bytes([1, 1]))
    for declaration in range(20050):
        mpr(declaration, (declaration % 5 - 2) * 0.125)
    after = sequence
    repeat = mpr(0, 0.125)
    omitted = mpr(0, 0.75, compact=True)
    record(5, 20, struct.pack("<BBBHHHhhI", 1, 1, 0, len(values), 1, 1, -32768, -32768, 20) + cn("MPR-PART") + cn("") + bytes([0]))
    record(1, 20, bytes(4))
    raw = bytes(output)
    return raw, {"purpose": "turnover", "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "records": sequence,
                 "tests": 1, "declarations": 20051, "devices": 1, "observations": len(values), "deviceIds": [device],
                 "retainedCounts": {"records": sequence, "measurements": 0, "devices": 1, "definitions": 0},
                 "firstTest": {"number": 700, "name": "MPR_METADATA", "unit": "V", "mean": statistics.mean(values), "median": statistics.median(values)},
                 "lateAfter": [after, 0], "lateObservations": [{"seq": repeat, "value": 0.125, "low": -1.0, "high": 1.0, "pmr_index": 42},
                                                              {"seq": omitted, "value": 0.75, "low": -1.0, "high": 1.0, "pmr_index": 42}]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--tests", type=int, default=12000)
    args = parser.parse_args()
    if not 1 <= args.tests <= 19998:
        parser.error("Use 1 through 19,998 tests, below the separate declaration limit.")
    args.directory.mkdir(parents=True, exist_ok=True)
    expected = {}
    for big in (False, True):
        name = f"metadata-{'big' if big else 'little'}.stdf"
        raw, evidence = make_source(args.tests, big)
        (args.directory / name).write_bytes(raw)
        expected[name] = evidence
    raw, evidence = make_turnover_source()
    (args.directory / "metadata-turnover-mpr.stdf").write_bytes(raw)
    expected["metadata-turnover-mpr.stdf"] = evidence
    (args.directory / "expected.json").write_text(json.dumps(expected, indent=2), encoding="utf-8")
    print(json.dumps({name: {key: value for key, value in evidence.items() if key != "firstTest"} for name, evidence in expected.items()}, indent=2))


if __name__ == "__main__":
    main()
