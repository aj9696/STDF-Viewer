"""Small deterministic semantic fixtures; not performance workloads."""
from pathlib import Path
import struct
import sys


def make(directory):
    directory.mkdir(parents=True, exist_ok=True)
    for endian, label, cpu in [("<", "little", 2), (">", "big", 1)]:
        def record(kind, sub, body):
            return struct.pack(endian + "HBB", len(body), kind, sub) + body

        def ptr(value, test_flag=0, parm_flag=0, name="VDD", scale=3, unit="V", opt=2, compact=False):
            body = struct.pack(endian + "IBBBBf", 77, 1, 2, test_flag, parm_flag, value)
            if compact:
                return record(15, 10, body)
            body += bytes([len(name)]) + name.encode("ascii") + b"\0"
            body += struct.pack(endian + "Bbbbff", opt, scale, 0, 0, 0., 2.)
            body += bytes([len(unit)]) + unit.encode("ascii")
            return record(15, 10, body)

        raw = record(0, 10, bytes([cpu, 4]))
        raw += ptr(.125)
        raw += ptr(.25, test_flag=128)  # Valid failing result remains in summaries.
        raw += ptr(.375, compact=True)  # Omitted metadata uses preceding definition.
        raw += ptr(.5, test_flag=2)
        raw += ptr(.625, parm_flag=1)
        raw += ptr(float("nan"))
        raw += ptr(float("inf"))
        raw += ptr(.75, test_flag=64)  # Unknown pass/fail, otherwise valid.
        raw += ptr(.875, scale=6, opt=3)  # Invalid explicit scale inherits first.
        raw += ptr(1., scale=6)
        raw += ptr(1.125, name="")  # Explicitly empty name is not imputed.
        raw += ptr(1.25, unit="A")  # Distinct base units must not mix.
        raw += record(1, 20, b"\0" * 7)
        path = directory / f"semantic-{label}.stdf"
        path.write_bytes(raw)
        print(path)
    (directory / "truncated.stdf").write_bytes(raw[:-1])
    (directory / "not-stdf.stdf").write_bytes(b"This is not STDF.")


if __name__ == "__main__":
    make(Path(sys.argv[1]))
