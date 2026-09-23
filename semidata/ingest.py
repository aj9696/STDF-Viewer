"""Bounded input validation around the upstream Rust STDF database builder.

The framing pass is intentionally not a replacement STDF parser. It rejects
incomplete streams before upstream's permissive EOF handling can publish them.
"""

from contextlib import closing, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO, Iterator
import bz2
import gzip
import sqlite3
import struct
import time
import zipfile


MAX_UNCOMPRESSED_BYTES = 2 * 1024**3
_MINIMUM_LENGTHS = {(1, 10): 15, (1, 20): 4, (5, 10): 2,
                    (5, 20): 17, (15, 10): 12, (15, 15): 12, (15, 20): 7}


@contextmanager
def _open_stream(path: Path) -> Iterator[BinaryIO]:
    with path.open("rb") as probe:
        magic = probe.read(4)
    if magic.startswith(b"\x1f\x8b"):
        with gzip.open(path, "rb") as stream:
            yield stream
    elif magic.startswith(b"BZh"):
        with bz2.open(path, "rb") as stream:
            yield stream
    elif magic.startswith(b"PK"):
        with zipfile.ZipFile(path) as archive:
            members = [info for info in archive.infolist() if not info.is_dir()]
            if len(members) != 1:
                raise ValueError("ZIP imports must contain exactly one STDF file.")
            if members[0].file_size > MAX_UNCOMPRESSED_BYTES:
                raise ValueError("The uncompressed STDF exceeds the 2 GiB evaluation limit.")
            if members[0].flag_bits & 1:
                raise ValueError("Encrypted ZIP imports are not supported.")
            with archive.open(members[0]) as stream:
                yield stream
    else:
        with path.open("rb") as stream:
            yield stream


def preflight(path: Path, normalized: Path) -> dict:
    """Validate record boundaries and completeness while writing raw STDF.

    Compressed members are streamed, never extracted by their archived paths.
    Only V4 IEEE big/little-endian input is accepted. An MRR and balanced
    head/site PIR/PRR pairs are required; no records may follow the final MRR.
    This verifies framing/ordering, not every STDF optional-field semantic.
    """
    total = 0
    active: set[tuple[int, int]] = set()
    count = 0
    dut_count = 0
    ptr_count = 0
    mir = False
    mrr = False
    started_at = None
    with _open_stream(path) as stream, normalized.open("wb") as output:
        far = stream.read(6)
        if len(far) != 6 or far[2:4] != b"\0\x0a" or far[5] != 4 or far[4] not in (1, 2):
            raise ValueError("Expected an STDF V4 FAR record with IEEE big/little-endian data.")
        endian = ">" if far[4] == 1 else "<"
        if struct.unpack(endian + "H", far[:2])[0] != 2:
            raise ValueError("Invalid FAR record length.")
        output.write(far)
        total += 6
        while True:
            header = stream.read(4)
            if not header:
                break
            if len(header) != 4:
                raise ValueError(f"Truncated STDF record header at byte {total}.")
            length, kind, subtype = struct.unpack(endian + "HBB", header)
            if total + length + 4 > MAX_UNCOMPRESSED_BYTES:
                raise ValueError("The uncompressed STDF exceeds the 2 GiB evaluation limit.")
            body = stream.read(length)
            if len(body) != length:
                raise ValueError(f"Truncated STDF record body at byte {total}.")
            if mrr:
                raise ValueError("Records follow the final MRR; concatenated files are not supported.")
            key = (kind, subtype)
            if length < _MINIMUM_LENGTHS.get(key, 0):
                raise ValueError(f"STDF record {key} is missing required fields at byte {total}.")
            if key == (0, 10):
                raise ValueError("Unexpected FAR; import each STDF file separately.")
            if key == (1, 10):
                if mir or active or dut_count:
                    raise ValueError("The STDF must contain one MIR before its device records.")
                mir = True
                timestamp = struct.unpack_from(endian + "I", body, 4)[0]
                started_at = datetime.fromtimestamp(timestamp, timezone.utc).isoformat()
            elif key == (5, 10):
                pair = (body[0], body[1])
                if not mir or pair in active:
                    raise ValueError("PIR before MIR or duplicate open PIR for the same head/site.")
                active.add(pair)
            elif key == (5, 20):
                pair = (body[0], body[1])
                if pair not in active:
                    raise ValueError("PRR has no matching open PIR for its head/site.")
                active.remove(pair)
                dut_count += 1
            elif kind == 15 and subtype in (10, 15, 20):
                if (body[4], body[5]) not in active:
                    raise ValueError("A test result has no open PIR for its head/site.")
                ptr_count += subtype == 10
            elif key == (1, 20):
                if not mir or active:
                    raise ValueError("MRR before MIR or with unfinished devices (missing PRR).")
                mrr = True
            output.write(header)
            output.write(body)
            total += length + 4
            count += 1
    if not mrr or active:
        raise ValueError("Incomplete STDF: missing final MRR or unfinished device records.")
    if not dut_count:
        raise ValueError("The file contains no completed device tests.")
    return {"dut_count": dut_count, "started_at": started_at,
            "record_count": count + 1, "ptr_count": ptr_count, "uncompressed_bytes": total}


