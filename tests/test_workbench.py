"""End-to-end domain and HTTP tests using actual STDF parsing."""

from contextlib import closing
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import uuid

from semidata.analysis import analyze, list_tests
from semidata.demo import create_demo_files
from semidata.documents import DOCS
from semidata.library import Library
from semidata.pat import RunStore, csv_text, preview
from semidata.server import WorkbenchServer


class WorkbenchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(tempfile.gettempdir()) / f"semidata-integration-{uuid.uuid4().hex}"
        cls.root.mkdir()
        cls.library = Library(cls.root / "workspace")
        cls.datasets = [cls.library.import_file(path)["dataset"] for path in create_demo_files(cls.root / "fixtures")]
        cls.ids = [d["id"] for d in cls.datasets]
        cls.key = next(t["key"] for t in list_tests(cls.library, cls.ids)["tests"] if t["number"] == 1001)
        cls.selection = {"dataset_ids": cls.ids, "test_key": cls.key, "attempts": "current", "site": None}

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.root)

    def test_analysis_comparison_uses_real_parser_and_site_scope(self):
        result = analyze(self.library, self.selection)
        self.assertEqual(result["population"], {"total": 360, "valid": 360, "excluded": 0})
        self.assertEqual(sum(b["count"] for b in result["histogram"]), 360)
        self.assertLess(result["groups"][0]["mean"], result["groups"][2]["mean"])
        scoped = analyze(self.library, {**self.selection, "site": 1})
        self.assertEqual(scoped["stats"]["count"], 180)

    def test_saved_pat_reopens_exactly_and_never_changes_sources(self):
        hashes = [hashlib.sha256(self.library.database_path(i).read_bytes()).hexdigest() for i in self.ids]
        recipe = {"name": "Baseline VDD screen", "selection": {**self.selection, "dataset_ids": [self.ids[2]]},
                  "reference_ids": [self.ids[0]], "method": "mad", "k": 3}
        result = preview(self.library, recipe)
        self.assertEqual(result["reference_count"], 120)
        self.assertEqual(result["evaluated_count"], 119)
        self.assertEqual(result["excluded_count"], 1)
        flagged_parts = {r["part_id"] for r in result["flagged"]}
        self.assertTrue({"D0018", "D0062", "D0104"}.issubset(flagged_parts))
        saved = RunStore(self.library).save(recipe)
        reopened = RunStore(Library(self.library.workspace)).get(saved["id"])
        self.assertEqual(saved, reopened)
        self.assertEqual(len(csv_text(reopened).splitlines()) - 1, saved["flagged_count"])
        self.assertEqual(hashes, [hashlib.sha256(self.library.database_path(i).read_bytes()).hexdigest() for i in self.ids])

    def test_http_rejects_untrusted_writes_and_serves_real_analysis(self):
        server = WorkbenchServer(self.library.workspace, 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            def request(path, data=None, headers=None):
                body = None if data is None else json.dumps(data).encode()
                return urlopen(Request(server.origin + path, body, headers=headers or {}), timeout=10)

            with request("/api/state") as response:
                state = json.load(response)
            self.assertEqual(len(state["datasets"]), 3)
            for path, content_type in [("/", "text/html"), ("/app.js", "text/javascript"),
                                       ("/charts.js", "text/javascript"), ("/format.js", "text/javascript"),
                                       ("/styles.css", "text/css")]:
                with self.subTest(path=path), request(path) as response:
                    self.assertEqual(response.headers.get_content_type(), content_type)
                    self.assertTrue(response.read())
            for name in DOCS:
                with self.subTest(document=name), request("/docs/" + name) as response:
                    self.assertIn(b"Back to SemiData", response.read())
            for headers in [{"Content-Type": "application/json"},
                            {"Content-Type": "application/json", "X-SemiData-Token": state["token"], "Origin": "https://evil.example"}]:
                with self.assertRaises(HTTPError) as error:
                    request("/api/analysis", self.selection, headers)
                self.assertEqual(error.exception.code, 403)
            with self.assertRaises(HTTPError) as error:
                request("/api/state", headers={"Host": "evil.example"})
            self.assertEqual(error.exception.code, 403)
            with request("/api/analysis", self.selection,
                         {"Content-Type": "application/json", "X-SemiData-Token": state["token"]}) as response:
                self.assertEqual(json.load(response)["stats"]["count"], 360)
            with self.assertRaises(HTTPError) as error:
                request("/../../LICENSE")
            self.assertEqual(error.exception.code, 404)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
