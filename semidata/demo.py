"""Deterministic STDF V4 fixtures for automated checks and first exploration.

These compact synthetic lots supplement externally generated evaluation data;
they are not a realistic qualification corpus or a performance benchmark.
"""

from pathlib import Path
import random
import struct


def _text(value: str) -> bytes:
    encoded = value.encode("ascii")
    return bytes([len(encoded)]) + encoded


def _record(kind: int, subtype: int, payload: bytes) -> bytes:
    return struct.pack("<HBB", len(payload), kind, subtype) + payload


def create_demo_files(directory: Path) -> list[Path]:
    """Write three repeatable 120-DUT lots with three PTR tests on two sites.

    Lot 1 is the baseline. Lot 2 shifts VDD; lot 3 introduces a site offset and
    isolated passing-specification outliers. PRR bit 3 and PTR bit 7 mark fails.
    PTR result/limit scales are zero, so stored values use their stated units.
    """
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    paths = []
    tests = [(1001, "VDD", "V", 0.85, 1.15),
             (1002, "IDD", "mA", 5.0, 15.0),
             (1003, "Frequency", "MHz", 90.0, 110.0)]
    for lot in range(3):
        rng = random.Random(7400 + lot)
        start = 1_790_000_000 + lot * 86400
        records = [_record(0, 10, bytes([2, 4]))]  # little endian, STDF V4
        mir = struct.pack("<IIBcccHc", start - 60, start, 1,
                          b"P", b" ", b" ", 0, b" ")
        fields = [f"DEMO-{lot + 1:03}", "SD-DEMO-1", "SYNTHETIC",
                  "Demo ATE", "demo-v1", "1.0", "", "Demo", "", "",
                  "CP", "25", "Synthetic evaluation data"]
        records.append(_record(1, 10, mir + b"".join(map(_text, fields))))
        records.append(_record(2, 10, struct.pack("<BBI", 1, 1, start)
                               + _text(f"W{lot + 1:02}")))
        good = 0
        for index in range(120):
            site = index % 2 + 1
            values = [rng.gauss(1.0, 0.012) + lot * 0.010,
                      rng.gauss(10.0, 0.35), rng.gauss(100.0, 0.8)]
            if lot == 2 and site == 2:
                values[0] += 0.018
            if lot == 2 and index in (17, 61, 103):
                values[0] = 1.11 + (index % 3) * 0.005
                values[1] = 13.7
            if index == 119 and lot > 0:
                values[2] = 113.0
            records.append(_record(5, 10, bytes([1, site])))
            failed = False
            for (number, name, unit, low, high), value in zip(tests, values):
                fail = not low <= value <= high
                failed |= fail
                ptr = struct.pack("<IBBBBf", number, 1, site, 128 if fail else 0, 0, value)
                ptr += _text(name) + _text("")
                ptr += struct.pack("<Bbbbff", 0, 0, 0, 0, low, high)
                ptr += _text(unit) + _text("") * 3 + struct.pack("<ff", low, high)
                records.append(_record(15, 10, ptr))
            good += not failed
            prr = struct.pack("<BBBHHHhhI", 1, site, 8 if failed else 0, 3,
                              2 if failed else 1, 2 if failed else 1,
                              index % 12, index // 12, 30)
            prr += _text(f"D{index + 1:04}") + _text("") + b"\0"
            records.append(_record(5, 20, prr))
        wrr = struct.pack("<BBIIIIII", 1, 1, start + 120, 120, 0, 0, good, 120)
        records.append(_record(2, 20, wrr + _text(f"W{lot + 1:02}")))
        records.append(_record(1, 20, struct.pack("<Ic", start + 120, b" ") + b"\0\0"))
        path = directory / f"semidata-demo-lot-{lot + 1:02}.stdf"
        path.write_bytes(b"".join(records))
        paths.append(path)
    return paths
