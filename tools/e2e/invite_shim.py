#!/usr/bin/env python3
"""Local redirect shim for web e2e runs.

Serves GET /invite/<role> as a 302 to the real invite URL (token saved by
`api.py invite <role>`). The token is read here, server-side, so it never shows up
in a helper's output or in a browser-side script. The browser tool's page URL after the
redirect still shows the token. Serves nothing else; no logging.
"""
from __future__ import annotations

import argparse
import http.server
import os
import re

import balu_e2e as e

PUBLIC = os.environ.get("BALU_E2E_PUBLIC_BASE", f"http://localhost:{e.PORT}")


class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parts = self.path.strip("/").split("/")
        if len(parts) == 2 and parts[0] == "invite" and re.fullmatch(r"[a-z]+", parts[1]):
            path = e.run_dir() / f"invite-{parts[1]}.token"
            if path.exists():
                self.send_response(302)
                tok = path.read_text(encoding="utf-8").strip()
                self.send_header("Location", f"{PUBLIC}/invite/{tok}")
                self.end_headers()
                return
        self.send_response(404)
        self.end_headers()

    def log_message(self, format, *args):
        pass


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--port", type=int, default=8099)
    a = p.parse_args()
    http.server.HTTPServer(("127.0.0.1", a.port), H).serve_forever()


if __name__ == "__main__":
    main()
