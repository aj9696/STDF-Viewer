"""Framing invariants across arbitrary I/O boundaries, independent of parsing."""

import gzip
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

from semidata.ingest import preflight


def stream_bytes(endian="<", extra=b""):
    def record(kind, subtype, body):
        return struct.pack(endian + "HBB", len(body), kind, subtype) + body

    records = [record(0, 10, bytes([2 if endian == "<" else 1, 4])),
               record(1, 10, bytes(15)), record(5, 10, bytes([1, 2]))]
    for number in range(17):
        records.append(record(15, 10, struct.pack(endian + "IBBBBf", number, 1, 2, 0, 0, number / 4)))
    records += [extra, record(5, 20, bytes([1, 2]) + bytes(15)), record(1, 20, bytes(4))]
    return b"".join(records)


class FramingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source.stdf"
        self.output = self.root / "normalized.stdf"

    def test_endian_and_headers_and_bodies_across_chunk_boundaries(self):
        for endian in ("<", ">"):
            # A maximum-sized unknown record must be preserved without interpreting it.
            extra = struct.pack(endian + "HBB", 65535, 200, 200) + bytes(65535)
            raw = stream_bytes(endian, extra)
            self.source.write_bytes(raw)
            for chunk in (7, 31, 4096, 65536):
                with self.subTest(endian=endian, chunk=chunk), patch("semidata.ingest._READ_CHUNK_BYTES", chunk):
                    result = preflight(self.source, self.output)
                    self.assertEqual(result["dut_count"], 1)
                    self.assertEqual(result["ptr_count"], 17)
                    self.assertEqual(result["record_count"], 23)
                    self.assertEqual(result["uncompressed_bytes"], len(raw))
                    self.assertEqual(self.output.read_bytes(), raw)

    def test_validation_without_normalization_preserves_source(self):
        raw = stream_bytes()
        self.source.write_bytes(raw)
        result = preflight(self.source, None)
        self.assertEqual(result["ptr_count"], 17)
        self.assertEqual(self.source.read_bytes(), raw)
        self.assertFalse(self.output.exists())

    def test_gzip_streaming_output_is_exact(self):
        raw = stream_bytes()
        self.source.write_bytes(gzip.compress(raw))
        with patch("semidata.ingest._READ_CHUNK_BYTES", 9):
            result = preflight(self.source, self.output)
        self.assertEqual(result["uncompressed_bytes"], len(raw))
        self.assertEqual(self.output.read_bytes(), raw)

    def test_truncated_and_concatenated_streams_rejected_with_small_chunks(self):
        raw = stream_bytes()
        variants = [(raw[:-1], "Truncated STDF record body"),
                    (raw[:-6], "Truncated STDF record header"),
                    (raw[:-8], "missing final MRR"),
                    (raw + raw, "Records follow the final MRR")]
        for data, message in variants:
            self.source.write_bytes(data)
            with self.subTest(message=message), patch("semidata.ingest._READ_CHUNK_BYTES", 7):
                with self.assertRaisesRegex(ValueError, message):
                    preflight(self.source, self.output)

    def test_expansion_cap_applies_before_writing_excess_output(self):
        self.source.write_bytes(gzip.compress(stream_bytes()))
        with patch("semidata.ingest.MAX_UNCOMPRESSED_BYTES", 100):
            with self.assertRaisesRegex(ValueError, "2 GiB"):
                preflight(self.source, self.output)
        self.assertLessEqual(self.output.stat().st_size, 100)


if __name__ == "__main__":
    unittest.main()
