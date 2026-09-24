"""Build checksum-valid adversarial packages from a SMALL valid .sdlibrary.

Usage: python web-prototype/scripts/package-fixtures.py INPUT.sdlibrary OUTPUT
This offline test generator intentionally creates invalid SQLite datasets while
preserving their exact STDF source and rebuilding correct package framing and
SHA-256 checksums. Never import these as engineering data. Only Python standard
library modules are used. The input is read-only and limited to 32 MiB; temporary
database copies are mutated, not the original package or source files.
"""

from __future__ import annotations

import argparse
from contextlib import closing
import hashlib
import json
import sqlite3
import struct
import tempfile
from pathlib import Path


MAX_FIXTURE_INPUT = 32 * 1024 * 1024
MAGIC = b"SDPKG001"


def unpack_package(data: bytes) -> tuple[dict, bytes, bytes]:
    if len(data) < 76 or data[:8] != MAGIC:
        raise ValueError("Expected version-1 .sdlibrary magic")
    header_size = struct.unpack_from("<I", data, 8)[0]
    if not 1 <= header_size <= 65536:
        raise ValueError("Invalid package header length")
    header = json.loads(data[12:12 + header_size])
    if header["formatVersion"] != 1:
        raise ValueError("Only format version 1 is supported")
    source_size, database_size = header["sourceBytes"], header["databaseBytes"]
    if type(source_size) is not int or type(database_size) is not int:
        raise ValueError("Package payload sizes must be integers")
    if source_size <= 0 or database_size < 512 or database_size % 512:
        raise ValueError("Invalid source/database sizes")
    end = 12 + header_size + source_size + database_size
    if end + 64 != len(data) or data[end:] != hashlib.sha256(data[:end]).hexdigest().encode("ascii"):
        raise ValueError("Input package has incorrect framing or footer checksum")
    source = data[12 + header_size:12 + header_size + source_size]
    database = data[12 + header_size + source_size:end]
    if database[:16] != b"SQLite format 3\x00":
        raise ValueError("Missing SQLite header")
    if header["manifest"]["source"]["sha256"] != hashlib.sha256(source).hexdigest():
        raise ValueError("Input package has incorrect STDF source checksum")
    if header["manifest"]["source"]["size"] != source_size:
        raise ValueError("Input manifest source size disagrees with framing")
    return header, source, database


