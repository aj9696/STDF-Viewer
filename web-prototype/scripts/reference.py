"""Independent bounded raw-record oracle for small correctness fixtures.

Uses only Python struct; it does not import Rust or the product parser. This is
an intentionally straightforward correctness reference, not a speed contender.
"""
import json
import math
from pathlib import Path
import struct
import sys


def decode(raw):
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


def summarize(path):
    digest = 0xCBF29CE484222325

    def hashed(raw):
        nonlocal digest
        for value in raw:
            digest = ((digest ^ value) * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF

    def text_hashed(value):
        raw = value.encode("utf-8")
        hashed(struct.pack("<I", len(raw)))
        hashed(raw)

    counts, flags, defaults, groups = {}, {}, {}, {}
    records = ptr_count = byte_count = 0
    with Path(path).open("rb") as stream:
        first = stream.read(6)
        if first == bytes([2, 0, 0, 10, 2, 4]):
            endian, order = "<", "little"
        elif first == bytes([0, 2, 0, 10, 1, 4]):
            endian, order = ">", "big"
        else:
            raise ValueError("Expected IEEE STDF v4 FAR")
        stream.seek(0)
        while header := stream.read(4):
            if len(header) != 4:
                raise ValueError("Partial header")
            size, kind, sub = struct.unpack(endian + "HBB", header)
            body = stream.read(size)
            if len(body) != size:
                raise ValueError("Partial record body")
            byte_count += 4 + size
            records += 1
            key = f"{kind}/{sub}"
            counts[key] = counts.get(key, 0) + 1
            if (kind, sub) != (15, 10):
                continue
            number, head, site, test_flag, parm_flag, value = struct.unpack(endian + "IBBBBf", body[:12])
            bits = struct.unpack(endian + "I", body[8:12])[0]
            pos = 12

            def cn():
                nonlocal pos
                if pos == len(body):
                    return None
                length = body[pos]
                pos += 1
                raw = body[pos:pos + length]
                if len(raw) != length:
                    raise ValueError("Partial string")
                pos += length
                return decode(raw)

            def scalar(code):
                nonlocal pos
                if pos == len(body):
                    return None
                length = struct.calcsize(code)
                value = struct.unpack(endian + code, body[pos:pos + length])[0]
                pos += length
                return value

            name = cn()
            cn()  # ALARM_ID
            opt = scalar("B")
            scale = scalar("b")
            scalar("b")
            scalar("b")
            scalar("f")
            scalar("f")
            unit = cn()
            for _ in range(3):
                cn()
            scalar("f")
            scalar("f")
            if pos != len(body):
                raise ValueError("Trailing PTR bytes")
            if opt is None or opt & 1:
                scale = None
            default = defaults.setdefault(number, {"scale": scale or 0, "unit": unit or "", "names": set()})
            if name is None:
                if len(default["names"]) > 1:
                    raise ValueError("Ambiguous omitted test name")
                name = next(iter(default["names"]), "")
            default["names"].add(name)
            scale = default["scale"] if scale is None else scale
            unit = unit or default["unit"]
            hashed(struct.pack("<IBBBBI", number, head, site, test_flag, parm_flag, bits))
            text_hashed(name)
            text_hashed(unit)
            hashed(bytes([scale & 255]))
            flag = f"{test_flag:02x}/{parm_flag:02x}"
            flags[flag] = flags.get(flag, 0) + 1
            group = groups.setdefault((number, name, unit, scale), {"count": 0, "valid": 0, "failed_flag": 0, "unknown_pass_fail": 0, "mean": 0., "m2": 0., "min": 0., "max": 0.})
            group["count"] += 1
            group["failed_flag"] += bool(test_flag & 128)
            group["unknown_pass_fail"] += bool(test_flag & 64)
            if math.isfinite(value) and not test_flag & 0x3F and not parm_flag & 7:
                group["valid"] += 1
                if group["valid"] == 1:
                    group["min"] = group["max"] = value
                else:
                    group["min"] = min(value, group["min"])
                    group["max"] = max(value, group["max"])
                delta = value - group["mean"]
                group["mean"] += delta / group["valid"]
                group["m2"] += delta * (value - group["mean"])
            ptr_count += 1
    rows = []
    for (number, name, unit, scale), g in sorted(groups.items()):
        valid = g["valid"]
        rows.append({"number": number, "name": name, "unit": unit, "result_scale": scale,
                     "count": g["count"], "valid": valid, "excluded": g["count"] - valid,
                     "failed_flag": g["failed_flag"], "unknown_pass_fail": g["unknown_pass_fail"],
                     "mean_raw": g["mean"] if valid else None,
                     "stdev_raw": math.sqrt(g["m2"] / (valid - 1)) if valid > 1 else None,
                     "min_raw": g["min"] if valid else None, "max_raw": g["max"] if valid else None,
                     "mean_scaled": g["mean"] * 10**scale if valid else None,
                     "scaled_unit": unit if scale == 0 else f"10^{-scale} {unit}"})
    return {"byte_order": order, "bytes": byte_count, "records": records, "ptr_count": ptr_count,
            "record_counts": counts, "flag_counts": flags, "ptr_digest": f"{digest:016x}", "groups": rows,
            "has_mrr": "1/20" in counts}


if __name__ == "__main__":
    print(json.dumps(summarize(sys.argv[1]), allow_nan=False))
