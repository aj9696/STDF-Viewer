"""Small independent STDF V4 byte fixtures for device-only yield summaries."""
from pathlib import Path
import struct
import sys


class Source:
    def __init__(self, big=False, **header):
        self.order = ">" if big else "<"
        self.data = bytearray()
        self.record(0, 10, bytes([1 if big else 2, 4]))
        self.header(**header)

    def pack(self, fmt, *values):
        return struct.pack(self.order + fmt, *values)

    @staticmethod
    def cn(value):
        encoded = value.encode("ascii")
        return bytes([len(encoded)]) + encoded

    def record(self, kind, subtype, body):
        self.data += self.pack("HBB", len(body), kind, subtype) + body

    def header(self, lot="LOT-7", product="PRODUCT-A", program="FINAL", revision="R1", sublot="S1", start=1792368000):
        values = [lot, product, "TESTER-1", "ATE", program, revision, sublot,
                  "OPERATOR", "EXEC", "1", "FT", "25", "", "", "QFN", "FAMILY",
                  "", "FAB", "FLOOR", "", "", "", "", "PRODUCTION"]
        self.record(1, 10, self.pack("IIBcccHc", start, start, 1, b"P", b" ", b" ", 0, b" ") + b"".join(self.cn(value) for value in values))

    def device(self, part, head=1, site=1, flags=0, soft=1, hard=1):
        self.record(5, 10, bytes([head, site]))
        self.record(5, 20, self.pack("BBBHHHhhI", head, site, flags, 0, hard, soft, -32768, -32768, 100) + self.cn(part) + self.cn(""))

    def save(self, destination, finish=1792368060):
        self.record(1, 20, self.pack("I", finish) + b" " + self.cn("") + self.cn(""))
        destination.write_bytes(self.data)


def main(directory):
    directory.mkdir(parents=True, exist_ok=True)
    for big in (False, True):
        source = Source(big)
        for part, head, site, flags, soft, hard in [
            ("A", 1, 1, 8, 10, 2), ("B", 1, 1, 0, 1, 1),
            ("C", 1, 2, 8, 20, 2), ("D", 2, 1, 16, 65535, 65535),
            ("E", 2, 1, 4, 4, 4), ("F", 1, 2, 8, 65535, 65535),
            ("G", 1, 1, 0, 1, 1),
        ]:
            source.device(part, head, site, flags, soft, hard)
        source.save(directory / f"original-{'big' if big else 'little'}.stdf")
    source = Source(start=1792454400)
    source.device("A", flags=1)
    source.device("H", site=2, flags=8, soft=20, hard=2)
    source.save(directory / "retest.stdf", finish=1792454460)
    source = Source(product="PRODUCT-B", program="PROBE", revision="R2", sublot="S2")
    source.device("J")
    source.save(directory / "other-product.stdf")
    source = Source(lot="", start=0)
    source.device("UNKNOWN", flags=16, soft=65535, hard=65535)
    source.save(directory / "undated.stdf", finish=0)
    source = Source(sublot="S2")
    source.device("A", flags=1)
    source.save(directory / "other-sublot.stdf")
    source = Source()
    source.device("FIRST")
    source.header(lot="SECOND-HEADER", product="OTHER", start=1792540800)
    source.device("SECOND")
    source.save(directory / "multiple-headers.stdf", finish=1792540860)
    source = Source()
    for index in range(5003):
        source.device(f"DEVICE-{index}", site=1 + index % 2)
    source.save(directory / "many-devices.stdf")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
