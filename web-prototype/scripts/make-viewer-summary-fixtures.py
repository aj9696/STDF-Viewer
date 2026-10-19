"""Small STDF sources for the statistics batch boundary and identity checks."""
from pathlib import Path
import runpy
import sys

Source = runpy.run_path(str(Path(__file__).with_name("make-viewer-populations.py")))["Source"]
directory = Path(sys.argv[1])
directory.mkdir(parents=True, exist_ok=True)

source = Source()
attempt = source.begin(1, 1, "MANY_TESTS")
for number in range(1000, 1036):
    source.ptr(attempt, number, number - 1000)
source.end(attempt)
source.save(directory / "many-tests.stdf")

for name, value in [("a", 17), ("b", 23)]:
    source = Source()
    attempt = source.begin(1, 1, "UNRESOLVED")
    source.ptr(attempt, 707, value, compact=True)
    source.end(attempt)
    source.save(directory / f"unresolved-{name}.stdf")

source = Source()
for site in range(1, 66):
    attempt = source.begin(1, site, f"SITE_{site}")
    source.ptr(attempt, 101, site)
    source.end(attempt)
source.save(directory / "many-series.stdf")
