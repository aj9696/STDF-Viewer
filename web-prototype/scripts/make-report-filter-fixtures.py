"""Independent STDF bytes for outcome-filtered reports, including retests."""
from pathlib import Path
import importlib.util
import sys


def main(directory):
    directory.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location("population", Path(__file__).with_name("make-viewer-populations.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def source(name, rows):
        item = module.Source()
        item.record(50, 30, item.cn(f"FILE {name} before"))
        for part, head, site, flags, value, test_flags in rows:
            attempt = item.begin(head, site, part)
            item.ptr(attempt, 101, value, flag=test_flags)
            item.record(50, 30, item.cn(f"DEVICE {part}"))
            item.end(attempt, flags=flags, soft_bin=2 if flags == 8 or flags == 9 else 1)
        item.record(50, 30, item.cn(f"FILE {name} after"))
        # Original PCR facts must remain original when the report filters devices.
        item.record(1, 30, item.pack("BBIIIII", 255, 255, len(rows), 0, 0, 1234, 0))
        item.save(directory / f"{name}.stdf")

    source("base", [
        ("A", 1, 1, 0, 1, 0),
        ("KEEP_PASS", 1, 1, 0, 2, 128),
        ("FAIL", 1, 1, 8, 100, 0),
        ("UNKNOWN", 1, 1, 16, 4, 0),
        ("UNKNOWN_INVALID", 1, 1, 4, 6, 0),
        ("UNKNOWN_FAIL_BIT", 1, 1, 24, 8, 0),
        ("OTHER_SITE", 1, 2, 0, 20, 0),
        ("OTHER_HEAD", 2, 1, 0, 30, 0),
    ])
    source("retest", [("A", 1, 1, 9, 200, 0)])
    source("only-fail", [("ONLY_FAIL", 1, 1, 8, 1001, 0)])


if __name__ == "__main__":
    main(Path(sys.argv[1]))
