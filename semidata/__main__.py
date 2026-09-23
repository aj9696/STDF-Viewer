"""Run with python -m semidata; Ctrl+C cleanly stops the local service."""

import argparse
import logging
from pathlib import Path
import threading
import webbrowser

from .server import WorkbenchServer


def main():
    parser = argparse.ArgumentParser(description="SemiData local test engineering workbench")
    parser.add_argument("--workspace", type=Path, default=Path("workspace"))
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("port must be 0 to 65535")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        server = WorkbenchServer(args.workspace, args.port)
    except OSError as error:
        parser.exit(1, f"Cannot start SemiData: {error}. Try another --port or workspace.\n")
    print(f"SemiData Workbench: {server.origin}\nWorkspace: {server.library.workspace}\nCtrl+C to stop.", flush=True)
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(server.origin)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
