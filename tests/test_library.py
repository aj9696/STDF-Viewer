"""Regression tests exercise the installed Rust parser, never a substitute."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
import bz2
import gzip
import hashlib
import shutil
import sqlite3
import struct
import tempfile
import unittest
import uuid
import zipfile

from semidata.demo import create_demo_files
from semidata.ingest import preflight
from semidata.library import Library


class LibraryTests(unittest.TestCase):
    def setUp(self):
        # Normal inherited directory permissions also work inside a restricted
        # Windows evaluation process (mkdtemp's mode 0700 does not).
        self.root = Path(tempfile.gettempdir()) / f"semidata-tests-{uuid.uuid4().hex}"
        self.root.mkdir()
        self.addCleanup(shutil.rmtree, self.root)
        self.files = create_demo_files(self.root / "fixtures")
        self.library = Library(self.root / "workspace")

    def test_real_parser_counts_metadata_and_snapshot(self):
        imported = self.library.import_file(self.files[0])
        dataset = imported["dataset"]
        self.assertFalse(imported["duplicate"])
        self.assertEqual((dataset["dut_count"], dataset["test_count"], dataset["measurements"]), (120, 3, 360))
        self.assertEqual(dataset["pass_count"], 120)
        self.assertEqual(dataset["lot"], "DEMO-001")
        self.assertEqual(dataset["product"], "SD-DEMO-1")
        self.assertEqual(dataset["started_at"], "2026-09-21T14:13:20+00:00")
        snapshot = self.library.imports / dataset["id"] / "source.stdf"
        original = self.files[0].read_bytes()
        self.assertEqual(snapshot.read_bytes(), original)
        self.assertEqual(dataset["sha256"], hashlib.sha256(original).hexdigest())
        self.files[0].write_bytes(b"modified external file")
        self.assertEqual(snapshot.read_bytes(), original)
        with closing(sqlite3.connect(self.library.database_path(dataset["id"]))) as connection:
            self.assertEqual(connection.execute("SELECT Filename FROM File_List").fetchone()[0], str(snapshot))
            self.assertEqual(connection.execute("SELECT DISTINCT SITE_NUM FROM Dut_Info ORDER BY SITE_NUM").fetchall(), [(1,), (2,)])

    def test_deduplication_survives_reopen_and_rename(self):
        first = self.library.import_file(self.files[0])["dataset"]
        renamed = self.root / "renamed.stdf"
        shutil.copyfile(self.files[0], renamed)
        reopened = Library(self.library.workspace)
        duplicate = reopened.import_file(renamed)
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(first, duplicate["dataset"])
        self.assertEqual(reopened.list_datasets(), [first])
        self.assertEqual(reopened.dataset(first["id"]), first)
        self.assertEqual(len(list(reopened.imports.iterdir())), 1)

    def test_concurrent_imports_publish_one_dataset(self):
        other = Library(self.library.workspace)
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(lib.import_file, self.files[0]) for lib in (self.library, other)]
            results = [future.result() for future in futures]
        self.assertEqual(sorted(item["duplicate"] for item in results), [False, True])
        self.assertEqual(results[0]["dataset"]["id"], results[1]["dataset"]["id"])
        self.assertEqual(len(self.library.list_datasets()), 1)

    def test_three_lot_fixture_is_repeatable_and_has_expected_failures(self):
        copies = create_demo_files(self.root / "repeat")
        self.assertEqual([p.read_bytes() for p in self.files], [p.read_bytes() for p in copies])
        datasets = [self.library.import_file(path)["dataset"] for path in self.files]
        self.assertEqual([item["pass_count"] for item in datasets], [120, 119, 119])
        self.assertEqual(len({item["sha256"] for item in datasets}), 3)

    def test_pass_count_excludes_abnormal_failed_and_unknown_duts(self):
        raw = bytearray(self.files[0].read_bytes())
        flags = [0x04, 0x08, 0x10]
        position, changed = 0, 0
        while position < len(raw) and changed < len(flags):
            length, kind, subtype = struct.unpack_from("<HBB", raw, position)
            if (kind, subtype) == (5, 20):
                raw[position + 6] = flags[changed]  # PRR body: head, site, PART_FLG
                changed += 1
            position += length + 4
        self.assertEqual(changed, 3)
        self.files[0].write_bytes(raw)
        dataset = self.library.import_file(self.files[0])["dataset"]
        self.assertEqual(dataset["dut_count"], 120)
        self.assertEqual(dataset["pass_count"], 117)
        reopened = Library(self.library.workspace).dataset(dataset["id"])
        self.assertEqual(reopened["pass_count"], 117)

    def test_supported_compressed_streams_preserve_original(self):
        raw = self.files[0].read_bytes()
        for suffix, data in ((".gz", gzip.compress(raw)), (".bz2", bz2.compress(raw))):
            with self.subTest(suffix=suffix):
                path = self.root / ("compressed.stdf" + suffix)
                path.write_bytes(data)
                dataset = self.library.import_file(path)["dataset"]
                self.assertEqual(dataset["measurements"], 360)
                snapshot = self.library.imports / dataset["id"] / ("source.stdf" + suffix)
                self.assertEqual(snapshot.read_bytes(), data)
        zipped = self.root / "single.zip"
        with zipfile.ZipFile(zipped, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("../../never-extracted.stdf", raw)
        dataset = self.library.import_file(zipped)["dataset"]
        self.assertEqual(dataset["dut_count"], 120)
        self.assertFalse((self.root / "never-extracted.stdf").exists())

    def test_truncated_or_incomplete_streams_never_publish(self):
        raw = self.files[0].read_bytes()
        # Last MRR is 11 bytes. Also reject a complete MRR followed by junk.
        variants = [raw[:-1], raw[:-11], raw + b"\x01", raw[:-10]]
        for index, data in enumerate(variants):
            with self.subTest(index=index):
                path = self.root / f"broken-{index}.stdf"
                path.write_bytes(data)
                with self.assertRaises(ValueError):
                    self.library.import_file(path)
                self.assertEqual(self.library.list_datasets(), [])
                self.assertEqual(list(self.library.imports.iterdir()), [])

    def test_unmatched_device_records_are_rejected(self):
        raw = self.files[0].read_bytes()
        position = 0
        while position < len(raw):
            length, kind, subtype = struct.unpack_from("<HBB", raw, position)
            if (kind, subtype) == (5, 20):
                break
            position += length + 4
        path = self.root / "missing-prr.stdf"
        path.write_bytes(raw[:position] + raw[position + length + 4:])
        with self.assertRaisesRegex(ValueError, "PIR|PRR"):
            self.library.import_file(path)
        self.assertEqual(self.library.list_datasets(), [])

    def test_multi_member_zip_and_corrupt_compression_rejected(self):
        zipped = self.root / "multiple.zip"
        with zipfile.ZipFile(zipped, "w") as archive:
            for index in range(2):
                archive.writestr(f"{index}.stdf", self.files[0].read_bytes())
        with self.assertRaisesRegex(ValueError, "exactly one"):
            self.library.import_file(zipped)
        truncated = self.root / "truncated.gz"
        truncated.write_bytes(gzip.compress(self.files[0].read_bytes())[:-8])
        with self.assertRaises(ValueError):
            self.library.import_file(truncated)
        self.assertEqual(self.library.list_datasets(), [])

    def test_expansion_limit_is_checked_during_streaming(self):
        with patch("semidata.ingest.MAX_UNCOMPRESSED_BYTES", 256):
            with self.assertRaisesRegex(ValueError, "2 GiB"):
                preflight(self.files[0], self.root / "normalized.stdf")

    def test_parser_failure_preserves_existing_dataset(self):
        existing = self.library.import_file(self.files[0])["dataset"]
        with patch("semidata.library.parse_database", side_effect=ValueError("parser rejected input")):
            with self.assertRaisesRegex(ValueError, "parser rejected"):
                self.library.import_file(self.files[1])
        self.assertEqual(self.library.list_datasets(), [existing])
        self.assertEqual([path.name for path in self.library.imports.iterdir()], [existing["id"]])

    def test_repeated_ptr_results_are_reported(self):
        raw = self.files[0].read_bytes()
        position = 0
        while position < len(raw):
            length, kind, subtype = struct.unpack_from("<HBB", raw, position)
            if (kind, subtype) == (15, 10):
                break
            position += length + 4
        record = raw[position:position + length + 4]
        path = self.root / "repeated-ptr.stdf"
        path.write_bytes(raw[:position] + record + raw[position:])
        dataset = self.library.import_file(path)["dataset"]
        self.assertEqual(dataset["measurements"], 360)
        self.assertTrue(any("Repeated PTR" in warning for warning in dataset["warnings"]))

    def test_unknown_schema_and_invalid_dataset_fail_explicitly(self):
        with closing(self.library.connect()) as connection, connection:
            connection.execute("PRAGMA user_version=99")
        with self.assertRaisesRegex(ValueError, "schema 99"):
            Library(self.library.workspace)
        with self.assertRaises(KeyError):
            self.library.database_path("../catalog.sqlite3")
        with self.assertRaises(KeyError):
            self.library.dataset("f" * 32)
        with self.assertRaises(ValueError):
            self.library.list_datasets(201)


if __name__ == "__main__":
    unittest.main()