class _Progress:
    def emit(self, value: int) -> None:
        pass


class _Stop:
    stop = False


def parse_database(source: Path, database: Path, expected: dict) -> dict:
    """Run the real Rust parser and validate its published dataset metadata."""
    try:
        import rust_stdf_helper
    except ImportError as exc:
        raise RuntimeError("The Rust parser is unavailable. Follow docs/installation.md to build the local extension.") from exc
    started = time.perf_counter()
    try:
        rust_stdf_helper.generate_database(str(database), [[str(source)]], 0, True,
                                           _Progress(), _Stop())
    except Exception as exc:
        # The extension currently raises base Exception for parser/database
        # failures. Keep its diagnostic while exposing a normal import error.
        raise ValueError(f"The upstream STDF parser could not import this file: {exc}") from exc
    duration = time.perf_counter() - started
    with closing(sqlite3.connect(database)) as connection:
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("The parsed database failed its integrity check.")
        metadata = dict(connection.execute("SELECT Field, Value FROM File_Info"))
        dut_count, pass_count = connection.execute(
            "SELECT COUNT(*), COALESCE(SUM((Flag & 0x1C) = 0), 0) FROM Dut_Info"
        ).fetchone()
        if dut_count != expected["dut_count"] or "FINISH_T" not in metadata:
            raise ValueError("The parser did not preserve all completed device records.")
        tests = connection.execute("SELECT COUNT(*) FROM Test_Info").fetchone()[0]
        measurements = connection.execute("SELECT COUNT(*) FROM PTR_Data").fetchone()[0]
        unsupported = connection.execute(
            "SELECT (SELECT COUNT(*) FROM MPR_Data) + (SELECT COUNT(*) FROM FTR_Data)"
        ).fetchone()[0]
    warnings = []
    if unsupported:
        warnings.append("MPR/FTR data is retained, but this release analyzes scalar PTR measurements only.")
    if not measurements:
        warnings.append("This file has no scalar PTR measurements available for analysis.")
    if not metadata.get("PART_TYP"):
        warnings.append("The source has no PART_TYP product identifier.")
    if measurements < expected["ptr_count"]:
        warnings.append("Repeated PTR results for the same DUT/test were collapsed to the last result by the upstream parser; original bytes are retained.")
    return {"lot": metadata.get("LOT_ID", ""), "product": metadata.get("PART_TYP", ""),
            "started_at": expected["started_at"], "dut_count": dut_count,
            "test_count": tests, "measurements": measurements, "pass_count": pass_count,
            "parse_seconds": round(duration, 6), "warnings": warnings}
