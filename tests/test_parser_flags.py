"""Native parser regression: keep parameter validity bits through batch writes."""

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


class _Progress:
    def emit(self, value):
        pass


class _Stop:
    stop = False


class ParserFlagTests(unittest.TestCase):
    def setUp(self):
        # Inherit permissions so this also runs inside the Windows test sandbox.
        temporary_root = Path(tempfile.gettempdir()).resolve()
        self.directory = temporary_root / f"semidata-flags-{uuid.uuid4().hex}"
        self.directory.mkdir()
        self.assertEqual(self.directory.resolve().parent, temporary_root)
        self.addCleanup(shutil.rmtree, self.directory)

    def test_parameter_flags_survive_full_batches_and_tail(self):
        directory = self.directory
        source = create_demo_files(directory)[2]
        contents = bytearray(source.read_bytes())
        expected = []
        position = 0
        while position < len(contents):
            length, kind, subtype = struct.unpack_from("<HBB", contents, position)
            if (kind, subtype) == (15, 10):
                body = position + 4
                number, _, _, flag, _, result = struct.unpack_from(
                    "<IBBBBf", contents, body
                )
                # Include every possible byte and cross two 128-row batches.
                parm_flag = len(expected) % 256
                contents[body + 7] = parm_flag
                expected.append(
                    (len(expected) // 3 + 1, number - 1001, result, flag, parm_flag)
                )
            position += 4 + length
        self.assertEqual(len(expected), 360)  # 128 + 128 + a 104-row tail
        source.write_bytes(contents)
        database = directory / "flags.sqlite"
        rust_stdf_helper.generate_database(
            str(database), [[str(source)]],
            rust_stdf_helper.TestIDType.TestNumberAndName,
            True, _Progress(), _Stop(),
        )
        with closing(sqlite3.connect(database)) as connection:
            actual = connection.execute(
                "SELECT DUTIndex, TEST_ID, RESULT, TEST_FLAG, PARM_FLAG "
                "FROM PTR_Data ORDER BY DUTIndex, TEST_ID"
            ).fetchall()
        self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
