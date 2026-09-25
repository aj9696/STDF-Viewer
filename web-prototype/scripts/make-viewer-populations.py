"""Independent STDF bytes and analytical oracles (Python standard library only)."""
from pathlib import Path
import json
import math
import statistics
import struct
import sys


class Source:
    def __init__(self, big=False):
        self.order = ">" if big else "<"
        self.data = bytearray()
        self.seq = 0
        self.attempts = []
        self.record(0, 10, bytes([1 if big else 2, 4]))
        self.record(1, 10, bytes(15))
        self.record(2, 30, self.pack("fffBc hhcc", 200, 1, 1, 3, b"D", 0, 0, b"R", b"U"))
        self.wafer = self.record(2, 10, self.pack("BBI", 1, 1, 100) + self.cn("WAFER"))

    def pack(self, fmt, *args):
        return struct.pack(self.order + fmt.replace(" ", ""), *args)

    @staticmethod
    def cn(value):
        value = value.encode("ascii")
        return bytes([len(value)]) + value

    def record(self, kind, subtype, body):
        self.seq += 1
        self.data.extend(self.pack("HBB", len(body), kind, subtype) + body)
        return self.seq

    def begin(self, head, site, part):
        attempt = {"id": self.record(5, 10, bytes([head, site])), "head": head, "site": site, "part": part, "measurements": []}
        self.attempts.append(attempt)
        return attempt

    def ptr(self, attempt, number, value, flag=0, high=10, compact=False):
        bits = 0x7FC01234 if math.isnan(value) else struct.unpack("<I", struct.pack("<f", value))[0]
        body = self.pack("IBBBBI", number, attempt["head"], attempt["site"], flag, 0, bits)
        if not compact:
            body += self.cn({101: "MAIN", 202: "EXTRA", 203: "ONLY_B", 404: "EDGE"}.get(number, "CANCEL")) + b"\0"
            body += self.pack("Bbbbff", 0, 6, 3, 9, 0, high) + self.cn("V")
        seq = self.record(15, 10, body)
        attempt["measurements"].append({"seq": seq, "number": number, "value": None if math.isnan(value) else value, "flag": flag, "bits": bits})

    def end(self, attempt, flags=0, soft_bin=3):
        body = self.pack("BBBH H H h h I", attempt["head"], attempt["site"], flags,
                         len(attempt["measurements"]), 2, soft_bin, 12, 4, 100)
        body += self.cn(attempt["part"]) + self.cn("")
        attempt["prr"] = self.record(5, 20, body)

    def save(self, destination):
        self.record(1, 20, bytes(4))
        destination.write_bytes(self.data)
        return {"records": self.seq, "bytes": len(self.data), "attempts": self.attempts, "wafer": self.wafer}


def main(directory):
    directory.mkdir(parents=True, exist_ok=True)
    expected = {"files": {}}
    for big in (False, True):
        label = "big" if big else "little"
        source = Source(big)
        a = source.begin(1, 1, "A")
        b = source.begin(1, 2, "B")
        source.ptr(a, 101, 0)
        source.ptr(b, 101, 4)
        source.ptr(a, 101, 2, compact=True)
        source.ptr(a, 202, 9)
        source.ptr(b, 203, 42)
        source.end(b)  # Completion ordering must not change PIR attempt indexes.
        source.end(a)
        for head, site, part, value, flag in [(2, 1, "C", 6, 64), (1, 1, "D", 8, 128), (1, 1, "E", 10, 0)]:
            attempt = source.begin(head, site, part)
            source.ptr(attempt, 101, value, flag, high=9 if part == "E" else 10)
            if part == "C": source.ptr(attempt, 202, 7)
            if part == "D": source.ptr(attempt, 202, float("nan"), 2)
            if part == "E":
                source.ptr(attempt, 101, 999, 2, compact=True)
                source.ptr(attempt, 101, float("nan"), compact=True)
            source.end(attempt)
        name = f"population-{label}.stdf"
        expected["files"][name] = source.save(directory / name)
        source = Source(big)
        for part, value in [("MIN", -20), ("EDGE", 23.5), ("MAX", 55)]:
            attempt = source.begin(1, 1, part)
            source.ptr(attempt, 404, value, high=60)
            source.end(attempt)
        name = f"histogram-edge-{label}.stdf"
        expected["files"][name] = source.save(directory / name)
        source = Source(big)
        a = source.begin(1, 1, "STARTED_FIRST_FINISHED_LAST")
        b = source.begin(1, 2, "STARTED_LAST_FINISHED_FIRST")
        source.ptr(a, 101, 1)
        source.ptr(b, 101, 2)
        source.end(b, soft_bin=7)
        source.end(a, soft_bin=3)
        name = f"wafer-order-{label}.stdf"
        expected["files"][name] = {**source.save(directory / name), "lastDeviceId": a["id"], "lastBin": 3}
    source = Source()
    attempt = source.begin(1, 1, "A")
    source.ptr(attempt, 101, 20)
    source.end(attempt, 1)
    expected["files"]["retest.stdf"] = source.save(directory / "retest.stdf")
    source = Source()
    attempt = source.begin(1, 1, "CANCEL")
    for i in range(20000): source.ptr(attempt, 999, i % 11, compact=i != 0)
    source.end(attempt)
    # Avoid a large oracle; the qualification only needs count for this workload.
    cancel = source.save(directory / "cancel.stdf")
    expected["files"]["cancel.stdf"] = {"records": cancel["records"], "observations": 20000}
    source = Source()
    declaration = {"head": 1, "site": 1, "measurements": []}
    source.ptr(declaration, 101, 0, flag=16)
    attempt = source.begin(1, 1, "DEFAULTS")
    source.ptr(attempt, 101, 1, compact=True)
    source.end(attempt)
    expected["files"]["defaults-only.stdf"] = source.save(directory / "defaults-only.stdf")
    source = Source()
    for i in range(5003):
        attempt = source.begin(1 + i % 2, 1 + i % 4, f"ROW-{i:05d}")
        source.ptr(attempt, 101, i % 11, compact=i != 0)
        if i % 17 == 0:
            source.ptr(attempt, 101, 100 + i % 11, compact=True)
        if i % 3 == 0:
            source.ptr(attempt, 202, i % 7, compact=i != 0)
        source.end(attempt)
    large = source.save(directory / "report-pages.stdf")
    expected["files"]["report-pages.stdf"] = {"devices": 5003, "records": large["records"], "bytes": large["bytes"],
        "mainObservations": 5003 + len(range(0, 5003, 17)), "extraObservations": len(range(0, 5003, 3))}
    for name, values in {"all": [0, 2, 4, 6, 8, 10], "head1": [0, 2, 4, 8, 10],
                         "head1site1": [0, 2, 8, 10], "mergedCurrent": [4, 6, 8, 10, 20],
                         "mergedHead1": [4, 8, 10, 20]}.items():
        expected[name] = {"values": values, "mean": statistics.mean(values), "median": statistics.median(values),
                          "stdev": statistics.pstdev(values)}
    (directory / "expected.json").write_text(json.dumps(expected, indent=2), encoding="utf8")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
