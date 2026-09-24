"""Durable, append-only engineering dataset catalog.

Each import owns an original byte snapshot and an upstream parser database.
Only a committed catalog row makes an import visible. Failed imports are
removed; interrupted processes may leave unreferenced staging directories.
"""

from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
import sqlite3
import uuid
import zipfile

from .ingest import MAX_UNCOMPRESSED_BYTES, compression_kind, parse_database, preflight


SCHEMA_VERSION = 1
_COLUMNS = ("id", "name", "sha256", "lot", "product", "started_at", "imported_at",
            "dut_count", "test_count", "measurements", "pass_count", "bytes",
            "parse_seconds", "warnings")


def _dataset(row: sqlite3.Row) -> dict:
    result = dict(row)
    result["warnings"] = json.loads(result["warnings"])
    return result


class Library:
    """A local workspace, safe to reopen and share across server threads.

    Connections are short-lived and created by each caller. An IMMEDIATE
    catalog transaction serializes imports across both threads and processes;
    WAL readers can continue while an import is being parsed.
    """

    def __init__(self, workspace: Path):
        self.workspace = Path(workspace).expanduser().resolve()
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.imports = self.workspace / "imports"
        self.imports.mkdir(exist_ok=True)
        self.catalog = self.workspace / "catalog.sqlite3"
        with closing(self.connect()) as connection, connection:
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, SCHEMA_VERSION):
                raise ValueError(f"Unsupported catalog schema {version}; this release supports {SCHEMA_VERSION}.")
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("""CREATE TABLE IF NOT EXISTS datasets (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, sha256 TEXT NOT NULL UNIQUE,
                lot TEXT NOT NULL, product TEXT NOT NULL, started_at TEXT,
                imported_at TEXT NOT NULL, dut_count INTEGER NOT NULL,
                test_count INTEGER NOT NULL, measurements INTEGER NOT NULL,
                pass_count INTEGER NOT NULL, bytes INTEGER NOT NULL,
                parse_seconds REAL NOT NULL, warnings TEXT NOT NULL
            )""")
            connection.execute(f"PRAGMA user_version={SCHEMA_VERSION}")

    def connect(self) -> sqlite3.Connection:
        """Return a catalog connection. Caller must commit/rollback and close it."""
        connection = sqlite3.connect(self.catalog, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def list_datasets(self, limit: int = 200) -> list[dict]:
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 200:
            raise ValueError("Dataset list limit must be an integer from 1 to 200.")
        with closing(self.connect()) as connection:
            return [_dataset(row) for row in connection.execute(
                "SELECT * FROM datasets ORDER BY imported_at DESC, id DESC LIMIT ?", (limit,))]

    def dataset(self, dataset_id: str) -> dict:
        if not isinstance(dataset_id, str) or not re.fullmatch(r"[0-9a-f]{32}", dataset_id):
            raise KeyError("Dataset not found.")
        with closing(self.connect()) as connection:
            row = connection.execute("SELECT * FROM datasets WHERE id=?", (dataset_id,)).fetchone()
        if row is None:
            raise KeyError("Dataset not found.")
        return _dataset(row)

    def database_path(self, dataset_id: str) -> Path:
        self.dataset(dataset_id)
        path = self.imports / dataset_id / "source.db"
        if not path.is_file():
            raise FileNotFoundError("The dataset database is missing from the workspace.")
        return path

    def import_file(self, path: Path) -> dict:
        """Snapshot, validate, parse, and atomically publish one local source.

        Deduplication hashes the original bytes, including compressed bytes.
        Different compression encodings are therefore different datasets.
        """
        path = Path(path).expanduser().resolve()
        if not path.is_file():
            raise ValueError("Choose an existing local STDF file.")
        if path.stat().st_size > MAX_UNCOMPRESSED_BYTES:
            raise ValueError("The input exceeds the 2 GiB evaluation limit.")
        dataset_id = uuid.uuid4().hex
        staging = self.imports / f".staging-{dataset_id}"
        published = self.imports / dataset_id
        staging.mkdir()
        committed = False
        try:
            # Canonical internal names never use untrusted directory components.
            suffix = path.suffix.lower()
            snapshot_name = "source.stdf" + (suffix if suffix in (".gz", ".bz2", ".zip") else "")
            snapshot = staging / snapshot_name
            digest = hashlib.sha256()
            size = 0
            with path.open("rb") as source, snapshot.open("wb") as output:
                while chunk := source.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_UNCOMPRESSED_BYTES:
                        raise ValueError("The input exceeds the 2 GiB evaluation limit.")
                    digest.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            sha256 = digest.hexdigest()
            with closing(self.connect()) as connection, connection:
                try:
                    connection.execute("BEGIN IMMEDIATE")
                except sqlite3.OperationalError as exc:
                    raise RuntimeError("Another import is busy; retry after it finishes.") from exc
                existing = connection.execute("SELECT * FROM datasets WHERE sha256=?", (sha256,)).fetchone()
                if existing:
                    return {"dataset": _dataset(existing), "duplicate": True}
                normalized = staging / "validated.stdf"
                # The Rust reader chooses compression by suffix. Normalize the
                # rare raw file named .gz/.bz2/.zip too, so byte-based detection
                # remains the import contract for misleading extensions.
                needs_normalized = compression_kind(snapshot) is not None or snapshot.suffix != ".stdf"
                expected = preflight(snapshot, normalized if needs_normalized else None)
                database = staging / "source.db"
                metadata = parse_database(normalized if needs_normalized else snapshot, database, expected)
                # The staging path disappears on publication; retain a usable
                # provenance path in the upstream database before freezing it.
                with closing(sqlite3.connect(database)) as parsed, parsed:
                    parsed.execute("UPDATE File_List SET Filename=?", (str(published / snapshot_name),))
                if needs_normalized:
                    normalized.unlink()
                with database.open("rb+") as parsed_file:
                    os.fsync(parsed_file.fileno())
                result = {"id": dataset_id, "name": path.name, "sha256": sha256,
                          "imported_at": datetime.now(timezone.utc).isoformat(),
                          "bytes": size, **metadata}
                values = [json.dumps(result[key]) if key == "warnings" else result[key] for key in _COLUMNS]
                staging.rename(published)
                connection.execute(
                    f"INSERT INTO datasets ({','.join(_COLUMNS)}) VALUES ({','.join('?' for _ in _COLUMNS)})", values)
            committed = True
            return {"dataset": result, "duplicate": False}
        except (OSError, EOFError, zipfile.BadZipFile) as exc:
            raise ValueError(f"Unable to read or store the STDF import: {exc}") from exc
        finally:
            # Both targets are UUID children created by this call, never a
            # user-selected directory. Never remove a committed import.
            if staging.exists():
                shutil.rmtree(staging)
            if not committed and published.exists():
                shutil.rmtree(published)
