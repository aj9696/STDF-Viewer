"""Independent per-lot reference and cross-source retirement fixtures."""
from pathlib import Path
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("populations", Path(__file__).with_name("make-viewer-populations.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def main(directory):
    directory.mkdir(parents=True, exist_ok=True)
    for lot, center in [("A", 0), ("B", 100)]:
        source = module.Source()
        for index, value in enumerate([-1, 0, 1] * 10 + [20]):
            attempt = source.begin(1, 1, f"{lot}-{index}")
            source.ptr(attempt, 101, center + value, high=500)
            source.end(attempt)
        attempt = source.begin(1, 1, "RETESTED")
        source.ptr(attempt, 101, 50 if lot == "A" else 100, high=500)
        source.end(attempt, flags=0 if lot == "A" else 1)
        if lot == "A":
            for name, head, site, part_flags, final_invalid in [("OTHER_SITE", 2, 2, 0, False), ("INVALID_FINAL", 1, 1, 0, True), ("ORIGINAL_FAIL", 1, 1, 8, False), ("UNKNOWN", 1, 1, 16, False)]:
                attempt = source.begin(head, site, name)
                source.ptr(attempt, 101, 200, high=500)
                if final_invalid:
                    source.ptr(attempt, 101, 999, flag=2, high=500)
                source.end(attempt, flags=part_flags)
        source.save(directory / f"pat-lot-{lot}.stdf")
    short = module.Source()
    for index in range(15):
        attempt = short.begin(1, 1, f"SHORT-{index}")
        short.ptr(attempt, 101, index, high=500)
        short.end(attempt)
    short.save(directory / "pat-short.stdf")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
