"""Compact PTR compatibility must preserve identity without guessing names."""

from contextlib import closing
from pathlib import Path
import shutil
import sqlite3
import struct
import tempfile
import unittest
import uuid

import rust_stdf_helper

from semidata.demo import create_demo_files


class Progress:
    def emit(self, value):
        pass


class Stop:
    stop = False


class ParserIdentityTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.gettempdir()) / f"semidata-identity-{uuid.uuid4().hex}"
        self.root.mkdir()
        self.addCleanup(shutil.rmtree, self.root)
        self.source = create_demo_files(self.root / "fixtures")[2]

    def transform(self, transform):
        original = self.source.read_bytes()
        records, position, counts = [], 0, {}
        while position < len(original):
            length, kind, subtype = struct.unpack_from("<HBB", original, position)
            body = original[position + 4:position + 4 + length]
            if (kind, subtype) == (15, 10):
                number = struct.unpack_from("<I", body)[0]
                counts[number] = counts.get(number, 0) + 1
                body = transform(body, counts[number])
            records.append(struct.pack("<HBB", len(body), kind, subtype) + body)
            position += 4 + length
        self.source.write_bytes(b"".join(records))

    def parse(self, name):
        database = self.root / f"{name}.sqlite"
        rust_stdf_helper.generate_database(
            str(database), [[str(self.source)]],
            rust_stdf_helper.TestIDType.TestNumberAndName,
            True, Progress(), Stop(),
        )
        with closing(sqlite3.connect(database)) as connection:
            metadata = connection.execute(
                "SELECT TEST_ID, TEST_NUM, TEST_NAME, Unit, LLimit, HLimit, recHeader "
                "FROM Test_Info ORDER BY TEST_ID"
            ).fetchall()
            results = connection.execute(
                "SELECT DUTIndex, TEST_ID, RESULT, TEST_FLAG, PARM_FLAG "
                "FROM PTR_Data ORDER BY DUTIndex, TEST_ID"
            ).fetchall()
        return metadata, results

    def insert_prior_non_ptr(self, subtype):
        """Give the first PTR's number a distinct preceding FTR/MPR name."""
        original = self.source.read_bytes()
        position = 0
        while position < len(original):
            length, kind, current_subtype = struct.unpack_from("<HBB", original, position)
            if (kind, current_subtype) == (15, 10):
                number, head, site = struct.unpack_from("<IBB", original, position + 4)
                name = b"Other record type"
                if subtype == 15:
                    # No PMR indexes, one result, then TEST_TXT.
                    body = struct.pack("<IBBBBHHf", number, head, site, 0, 0, 0, 1, 0.5)
                else:
                    # Zero counts/arrays/FAIL_PIN; empty VECT_NAM/TIME_SET/OP_CODE.
                    body = struct.pack("<IBBBBIIIIiihHH", number, head, site, 0, 255,
                                       0, 0, 0, 0, 0, 0, 0, 0, 0) + bytes(5)
                body += bytes([len(name)]) + name
                record = struct.pack("<HBB", len(body), 15, subtype) + body
                self.source.write_bytes(original[:position] + record + original[position:])
                return
            position += 4 + length
        self.fail("Fixture has no PTR")

    def test_non_ptr_names_do_not_supply_compact_ptr_identity(self):
        original = self.source.read_bytes()
        for subtype in (15, 20):
            with self.subTest(prior_record=subtype):
                self.source.write_bytes(original)
                self.transform(lambda body, occurrence: body[:12])
                expected = self.parse(f"compact-{subtype}")
                self.insert_prior_non_ptr(subtype)
                metadata, results = self.parse(f"mixed-unnamed-{subtype}")
                self.assertEqual((metadata[0][2], metadata[0][-1]),
                                 ("Other record type", subtype))
                ptr_ids = {row[1] for row in results}
                ptr_metadata = [row for row in metadata if row[0] in ptr_ids]
                self.assertEqual(len(ptr_metadata), 3)
                self.assertTrue(all(row[2] == "" for row in ptr_metadata))
                self.assertTrue(all(row[-1] == 10 for row in ptr_metadata))
                self.assertEqual([row[2:] for row in ptr_metadata],
                                 [row[2:] for row in expected[0]])
                self.assertEqual([row[2:] for row in results],
                                 [row[2:] for row in expected[1]])

    def test_non_ptr_names_do_not_make_prior_ptr_identity_ambiguous(self):
        original = self.source.read_bytes()
        for subtype in (15, 20):
            with self.subTest(prior_record=subtype):
                self.source.write_bytes(original)
                self.transform(lambda body, occurrence: body if occurrence == 1 else body[:12])
                expected = self.parse(f"named-{subtype}")
                self.insert_prior_non_ptr(subtype)
                metadata, results = self.parse(f"mixed-named-{subtype}")
                self.assertEqual((metadata[0][2], metadata[0][-1]),
                                 ("Other record type", subtype))
                ptr_ids = {row[1] for row in results}
                self.assertEqual([row[1:] for row in metadata if row[0] in ptr_ids],
                                 [row[1:] for row in expected[0]])
                self.assertEqual([row[2:] for row in results],
                                 [row[2:] for row in expected[1]])

    def test_omitted_name_reuses_unique_prior_identity_and_defaults(self):
        original = self.parse("full")
        self.transform(lambda body, occurrence: body if occurrence == 1 else body[:12])
        compact = self.parse("compact")
        self.assertEqual(compact, original)
        self.assertEqual(len(compact[0]), 3)
        self.assertEqual(len(compact[1]), 360)

    def test_explicit_empty_name_remains_a_distinct_identity(self):
        self.transform(lambda body, occurrence: body if occurrence == 1 else body[:12] + b"\0")
        metadata, results = self.parse("empty")
        self.assertEqual(len(metadata), 6)
        self.assertEqual(sum(row[2] == "" for row in metadata), 3)
        self.assertEqual(len(results), 360)

    def test_ambiguous_omitted_name_is_rejected(self):
        def transform(body, occurrence):
            if occurrence == 1:
                return body
            if occurrence == 2:
                # A different explicitly encoded name under the same test number.
                length = body[12]
                return body[:13] + b"X" * length + body[13 + length:]
            return body[:12]

        self.transform(transform)
        with self.assertRaisesRegex(Exception, "Ambiguous omitted PTR TEST_TXT"):
            self.parse("ambiguous")

    def test_no_prior_name_stays_unnamed(self):
        self.transform(lambda body, occurrence: body[:12])
        metadata, results = self.parse("unnamed")
        self.assertEqual(len(metadata), 3)
        self.assertTrue(all(row[2] == "" for row in metadata))
        self.assertEqual(len(results), 360)


if __name__ == "__main__":
    unittest.main()