def pack_package(header: dict, source: bytes, database: bytes) -> bytes:
    header = {**header, "sourceBytes": len(source), "databaseBytes": len(database)}
    encoded_header = json.dumps(header, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(encoded_header) > 65536:
        raise ValueError("Repacked header exceeds format limit")
    payload = MAGIC + struct.pack("<I", len(encoded_header)) + encoded_header + source + database
    return payload + hashlib.sha256(payload).hexdigest().encode("ascii")


def mutate(connection: sqlite3.Connection, variant: str, manifest: dict) -> None:
    # Invalid fixtures must bypass CHECKs added by the production schema while
    # leaving the exact original CREATE TABLE statements intact for schema checks.
    connection.execute("PRAGMA ignore_check_constraints=ON")
    connection.execute("PRAGMA foreign_keys=OFF")
    if variant == "meta-view":
        connection.execute("DROP TABLE meta")
        # Do not execute this view here. The app must reject its schema before
        # asking for metadata, so restoration cannot trigger the billion-row sum.
        connection.execute("""CREATE VIEW meta AS
            WITH RECURSIVE expensive(n) AS (
                VALUES(0) UNION ALL SELECT n+1 FROM expensive WHERE n<1000000000
            ) SELECT 'manifest' AS key, CAST(sum(n) AS TEXT) AS value FROM expensive""")
    elif variant == "oversized-manifest":
        oversized = json.dumps({**manifest, "fixturePadding": "x" * 131072}, separators=(",", ":"))
        changed = connection.execute("UPDATE meta SET value=? WHERE key='manifest'", (oversized,)).rowcount
        if changed != 1:
            raise ValueError("Expected exactly one stored manifest")
    elif variant in {"record-gap", "record-overlap"}:
        row = connection.execute("SELECT seq,offset,length FROM records WHERE seq>1 AND seq<(SELECT max(seq) FROM records) AND length>5 ORDER BY seq LIMIT 1").fetchone()
        if row is None:
            raise ValueError("Fixture needs a non-final record longer than five bytes")
        seq, offset, length = row
        shift = 1 if variant == "record-gap" else -1
        original_end = connection.execute("SELECT max(offset+length) FROM records").fetchone()[0]
        connection.execute("UPDATE records SET offset=?,length=? WHERE seq=?", (offset + shift, length - shift, seq))
        assert connection.execute("SELECT max(offset+length) FROM records").fetchone()[0] == original_end
    elif variant in {"measurement-head", "measurement-site"}:
        column = "head" if variant == "measurement-head" else "site"
        row = connection.execute(f"SELECT seq,{column} FROM measurements ORDER BY seq LIMIT 1").fetchone()
        if row is None:
            raise ValueError("Fixture needs a retained PTR measurement")
        connection.execute(f"UPDATE measurements SET {column}=? WHERE seq=?", ((row[1] + 1) % 256, row[0]))
    elif variant in {"record-ptr-null-device", "record-pir-null-device", "record-prr-null-device"}:
        typ, sub = {"record-ptr-null-device": (15, 10), "record-pir-null-device": (5, 10), "record-prr-null-device": (5, 20)}[variant]
        row = connection.execute("SELECT seq FROM records WHERE type=? AND subtype=? ORDER BY seq LIMIT 1", (typ, sub)).fetchone()
        if row is None:
            raise ValueError("Fixture needs a matching PTR/PIR/PRR record")
        connection.execute("UPDATE records SET device_id=NULL WHERE seq=?", (row[0],))
    elif variant == "measurement-blob-result":
        row = connection.execute("SELECT seq FROM measurements ORDER BY seq LIMIT 1").fetchone()
        if row is None:
            raise ValueError("Fixture needs a retained PTR measurement")
        connection.execute("UPDATE measurements SET result=? WHERE seq=?", (sqlite3.Binary(bytes.fromhex("001122334455")), row[0]))
    else:
        raise ValueError(f"Unknown fixture variant: {variant}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    package = args.package.resolve()
    output = args.output.resolve()
    if package.stat().st_size > MAX_FIXTURE_INPUT:
        raise ValueError("Fixture generation accepts only packages up to 32 MiB")
    original = package.read_bytes()
    header, source, database = unpack_package(original)
    if package == output / "package-fixtures.json":
        raise ValueError("Refusing to overwrite the input package with the fixture report")
    output.mkdir(parents=True, exist_ok=True)
    variants = {
        "meta-view": ("schema", "The meta table is replaced by an expensive recursive view"),
        "oversized-manifest": ("manifest", "Stored manifest JSON exceeds the bounded metadata limit"),
        "record-gap": ("records", "One non-final record starts one byte late; maximum extent remains correct"),
        "record-overlap": ("records", "One non-final record starts one byte early; maximum extent remains correct"),
        "measurement-head": ("references", "PTR head disagrees with its referenced device"),
        "measurement-site": ("references", "PTR site disagrees with its referenced device"),
        "record-ptr-null-device": ("references", "PTR raw index has a NULL device reference"),
        "record-pir-null-device": ("references", "PIR raw index has a NULL device reference"),
        "record-prr-null-device": ("references", "PRR raw index has a NULL device reference"),
        "measurement-blob-result": ("scalar-values", "PTR result contains a SQLite BLOB instead of a numeric value or NULL"),
    }
    report = {"formatVersion": 1, "input": str(package), "sourceSha256": hashlib.sha256(source).hexdigest(), "variants": {}}
    with tempfile.TemporaryDirectory(prefix="semidata-package-fixtures-") as temporary:
        temp_root = Path(temporary)
        for variant, (stage, reason) in variants.items():
            db_path = temp_root / f"{variant}.sqlite"
            db_path.write_bytes(database)
            with closing(sqlite3.connect(db_path)) as connection, connection:
                # SQLite schema inventory is safe to read without evaluating a
                # view. Refuse a non-dataset input before changing any copies.
                if connection.execute("PRAGMA application_id").fetchone()[0] != 1396985924:
                    raise ValueError("Input SQLite application ID is not a SemiData dataset")
                if connection.execute("PRAGMA user_version").fetchone()[0] != 1:
                    raise ValueError("Input SQLite schema version is unsupported")
                connection.execute("PRAGMA trusted_schema=OFF")
                objects = dict(connection.execute("SELECT name,type FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'"))
                expected_objects = {name: "table" for name in ["meta", "records", "definitions", "measurements", "devices"]}
                expected_objects.update({"measurements_test": "index", "measurements_device": "index"})
                if objects != expected_objects:
                    raise ValueError("Input schema is not the expected dataset table/index inventory")
                mutate(connection, variant, header["manifest"])
            # Both commit and close complete before reading pages or allowing
            # Windows to remove the temporary database copy.
            mutated = db_path.read_bytes()
            encoded = pack_package(header, source, mutated)
            checked_header, checked_source, checked_database = unpack_package(encoded)
            assert checked_source == source and checked_database == mutated
            assert checked_header["manifest"] == header["manifest"]
            name = f"malicious-{variant}.sdlibrary"
            destination = output / name
            if destination == package:
                raise ValueError("Refusing to overwrite the input package")
            destination.write_bytes(encoded)
            report["variants"][name] = {"expectedRejectionStage": stage, "reason": reason,
                "packageBytes": len(encoded), "databaseBytes": len(mutated),
                "packageSha256": hashlib.sha256(encoded).hexdigest(), "checksumValid": True}
    (output / "package-fixtures.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    assert package.read_bytes() == original, "Input package was modified"
    print(json.dumps({"output": str(output), "variants": report["variants"]}, indent=2))


if __name__ == "__main__":
    main()
