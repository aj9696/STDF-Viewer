"""Generate independent STDF V4 goldens for retained browser-library checks.

Uses Python's struct/hashlib only: neither Rust nor the application's decoder
contributes expected values. Run from the repository root:
    .venv/Scripts/python.exe web-prototype/scripts/make-library-fixtures.py
The generated data belongs in ignored .venv/library-fixtures, never production
test-data directories. This script overwrites only its explicitly named files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path


def cn(text: str) -> bytes:
    encoded = text.encode("ascii")
    if len(encoded) > 255:
        raise ValueError("Fixture Cn exceeds one-byte length")
    return bytes([len(encoded)]) + encoded


def make_golden(big: bool) -> tuple[bytes, dict]:
    order = ">" if big else "<"
    output = bytearray()
    records, measurements, devices, definitions = [], [], [], []
    metadata = {}

    def record(typ: int, sub: int, body: bytes, device_id=None) -> int:
        seq = len(records) + 1
        encoded = struct.pack(order + "HBB", len(body), typ, sub) + body
        records.append([seq, len(output), len(encoded), typ, sub, device_id])
        output.extend(encoded)
        return seq

    def ptr(head, site, device, definition, number, flags, bits, tail):
        body = struct.pack(order + "IBBBBI", number, head, site, *flags, bits) + tail
        seq = record(15, 10, body, device)
        value = struct.unpack("<f", struct.pack("<I", bits))[0]
        if bits & 0x7F800000 == 0x7F800000:
            value = None
        measurements.append([seq, device, definition, number, head, site, *flags, bits, value])

    def prr(device, head, site, flags, tests, hard, soft, x, y, millis, part, text):
        body = struct.pack(order + "BBBHHHhhI", head, site, flags, tests, hard, soft, x, y, millis)
        body += cn(part) + cn(text) + bytes([0])
        seq = record(5, 20, body, device)
        devices.append([device, head, site, seq, flags, tests, hard, soft, x, y, millis, part, text])

    # Sequence/device IDs below are deliberate golden expectations, not inferred
    # by running a parser or looking up the nearest PIR after encoding the file.
    record(0, 10, bytes([1 if big else 2, 4]))  # 1
    mir = struct.pack(order + "IIBcccHc", 1000, 2000, 3, b"P", b" ", b" ", 65535, b" ")
    mir += b"".join(cn(value) for value in ["GOLDEN-LOT", "DEMO-IC", "BENCH", "SYNTHETIC", "golden-v1"])
    record(1, 10, mir)  # 2
    metadata["1"] = {"CPU_TYPE": 1 if big else 2, "STDF_VER": 4}
    metadata["2"] = {"SETUP_T": 1000, "START_T": 2000, "LOT_ID": "GOLDEN-LOT", "JOB_NAM": "golden-v1"}

    named_tail = cn("VDD") + cn("") + struct.pack("Bbbb", 0, -3, -3, -3)
    named_tail += struct.pack(order + "ff", 0.5, 1.5) + cn("V")
    definitions.extend([
        [1, 77, "VDD", named_tail.hex()],
        [2, 77, None, ""],
        [3, 77, "", "00"],
        [4, 88, None, ""],
    ])
    record(5, 10, bytes([1, 2]), 3)  # 3
    ptr(1, 2, 3, 1, 77, (0x80, 1), 0x80000000, named_tail)  # 4: negative zero
    ptr(1, 2, 3, 1, 77, (0, 0), 0x7FC01234, named_tail)  # 5: NaN payload/repeated pair
    record(5, 10, bytes([2, 2]), 6)  # 6: same site, different head
    ptr(2, 2, 6, 2, 77, (0x40, 0), 0x7F800000, b"")  # 7: omitted name/+infinity
    ptr(1, 2, 3, 3, 77, (2, 0x80), 0xFF800000, cn(""))  # 8: empty name/-infinity

    mpr = struct.pack(order + "IBBBBHH", 88, 2, 2, 1, 2, 2, 2)
    mpr += bytes([0x21]) + struct.pack(order + "ff", 0.25, 0.75) + cn("ARRAY") + cn("")
    record(15, 15, mpr, 6)  # 9: raw-only multi-result record
    record(15, 20, struct.pack(order + "IBBBB", 99, 1, 2, 0x80, 0xFF), 3)  # 10: raw-only functional record
    prr(6, 2, 2, 8, 2, 3, 9, 2, -3, 22, "PART-B", "second head")  # 11
    prr(3, 1, 2, 0x88, 4, 1, 2, -1, 4, 33, "PART-A", "first attempt")  # 12
    record(5, 10, bytes([1, 2]), 13)  # 13: repeated part/site gets new attempt ID
    ptr(1, 2, 13, 1, 77, (0, 0), 0x3DCCCCCD, named_tail)  # 14: exact f32 0.1
    ptr(1, 2, 13, 4, 88, (2, 0), 0x3FA00000, b"")  # 15: another test number
    prr(13, 1, 2, 0, 2, 1, 2, -1, 4, 44, "PART-A", "repeat attempt")  # 16
    record(180, 99, bytes.fromhex("deadbeef0010203040"))  # 17: indexed unknown record
    record(1, 20, struct.pack(order + "Ic", 3456, b" ") + cn("complete") + cn(""))  # 18
    metadata["18"] = {"FINISH_T": 3456, "DISP_COD": " ", "USR_DESC": "complete", "EXC_DESC": ""}

    assert len(records) == 18 and len(measurements) == 6 and len(devices) == 3
    assert [row[0] for row in devices] == [6, 3, 13]
    assert [row[0] for row in measurements] == [4, 5, 7, 8, 14, 15]
    encoded = bytes(output)
    expected = {
        "byteOrder": "big" if big else "little",
        "sourceBytes": len(encoded),
        "sourceSha256": hashlib.sha256(encoded).hexdigest(),
        "counts": {"records": 18, "measurements": 6, "devices": 3, "definitions": 4},
        "records": records,
        "measurements": measurements,
        "devices": devices,
        "definitions": definitions,
        "decodedMetadataSubset": metadata,
        "indexedOnlyCounts": {"15/15": 1, "15/20": 1, "180/99": 1},
    }
    return encoded, expected


def main() -> None:
    repository = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", type=Path, default=repository / ".venv/library-fixtures")
    output = parser.parse_args().output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    expected = {"formatVersion": 1, "files": {}, "invalidFiles": {}}
    for big in [False, True]:
        data, golden = make_golden(big)
        name = f"golden-{'big' if big else 'little'}.stdf"
        (output / name).write_bytes(data)
        expected["files"][name] = golden
        if not big:
            unmatched = bytearray(data)
            # PTR seq 7's SITE_NUM is byte 5 of its body, following the 4-byte header.
            unmatched[golden["records"][6][1] + 9] = 7
            invalid = {
                "missing-mrr.stdf": (data[:golden["records"][-1][1]], "Missing final MRR"),
                "truncated.stdf": (data[:-1], "Final MRR payload truncated"),
                "unmatched-site.stdf": (bytes(unmatched), "PTR head 2/site 7 has no matching open PIR"),
                "trailing.stdf": (data + b"\x00", "A byte follows the final MRR"),
            }
            for invalid_name, (invalid_bytes, reason) in invalid.items():
                (output / invalid_name).write_bytes(invalid_bytes)
                expected["invalidFiles"][invalid_name] = {"reason": reason, "sourceBytes": len(invalid_bytes)}
    (output / "expected.json").write_text(json.dumps(expected, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "validFiles": list(expected["files"]), "invalidFiles": list(expected["invalidFiles"]),
                      "countsPerValidFile": {"records": 18, "measurements": 6, "devices": 3, "definitions": 4}}, indent=2))


if __name__ == "__main__":
    main()
