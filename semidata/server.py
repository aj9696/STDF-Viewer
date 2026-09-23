"""Loopback-only transport. Domain calculations live outside request handlers."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
import logging
from pathlib import Path
import secrets
from urllib.parse import parse_qs, urlsplit

from . import __version__
from .analysis import analyze, list_tests
from .demo import create_demo_files
from .documents import DOCS, document_page
from .library import Library
from .pat import RunStore, csv_text, preview, public_result

LOGGER = logging.getLogger("semidata")
ROOT = Path(__file__).resolve().parent
STATIC = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"),
          "/charts.js": ("charts.js", "text/javascript"), "/format.js": ("format.js", "text/javascript"),
          "/styles.css": ("styles.css", "text/css")}


class WorkbenchServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, workspace, port=8765):
        self.library = Library(Path(workspace))
        self.runs = RunStore(self.library)
        self.token = secrets.token_urlsafe(32)
        super().__init__(("127.0.0.1", port), Handler)
        self.authority = f"127.0.0.1:{self.server_port}"
        self.origin = f"http://{self.authority}"


class Handler(BaseHTTPRequestHandler):
    server_version = "SemiData/0.1"

    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def log_message(self, format, *args):
        LOGGER.info("%s", format % args)

    def send(self, body, status=200, content_type="application/json", attachment=None):
        if content_type == "application/json":
            body = json.dumps(body, allow_nan=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; "
                         "style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
                         "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if attachment:
            self.send_header("Content-Disposition", f'attachment; filename="{attachment}"')
        self.end_headers()
        self.wfile.write(body)

    def trusted_request(self):
        if self.headers.get("Host") != self.server.authority:
            self.send({"error": {"code": "FORBIDDEN", "message": "Use the local application address."}}, 403)
            return False
        origin = self.headers.get("Origin")
        if origin and origin != self.server.origin:
            self.send({"error": {"code": "FORBIDDEN", "message": "Cross-origin requests are not allowed."}}, 403)
            return False
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            self.send({"error": {"code": "FORBIDDEN", "message": "Cross-site requests are not allowed."}}, 403)
            return False
        return True

    def handle_error(self, error):
        if isinstance(error, (ValueError, FileNotFoundError)):
            self.send({"error": {"code": "INVALID_INPUT", "message": str(error)}}, 400)
        elif isinstance(error, KeyError):
            self.send({"error": {"code": "NOT_FOUND", "message": str(error).strip("'")}}, 404)
        elif isinstance(error, PermissionError):
            self.send({"error": {"code": "FILE_ACCESS", "message": "Cannot access this file or workspace. Check permissions and other running imports."}}, 409)
        else:
            LOGGER.exception("Request failed")
            self.send({"error": {"code": "INTERNAL_ERROR", "message": "Operation failed. See the application terminal for details."}}, 500)

    def do_GET(self):
        if not self.trusted_request():
            return
        try:
            target = urlsplit(self.path)
            path = target.path
            if path in STATIC:
                filename, content_type = STATIC[path]
                self.send((ROOT / "static" / filename).read_bytes(), content_type=content_type)
            elif path == "/api/state":
                self.send({"version": __version__, "token": self.server.token,
                           "workspace": str(self.server.library.workspace),
                           "datasets": self.server.library.list_datasets(), "runs": self.server.runs.list()})
            elif path == "/api/tests":
                ids = parse_qs(target.query).get("datasets", [""])[0].split(",")
                self.send(list_tests(self.server.library, ids))
            elif path.startswith("/api/runs/"):
                parts = path.split("/")
                if len(parts) not in (4, 5) or (len(parts) == 5 and parts[4] != "csv"):
                    raise KeyError("Route not found.")
                result = self.server.runs.get(parts[3])
                if len(parts) == 5:
                    self.send(csv_text(result), content_type="text/csv", attachment=f"pat-{result['id']}.csv")
                else:
                    self.send(public_result(result))
            elif path == "/guide" or path.startswith("/docs/"):
                name = "engineer-guide" if path == "/guide" else path.removeprefix("/docs/").removesuffix(".md")
                if name not in DOCS:
                    raise KeyError("Document not found.")
                text = (ROOT.parent / "docs" / f"{name}.md").read_text(encoding="utf-8")
                self.send(document_page(name, text), content_type="text/html")
            else:
                raise KeyError("Route not found.")
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:
            self.handle_error(error)

    def do_POST(self):
        if not self.trusted_request():
            return
        if not hmac.compare_digest(self.headers.get("X-SemiData-Token", ""), self.server.token):
            self.send({"error": {"code": "FORBIDDEN", "message": "Reload the application and try again."}}, 403)
            return
        try:
            if self.headers.get_content_type() != "application/json":
                raise ValueError("JSON request body is required.")
            size = int(self.headers.get("Content-Length", "0"))
            if not 1 <= size <= 65536:
                raise ValueError("Request must contain between 1 byte and 64 KiB of JSON.")
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise ValueError("JSON body must be an object.")
            path = urlsplit(self.path).path
            if path == "/api/imports":
                local_path = payload.get("path")
                if not isinstance(local_path, str) or not local_path.strip():
                    raise ValueError("Enter the full path to an STDF file.")
                self.send(self.server.library.import_file(local_path.strip().strip('"')))
            elif path == "/api/demo":
                fixtures = create_demo_files(self.server.library.workspace / "demo-sources")
                self.send({"datasets": [self.server.library.import_file(p)["dataset"] for p in fixtures]})
            elif path == "/api/analysis":
                self.send(analyze(self.server.library, payload))
            elif path == "/api/pat/preview":
                self.send(public_result(preview(self.server.library, payload)))
            elif path == "/api/runs":
                self.send(public_result(self.server.runs.save(payload)), 201)
            else:
                raise KeyError("Route not found.")
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:
            self.handle_error(error)
