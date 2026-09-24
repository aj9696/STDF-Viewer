"""Small correctness checks for the performance-fixture and report tooling."""

from contextlib import closing
import gzip
from pathlib import Path
import shutil
import sqlite3
import tempfile
import unittest
import uuid

from .generate import generate
from .ingestion import benchmark, logical_sample
from semidata.library import Library


class BenchmarkToolsTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.gettempdir()) / f"semidata-benchmark-tests-{uuid.uuid4().hex}"
        self.root.mkdir()
        self.addCleanup(shutil.rmtree, self.root)

    def test_generator_is_repeatable_and_compression_preserves_records(self):
        raw = generate(self.root / "first.stdf", 33, 5)
        repeated = generate(self.root / "second.stdf", 33, 5)
        compressed = generate(self.root / "compressed.gz", 33, 5, compressed=True)
        self.assertEqual(raw["sha256"], repeated["sha256"])
        self.assertEqual(raw["sha256"], compressed["uncompressed_sha256"])
        self.assertEqual(gzip.decompress(Path(compressed["path"]).read_bytes()), Path(raw["path"]).read_bytes())
        library = Library(self.root / "library")
        dataset = library.import_file(raw["path"])["dataset"]
        self.assertEqual((dataset["dut_count"], dataset["test_count"], dataset["measurements"], dataset["pass_count"]),
                         (33, 5, 165, 32))
        with self.assertRaises(FileExistsError):
            generate(Path(raw["path"]), 33, 5)

    def test_retest_fixtures_supersede_previous_attempts(self):
        for mode in ("part", "die"):
            with self.subTest(mode=mode):
                source = self.root / f"retest-{mode}.stdf"
                generate(source, 2050, 3, retest=mode)
                library = Library(self.root / mode)
                dataset = library.import_file(source)["dataset"]
                self.assertEqual(dataset["dut_count"], 4100)
                self.assertEqual(dataset["measurements"], 12300)
                with closing(sqlite3.connect(library.database_path(dataset["id"]))) as connection:
                    self.assertEqual(connection.execute("SELECT Supersede,COUNT(*) FROM Dut_Info GROUP BY Supersede").fetchall(),
                                     [(0, 2050), (1, 2050)])

    def test_report_times_reconcile_and_sample_detects_numeric_change(self):
        source = self.root / "source.stdf"
        generate(source, 40, 3)
        report = benchmark(source, self.root / "benchmark", "test")
        phases = report["phases"]
        accounted = sum(phases[key] for key in ("snapshot_hash_and_lock_seconds", "preflight_normalization_seconds",
                        "native_parser_database_seconds", "integrity_metadata_counts_seconds", "publication_other_seconds"))
        self.assertAlmostEqual(accounted, report["full_import_seconds"], places=8)
        self.assertGreater(report["memory_after"]["peak_rss_bytes"], 0)
        database = Path(report["workspace"]) / "imports" / report["dataset"]["id"] / "source.db"
        previous = report["logical_sample"]["sha256"]
        with closing(sqlite3.connect(database)) as connection, connection:
            connection.execute("UPDATE PTR_Data SET RESULT=RESULT+0.1 WHERE DUTIndex=1")
        self.assertNotEqual(logical_sample(database)["sha256"], previous)


if __name__ == "__main__":
    unittest.main()
