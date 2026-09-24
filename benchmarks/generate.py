"""Write bounded-memory synthetic STDF V4 with repeated per-DUT metadata."""

import argparse
from contextlib import ExitStack
import gzip
import hashlib
import json
from pathlib import Path
import random
import struct
import time

from semidata.demo import _record, _text


def sha256_file(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def generate(path: Path, duts: int, tests: int, sites: int = 4,
             seed: int = 42, compressed: bool = False, retest: str = "none") -> dict:
    """Generate complete scalar data without retaining the lot in memory.

    Every PTR repeats test name, scales, limits, units, and formats, like many
    production streams. One DUT in 101 explicitly fails one test. Otherwise
    results are seeded Gaussian measurements, with a small deterministic site
    offset. Optional retest repeats every device while its wafer remains open,
    setting the PartID or die-coordinate supersession bit. No dynamic limits.
    """
    if not 1 <= duts <= 1_000_000 or not 1 <= tests <= 65535 or not 1 <= sites <= 254:
        raise ValueError("Require 1–1,000,000 DUTs, 1–65,535 tests, and 1–254 sites.")
    if retest not in ("none", "part", "die"):
        raise ValueError("Retest mode must be none, part, or die.")
    path = Path(path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise FileExistsError(f"Refusing to overwrite an existing fixture: {path}")
    temporary = path.with_name(path.name + ".partial")
    if temporary.exists():
        raise FileExistsError(f"Remove the earlier incomplete generator output first: {temporary}")
    started = time.perf_counter()
    random_values = random.Random(seed)
    templates, parameters = [], []
    definitions = [("V", 1.0, 0.012), ("mA", 10.0, 0.35),
                   ("MHz", 100.0, 0.8), ("ohm", 50.0, 0.5)]
    for index in range(tests):
        unit, center, spread = definitions[index % len(definitions)]
        low, high = center - 6 * spread, center + 6 * spread
        ptr = struct.pack("<IBBBBf", 1000 + index, 1, 1, 0, 0, center)
        ptr += _text(f"CORE_CHARACTERIZATION_PARAMETER_{index:05}") + _text("")
        ptr += struct.pack("<Bbbbff", 0, 0, 0, 0, low, high)
        ptr += _text(unit) + _text("%.6f") * 3 + struct.pack("<ff", low, high)
        templates.append(bytearray(_record(15, 10, ptr)))
        parameters.append((center, spread, high))
    raw_hash = hashlib.sha256()
    raw_bytes = 0
    start_time = 1_790_000_000
    wafer_size = 2048
    failing_test = min(7, tests - 1)
    passes = 1 if retest == "none" else 2
    attempts = duts * passes
    passed = 0
    with ExitStack() as stack:
        destination = stack.enter_context(temporary.open("xb"))
        output = (stack.enter_context(gzip.GzipFile(filename="", mode="wb", fileobj=destination,
                                                   compresslevel=6, mtime=0))
                  if compressed else destination)

        def write(data):
            nonlocal raw_bytes
            raw_hash.update(data)
            raw_bytes += len(data)
            output.write(data)

        write(_record(0, 10, b"\x02\x04"))
        mir = struct.pack("<IIBcccHc", start_time - 60, start_time, 1, b"P", b" ", b" ", 0, b" ")
        fields = [f"BENCH-{duts}D-{tests}T-S{seed}", "SD-BENCH-DEVICE", "SYNTHETIC",
                  "Four-site synthetic ATE", "bench-v1", "1.0", "", "Benchmark",
                  "", "", "CP", "25", "Deterministic performance fixture"]
        write(_record(1, 10, mir + b"".join(map(_text, fields))))
        for attempt in range(attempts):
            wafer_index = attempt // (wafer_size * passes)
            wafer_duts = min(wafer_size, duts - wafer_index * wafer_size)
            wafer_position = attempt - wafer_index * wafer_size * passes
            pass_index = wafer_position // wafer_duts
            device = wafer_index * wafer_size + wafer_position % wafer_duts
            wafer_id = f"W{wafer_index + 1:05}"
            if wafer_position == 0:
                wafer_passed = 0
                write(_record(2, 10, struct.pack("<BBI", 1, 1, start_time + attempt) + _text(wafer_id)))
            site = device % sites + 1
            failed = device % 101 == 0
            block = [bytearray(_record(5, 10, bytes([1, site])))]
            for index, (template, (center, spread, high)) in enumerate(zip(templates, parameters)):
                value = random_values.gauss(center, spread) + spread * (site - 1) * 0.05
                test_failed = failed and index == failing_test
                if test_failed:
                    value = high + spread
                template[9] = site
                template[10] = 128 if test_failed else 0
                struct.pack_into("<f", template, 12, value)
                block.append(template)
            # Join before reusing the template buffers for the next device.
            write(b"".join(block))
            passed += not failed
            wafer_passed += not failed
            coordinate = device % wafer_size
            supersession = (1 if retest == "part" else 2) if pass_index else 0
            prr = struct.pack("<BBBHHHhhI", 1, site, (8 if failed else 0) | supersession, tests,
                              2 if failed else 1, 2 if failed else 1,
                              coordinate % 64, coordinate // 64, tests)
            write(_record(5, 20, prr + _text(f"D{device + 1:09}") + b"\0\0"))
            if wafer_position + 1 == wafer_duts * passes:
                count = wafer_duts * passes
                wrr = struct.pack("<BBIIIIII", 1, 1, start_time + attempt + 1, count,
                                  wafer_duts if passes == 2 else 0, 0, wafer_passed, count)
                write(_record(2, 20, wrr + _text(wafer_id)))
        write(_record(1, 20, struct.pack("<Ic", start_time + attempts, b" ") + b"\0\0"))
    temporary.rename(path)
    result = {"generator_version": 1, "path": str(path), "duts": duts, "tests": tests,
              "sites": sites, "seed": seed, "dut_attempts": attempts, "retest": retest,
              "ptr_records": attempts * tests, "pass_count": passed,
              "compressed": compressed, "source_bytes": path.stat().st_size,
              "uncompressed_bytes": raw_bytes, "uncompressed_sha256": raw_hash.hexdigest(),
              "sha256": sha256_file(path), "generation_seconds": time.perf_counter() - started}
    path.with_name(path.name + ".json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--duts", type=int, default=10_000)
    parser.add_argument("--tests", type=int, default=100)
    parser.add_argument("--sites", type=int, default=4)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--gzip", action="store_true")
    parser.add_argument("--retest", choices=("none", "part", "die"), default="none")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    suffix = "" if args.retest == "none" else f"-retest-{args.retest}"
    path = args.output or Path(".venv/bench-data") / f"benchmark-{args.duts}d-{args.tests}t{suffix}.stdf{'.gz' if args.gzip else ''}"
    print(json.dumps(generate(path, args.duts, args.tests, args.sites, args.seed, args.gzip, args.retest), indent=2))


if __name__ == "__main__":
    main()
