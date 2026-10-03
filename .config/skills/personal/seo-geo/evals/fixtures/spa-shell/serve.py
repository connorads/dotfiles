#!/usr/bin/env python3
"""Serve a client-only SPA the way a misconfigured Express catch-all does.

Usage: python3 serve.py PORT

Every path returns 200 and the same HTML shell, including /robots.txt,
/sitemap.xml and unknown paths. Only the per-path self-canonical differs.
The one exception is /assets/app.js, the bundle that renders the page.
If PORT is taken, it binds a free port instead. It prints the URL it uses.
"""

from __future__ import annotations

import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
SHELL = (HERE / "index.html").read_text(encoding="utf-8")
BUNDLE = (HERE / "assets" / "app.js").read_bytes()


class Handler(BaseHTTPRequestHandler):
    server_version = "nginx"
    sys_version = ""

    def _send(self, body: bytes, ctype: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Powered-By", "Express")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _route(self) -> None:
        path = urlsplit(self.path).path or "/"
        if path == "/assets/app.js":
            self._send(BUNDLE, "application/javascript; charset=utf-8")
            return
        host = self.headers.get("Host") or f"127.0.0.1:{self.server.server_port}"
        html = SHELL.replace("{{CANONICAL}}", f"http://{host}{path}")
        self._send(html.encode("utf-8"), "text/html; charset=utf-8")

    do_GET = _route
    do_HEAD = _route

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("%s %s\n" % (self.command, self.path))


def main(argv: list[str]) -> int:
    if len(argv) != 2 or not argv[1].isdigit():
        sys.stderr.write("usage: python3 serve.py PORT\n")
        return 2
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", int(argv[1])), Handler)
    except OSError:
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        sys.stderr.write(f"port {argv[1]} in use; using a free port\n")
    print(f"serving on http://127.0.0.1:{httpd.server_port}/", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
