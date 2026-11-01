#!/usr/bin/env python3
"""Control proxy in front of a balu e2e stack.

Lets an e2e run make the server "unreachable" on demand, and answer /me with no
memberships when asked. Logs method, path (no query) and status only.

  proxy.py serve [--listen 8090] [--upstream http://127.0.0.1:8091]
  proxy.py ctl on|off dark|dark_on_403|me_empty

Control files (presence = on), in $STATE/ctl:
  dark         - close every connection without a response (server unreachable)
  dark_on_403  - turn `dark` on by itself after relaying a 403 for a /sync request
  me_empty     - rewrite the body of 200 GET /api/v1/me to an empty memberships list

The emulator reaches the proxy via http://10.0.2.2:<listen>. The API helpers
bypass the proxy: run them with `BALU_PORT=<upstream port>`.
"""
from __future__ import annotations

import argparse
import http.server
import json
import os
import re
import socketserver
import sys
import time
import urllib.error
import urllib.request

import balu_e2e as e

CTL = e.STATE / "ctl"
LOG = e.STATE / "proxy.log"
INVITE_PATH = re.compile(r"(/invite/)[^/?#\s]+", re.IGNORECASE)  # as server main.py
NAMES = ("dark", "dark_on_403", "me_empty")


def is_on(name: str) -> bool:
    return (CTL / name).exists()


def make_handler(upstream: str, log):
    class H(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def log_message(self, format, *args):
            pass

        def _go(self):
            path = self.path.split("?")[0]
            shown = INVITE_PATH.sub(r"\1<redacted>", path)
            if is_on("dark"):
                log.write(f"{time.strftime('%H:%M:%S')} {self.command} {shown} DARK\n")
                self.close_connection = True
                self.connection.close()
                return
            n = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(n) if n else None
            hdrs = {
                k: v
                for k, v in self.headers.items()
                if k.lower() not in ("host", "connection", "content-length")
            }
            request = urllib.request.Request(
                upstream + self.path, data=body, method=self.command, headers=hdrs
            )
            try:
                with urllib.request.urlopen(request, timeout=90) as r:
                    status, data, rh = r.status, r.read(), r.headers
            except urllib.error.HTTPError as err:
                status, data, rh = err.code, err.read(), err.headers
            except (urllib.error.URLError, OSError):
                log.write(f"{time.strftime('%H:%M:%S')} {self.command} {shown} 502\n")
                self.send_response(502)
                self.send_header("Content-Length", "0")
                self.send_header("Connection", "close")
                self.end_headers()
                return
            is_me = self.command == "GET" and path == "/api/v1/me" and status == 200
            if is_me and is_on("me_empty"):
                j = json.loads(data)
                j["memberships"] = []
                data = json.dumps(j).encode()
            if status == 403 and "/sync" in path and is_on("dark_on_403"):
                (CTL / "dark").touch()
            log.write(f"{time.strftime('%H:%M:%S')} {self.command} {shown} {status}\n")
            self.send_response(status)
            for k, v in rh.items():
                if k.lower() in ("transfer-encoding", "connection", "content-length"):
                    continue
                self.send_header(k, v)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(data)

        do_GET = do_POST = do_PATCH = do_DELETE = do_PUT = _go

    return H


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def serve(a) -> int:
    e.state_dir()
    CTL.mkdir(mode=0o700, exist_ok=True)
    fd = os.open(LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    log = open(fd, "a", buffering=1, encoding="utf-8")
    LOG.chmod(0o600)
    Server(("127.0.0.1", a.listen), make_handler(a.upstream, log)).serve_forever()
    return 0


def ctl(a) -> int:
    e.state_dir()
    CTL.mkdir(mode=0o700, exist_ok=True)
    flag = CTL / a.name
    if a.state == "on":
        flag.touch()
    else:
        flag.unlink(missing_ok=True)
    print(a.name, a.state)
    return 0


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve")
    s.add_argument("--listen", type=int, default=8090)
    s.add_argument("--upstream", default="http://127.0.0.1:8091")
    s.set_defaults(fn=serve)
    c = sub.add_parser("ctl")
    c.add_argument("state", choices=["on", "off"])
    c.add_argument("name", choices=NAMES)
    c.set_defaults(fn=ctl)
    a = p.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
