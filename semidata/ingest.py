"""Bounded input validation around the upstream Rust STDF database builder.

The framing pass is intentionally not a replacement STDF parser. It rejects
incomplete streams before upstream's permissive EOF handling can publish them.
"""

from contextlib import closing, contextmanager, nullcontext
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
_READ_CHUNK_BYTES = 1024 * 1024
_MINIMUM_LENGTHS = {(1, 10): 15, (1, 20): 4, (5, 10): 2,
                    (5, 20): 17, (15, 10): 12, (15, 15): 12, (15, 20): 7}


def compression_kind(path: Path) -> str | None:
    """Identify supported compression from bytes, independent of file suffix."""
    with path.open("rb") as probe:
        magic = probe.read(4)
    if magic.startswith(b"\x1f\x8b"):
        return "gzip"
    if magic.startswith(b"BZh"):
        return "bzip2"
    if magic.startswith(b"PK"):
        return "zip"
    return None


@contextmanager
def _open_stream(path: Path) -> Iterator[BinaryIO]:
    kind = compression_kind(path)
    if kind == "gzip":
        with gzip.open(path, "rb") as stream:
            yield stream
    elif kind == "bzip2":
        with bz2.open(path, "rb") as stream:
            yield stream
    elif kind == "zip":
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


def preflight(path: Path, normalized: Path | None) -> dict:
    """Validate a bounded stream, optionally writing a normalized raw copy.

    Compressed members are streamed, never extracted by their archived paths.
    Only V4 IEEE big/little-endian input is accepted. An MRR and balanced
    head/site PIR/PRR pairs are required; no records may follow the final MRR.
    This verifies framing/ordering, not every STDF optional-field semantic.
    Raw snapshots can be validated directly without creating a second copy.
    The buffer holds one I/O chunk plus at most one partial U2-length record.
    """
    total = 0
    active: set[tuple[int, int]] = set()
    count = 0
    dut_count = 0
    ptr_count = 0
    mir = False
    mrr = False
    started_at = None
    destination = normalized.open("wb") if normalized is not None else nullcontext(None)
    with destination as output, _open_stream(path) as stream:
        far = stream.read(6)
        if len(far) != 6 or far[2:4] != b"\0\x0a" or far[5] != 4 or far[4] not in (1, 2):
            raise ValueError("Expected an STDF V4 FAR record with IEEE big/little-endian data.")
        endian = ">" if far[4] == 1 else "<"
        if struct.unpack(endian + "H", far[:2])[0] != 2:
            raise ValueError("Invalid FAR record length.")
        if output is not None:
            output.write(far)
        total += 6
        received = 6
        buffer = b""
        position = 0
        header_struct = struct.Struct(endian + "HBB")
        timestamp_struct = struct.Struct(endian + "I")
        minimum_lengths = _MINIMUM_LENGTHS
        while True:
            # One bulk read/write replaces per-record I/O and body allocations.
            # Read at most one byte beyond the cap to detect expansion overflow.
            chunk = stream.read(min(_READ_CHUNK_BYTES, MAX_UNCOMPRESSED_BYTES - received + 1))
            if not chunk:
                break
            received += len(chunk)
            if received > MAX_UNCOMPRESSED_BYTES:
                raise ValueError("The uncompressed STDF exceeds the 2 GiB evaluation limit.")
            if output is not None:
                output.write(chunk)
            buffer = buffer[position:] + chunk
            position = 0
            size = len(buffer)
            while size - position >= 4:
                length, kind, subtype = header_struct.unpack_from(buffer, position)
                next_position = position + length + 4
                if next_position > size:
                    break
                body = position + 4
                if mrr:
                    raise ValueError("Records follow the final MRR; concatenated files are not supported.")
                key = (kind, subtype)
                if length < minimum_lengths.get(key, 0):
                    raise ValueError(f"STDF record {key} is missing required fields at byte {total}.")
                if key == (0, 10):
                    raise ValueError("Unexpected FAR; import each STDF file separately.")
                if key == (1, 10):
                    if mir or active or dut_count:
                        raise ValueError("The STDF must contain one MIR before its device records.")
                    mir = True
                    timestamp = timestamp_struct.unpack_from(buffer, body + 4)[0]
                    started_at = datetime.fromtimestamp(timestamp, timezone.utc).isoformat()
                elif key == (5, 10):
                    pair = (buffer[body], buffer[body + 1])
                    if not mir or pair in active:
                        raise ValueError("PIR before MIR or duplicate open PIR for the same head/site.")
                    active.add(pair)
                elif key == (5, 20):
                    pair = (buffer[body], buffer[body + 1])
                    if pair not in active:
                        raise ValueError("PRR has no matching open PIR for its head/site.")
                    active.remove(pair)
                    dut_count += 1
                elif kind == 15 and subtype in (10, 15, 20):
                    if (buffer[body + 4], buffer[body + 5]) not in active:
                        raise ValueError("A test result has no open PIR for its head/site.")
                    ptr_count += subtype == 10
                elif key == (1, 20):
                    if not mir or active:
                        raise ValueError("MRR before MIR or with unfinished devices (missing PRR).")
                    mrr = True
                position = next_position
                total += length + 4
                count += 1
        remaining = len(buffer) - position
        if remaining:
            part = "header" if remaining < 4 else "body"
            raise ValueError(f"Truncated STDF record {part} at byte {total}.")
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
