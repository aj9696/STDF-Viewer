"""Independent compact STDF fixtures for browser Test Explorer query/UI checks.

Uses only Python's standard library and the existing independent STDF golden
generator. Expected rows are recorded while encoding, never read from app code.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import struct
from pathlib import Path


FIELDS = ["TEST_TXT", "ALARM_ID", "OPT_FLAG", "RES_SCAL", "LLM_SCAL", "HLM_SCAL",
          "LO_LIMIT", "HI_LIMIT", "UNITS", "C_RESFMT", "C_LLMFMT", "C_HLMFMT", "LO_SPEC", "HI_SPEC"]
MEASUREMENT_FIELDS = ["seq", "device_id", "definition_id", "test_number", "head", "site",
                      "test_flags", "parm_flags", "result_bits", "result"]
DEVICE_FIELDS = ["id", "head", "site", "prr_seq", "part_flags", "num_tests", "hard_bin",
                 "soft_bin", "x", "y", "test_time", "part_id", "part_text"]


def cn(value):
    encoded = value.encode("utf-8")
    if len(encoded) > 255:
        raise ValueError("Fixture Cn exceeds 255 bytes")
    return bytes([len(encoded)]) + encoded


def f32(bits):
    value = struct.unpack("<f", struct.pack("<I", bits))[0]
    return value if math.isfinite(value) else None


def declaration(name, units, index, order, special=False):
    metadata = dict.fromkeys(FIELDS)
    metadata.update(TEST_TXT=name, ALARM_ID="", OPT_FLAG=[255 if special else 0],
                    RES_SCAL=-3, LLM_SCAL=-2 if special else -3,
                    HLM_SCAL=3 if special else -3, UNITS=units)
    low_bits = 0x7FC01234 if special else struct.unpack("<I", struct.pack("<f", index + 0.5))[0]
    high_bits = 0x80000000 if special else struct.unpack("<I", struct.pack("<f", index + 1.5))[0]
    metadata.update(LO_LIMIT=f32(low_bits), HI_LIMIT=f32(high_bits),
                    LO_LIMIT_BITS=low_bits, HI_LIMIT_BITS=high_bits)
    tail = cn(name) + cn("") + struct.pack("Bbbb", *metadata["OPT_FLAG"], metadata["RES_SCAL"],
                                          metadata["LLM_SCAL"], metadata["HLM_SCAL"])
    tail += struct.pack(order + "II", low_bits, high_bits) + cn(units)
    if special:
        tail += cn("") * 3 + struct.pack(order + "II", 0x7F800000, 0xFF800000)
        metadata.update(C_RESFMT="", C_LLMFMT="", C_HLMFMT="", LO_SPEC=None, HI_SPEC=None,
                        LO_SPEC_BITS=0x7F800000, HI_SPEC_BITS=0xFF800000)
    metadata["PRESENT_FIELDS"] = FIELDS[:] if special else FIELDS[:9]
    metadata["RAW_TAIL_HEX"] = tail.hex()
    return tail, metadata


class Fixture:
    def __init__(self, big):
        self.order = ">" if big else "<"
        self.byte_order = "big" if big else "little"
        self.output = bytearray()
        self.records = []
        self.definitions = []
        self.measurements = []
        self.devices = []

    def record(self, typ, sub, body, device_id=None):
        seq = len(self.records) + 1
        encoded = struct.pack(self.order + "HBB", len(body), typ, sub) + body
        self.records.append([seq, len(self.output), len(encoded), typ, sub, device_id])
        self.output.extend(encoded)
        return seq

    def pir(self, head, site):
        seq = len(self.records) + 1
        return self.record(5, 10, bytes([head, site]), seq)

    def prr(self, device, head, site, part, tests):
        fields = [device, head, site, len(self.records) + 1, 0x88, tests, 3, 9, -1, 4, 99, part, "attempt"]
        body = struct.pack(self.order + "BBBHHHhhI", head, site, 0x88, tests, 3, 9, -1, 4, 99)
        self.record(5, 20, body + cn(part) + cn("attempt") + b"\0", device)
        self.devices.append(dict(zip(DEVICE_FIELDS, fields)))

    def ptr(self, number, device, head, site, definition, tail, bits, flags=(0, 0)):
        seq = self.record(15, 10, struct.pack(self.order + "IBBBBI", number, head, site, *flags, bits) + tail, device)
        self.measurements.append(dict(zip(MEASUREMENT_FIELDS,
            [seq, device, definition, number, head, site, *flags, bits, f32(bits)])))

    def result(self):
        source = bytes(self.output)
        devices = {row["id"]: row for row in self.devices}
        for row in self.measurements:
            for key in ["part_id", "hard_bin", "soft_bin", "part_flags"]:
                row[key] = devices[row["device_id"]][key]
        groups = []
        for number in sorted({row["test_number"] for row in self.definitions}):
            definitions = [row for row in self.definitions if row["test_number"] == number]
            names = sorted(row["name"] for row in definitions if row["name"])
            groups.append({"test_number": number, "name": names[0] if names else None,
                           "definition_count": len(definitions)})
        return source, {"sourceBytes": len(source), "sourceSha256": hashlib.sha256(source).hexdigest(),
            "byteOrder": self.byte_order, "counts": {"records": len(self.records), "measurements": len(self.measurements),
            "devices": len(self.devices), "definitions": len(self.definitions)}, "groups": groups,
            "definitions": self.definitions, "measurements": self.measurements, "devices": self.devices}


def make_fixture(big, golden_generator):
    fixture = Fixture(big)
    original, golden = golden_generator.make_golden(big)
    fixture.output.extend(original[:golden["records"][-1][1]])
    fixture.records = golden["records"][:-1]
    fixture.measurements = [dict(zip(MEASUREMENT_FIELDS, row)) for row in golden["measurements"]]
    fixture.devices = [dict(zip(DEVICE_FIELDS, row)) for row in golden["devices"]]
    named_tail, named_metadata = declaration("VDD", "V", 0, fixture.order)
    assert named_tail.hex() == golden["definitions"][0][3]
    for identifier, number, name, raw_tail in golden["definitions"]:
        metadata = dict.fromkeys(FIELDS)
        metadata.update(PRESENT_FIELDS=["TEST_TXT"] if name == "" else [], RAW_TAIL_HEX=raw_tail)
        if name == "":
            metadata["TEST_TXT"] = ""
        if identifier == 1:
            metadata = named_metadata
        fixture.definitions.append({"id": identifier, "test_number": number, "name": name, "metadata": metadata})

    device = fixture.pir(1, 2)
    for number in [0, *range(1, 55), 4294967295]:
        name = f"Test {number:03}"
        tail, metadata = declaration(name, "A", 0, fixture.order)
        identifier = len(fixture.definitions) + 1
        fixture.definitions.append({"id": identifier, "test_number": number, "name": name, "metadata": metadata})
        fixture.ptr(number, device, 1, 2, identifier, tail, 0x3F800000)
    fixture.prr(device, 1, 2, "SAME-PART", 56)

    variants = []
    for index in range(60):
        name = ["<svg onload=alert(1)>", "literal %_ ' OR 1=1 --", "VDD", "\u03bcCurrent"][index] if index < 4 else f"VDD variant {index:02}"
        tail, metadata = declaration(name, "mV" if index % 2 else "V", index, fixture.order, special=index == 0)
        identifier = len(fixture.definitions) + 1
        fixture.definitions.append({"id": identifier, "test_number": 77, "name": name, "metadata": metadata})
        variants.append((identifier, tail))
    for attempt in range(3):
        head = 1 if attempt != 1 else 2
        device = fixture.pir(head, 2)
        for index in range(50):
            offset = attempt * 50 + index
            identifier, tail = variants[offset % len(variants)]
            bits = [0x80000000, 0x7FC01234, 0x7F800000, 0xFF800000, 0x3DCCCCCD][offset % 5]
            fixture.ptr(77, device, head, 2, identifier, tail, bits, (offset % 256, (offset * 3) % 256))
            if offset % 7 == 0:
                fixture.record(180, 99, b"gap")
        fixture.prr(device, head, 2, "SAME-PART", 50)
    fixture.record(1, 20, struct.pack(fixture.order + "I", 9999))
    assert len(fixture.definitions) == 120
    assert len([row for row in fixture.measurements if row["test_number"] == 77]) == 155
    return fixture.result()


def make_no_ptr():
    fixture = Fixture(False)
    fixture.record(0, 10, bytes([2, 4]))
    fixture.record(1, 10, bytes(15))
    device = fixture.pir(1, 2)
    fixture.record(15, 15, struct.pack("<IBBBBHH", 12, 1, 2, 0, 0, 0, 0), device)
    fixture.record(15, 20, struct.pack("<IBBBB", 13, 1, 2, 0, 0), device)
    fixture.prr(device, 1, 2, "RAW-ONLY", 2)
    fixture.record(1, 20, struct.pack("<I", 9999))
    return fixture.result()


def main():
    repository = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", type=Path, default=repository / ".venv/explorer-fixtures")
    output = parser.parse_args().output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location("library_golden", Path(__file__).with_name("make-library-fixtures.py"))
    golden_generator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(golden_generator)
    files = {}
    for filename, (source, expected) in [
        ("explorer-little.stdf", make_fixture(False, golden_generator)),
        ("explorer-big.stdf", make_fixture(True, golden_generator)),
        ("explorer-no-ptr.stdf", make_no_ptr()),
    ]:
        (output / filename).write_bytes(source)
        files[filename] = expected
    (output / "expected.json").write_text(json.dumps({"formatVersion": 1, "files": files}, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "files": {name: {"sourceBytes": item["sourceBytes"], "counts": item["counts"]} for name, item in files.items()}}, indent=2))


if __name__ == "__main__":
    main()
