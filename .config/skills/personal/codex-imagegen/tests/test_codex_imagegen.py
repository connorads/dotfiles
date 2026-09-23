"""CLI contract for scripts/codex_imagegen.py against a fake Codex backend."""

from __future__ import annotations

import base64
import json
import os
import stat
import subprocess
import sys
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "codex_imagegen.py"
PNG = b"\x89PNG\r\n\x1a\nfake"


class Backend:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.valid_token = "access-1"

    def handle(self, h: BaseHTTPRequestHandler) -> tuple[int, dict[str, Any]]:
        body = json.loads(h.rfile.read(int(h.headers["Content-Length"])))
        self.requests.append(
            {"path": h.path, "headers": {k.lower(): v for k, v in h.headers.items()}, "body": body}
        )
        if h.path == "/oauth/token":
            self.valid_token = "access-2"
            return 200, {
                "access_token": "access-2",
                "refresh_token": "refresh-2",
                "id_token": "id-2",
            }
        if h.headers["Authorization"] != f"Bearer {self.valid_token}":
            return 401, {"error": "expired"}
        return 200, {
            "created": 1,
            "data": [{"b64_json": base64.b64encode(PNG).decode()}],
            "size": "1254x1254",
        }


@pytest.fixture
def backend() -> Iterator[tuple[Backend, str]]:
    state = Backend()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            status, payload = state.handle(self)
            raw = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def log_message(self, *_: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield state, f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


@pytest.fixture
def codex_home(tmp_path: Path) -> Path:
    home = tmp_path / "codex"
    home.mkdir()
    auth = {
        "OPENAI_API_KEY": None,
        "auth_mode": "chatgpt",
        "last_refresh": "2026-01-01T00:00:00Z",
        "tokens": {
            "access_token": "access-1",
            "refresh_token": "refresh-1",
            "id_token": "id-1",
            "account_id": "acct",
        },
    }
    (home / "auth.json").write_text(json.dumps(auth))
    return home


def run(url: str, home: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = {
        "PATH": "/usr/bin:/bin",
        "CODEX_HOME": str(home),
        "CODEX_IMAGEGEN_BASE_URL": url,
        "CODEX_REFRESH_TOKEN_URL_OVERRIDE": f"{url}/oauth/token",
    }
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args], capture_output=True, text=True, env=env, timeout=30
    )


def test_generate_writes_png_with_codex_auth_headers(
    backend: tuple[Backend, str], codex_home: Path, tmp_path: Path
) -> None:
    state, url = backend
    out = tmp_path / "out" / "img.png"
    res = run(url, codex_home, "a fox", "-o", str(out), "--quality", "low")
    assert res.returncode == 0, res.stderr
    assert out.read_bytes() == PNG
    assert json.loads(res.stdout)["path"] == str(out.resolve())
    [req] = state.requests
    assert req["path"] == "/images/generations"
    assert req["headers"]["chatgpt-account-id"] == "acct"
    assert req["body"] == {
        "prompt": "a fox",
        "model": "gpt-image-2",
        "background": "auto",
        "quality": "low",
        "size": "auto",
    }


def test_ref_images_go_to_edits_as_data_urls(
    backend: tuple[Backend, str], codex_home: Path, tmp_path: Path
) -> None:
    state, url = backend
    ref = tmp_path / "ref.png"
    ref.write_bytes(PNG)
    res = run(url, codex_home, "make it snow", "-r", str(ref), "-o", str(tmp_path / "e.png"))
    assert res.returncode == 0, res.stderr
    [req] = state.requests
    assert req["path"] == "/images/edits"
    assert req["body"]["images"] == [
        {"image_url": "data:image/png;base64," + base64.b64encode(PNG).decode()}
    ]


def test_401_refreshes_writes_tokens_back_and_retries(
    backend: tuple[Backend, str], codex_home: Path, tmp_path: Path
) -> None:
    state, url = backend
    state.valid_token = "access-2"
    res = run(url, codex_home, "a fox", "-o", str(tmp_path / "img.png"))
    assert res.returncode == 0, res.stderr
    assert [r["path"] for r in state.requests] == [
        "/images/generations",
        "/oauth/token",
        "/images/generations",
    ]
    assert state.requests[1]["body"]["refresh_token"] == "refresh-1"
    auth_path = codex_home / "auth.json"
    auth = json.loads(auth_path.read_text())
    assert auth["tokens"] == {
        "access_token": "access-2",
        "refresh_token": "refresh-2",
        "id_token": "id-2",
        "account_id": "acct",
    }
    assert auth["auth_mode"] == "chatgpt"
    assert auth["last_refresh"] != "2026-01-01T00:00:00Z"
    assert stat.S_IMODE(os.stat(auth_path).st_mode) == 0o600


def test_existing_output_is_not_overwritten(
    backend: tuple[Backend, str], codex_home: Path, tmp_path: Path
) -> None:
    state, url = backend
    out = tmp_path / "img.png"
    out.write_bytes(b"keep")
    res = run(url, codex_home, "a fox", "-o", str(out))
    assert res.returncode == 2
    assert out.read_bytes() == b"keep"
    assert state.requests == []
