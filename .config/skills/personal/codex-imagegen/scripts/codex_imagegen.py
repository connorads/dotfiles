#!/usr/bin/env python3
"""Generate or edit an image with gpt-image-2 on the ChatGPT plan Codex is logged in with.

Mirrors Codex's built-in image_gen tool: a JSON POST to the Codex backend's
images endpoint, authenticated with the tokens in $CODEX_HOME/auth.json.
Stdlib only. Prints one JSON line per run on stdout; errors go to stderr.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BASE_URL = os.environ.get("CODEX_IMAGEGEN_BASE_URL", "https://chatgpt.com/backend-api/codex")
TOKEN_URL = os.environ.get(
    "CODEX_REFRESH_TOKEN_URL_OVERRIDE", "https://auth.openai.com/oauth/token"
)
# Codex's public OAuth client id (codex-rs/login); the refresh grant is rejected without it.
CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
IMAGE_MODEL = "gpt-image-2"
MAX_REFS = 5
REFRESH_MARGIN_S = 300
TIMEOUT_S = 300


class Fail(Exception):
    """Actionable error; message goes to stderr, code is the exit status."""

    def __init__(self, message: str, code: int = 1) -> None:
        super().__init__(message)
        self.code = code


def codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")


def load_auth(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise Fail(f"{path} not found. Run `codex login` (ChatGPT sign-in) first.")
    auth = json.loads(path.read_text())
    tokens = auth.get("tokens") or {}
    if not tokens.get("access_token"):
        raise Fail(
            f"{path} has no ChatGPT tokens (auth_mode={auth.get('auth_mode')}). Run `codex login`."
        )
    return auth


def jwt_exp(token: str) -> int | None:
    try:
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return int(claims["exp"])
    except (IndexError, KeyError, ValueError):
        return None


def account_id(tokens: dict[str, Any]) -> str | None:
    if tokens.get("account_id"):
        return str(tokens["account_id"])
    try:
        payload = tokens["access_token"].split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return claims["https://api.openai.com/auth"]["chatgpt_account_id"]
    except (IndexError, KeyError, ValueError):
        return None


def refresh(path: Path) -> dict[str, Any]:
    """Rotate tokens and write them back, as Codex does.

    Refresh tokens are single-use: the new pair must reach auth.json or Codex's
    login breaks. Re-reads the file first in case another process already rotated.
    """
    auth = load_auth(path)
    refresh_token = auth["tokens"].get("refresh_token")
    if not refresh_token:
        raise Fail("auth.json has no refresh_token. Run `codex login`.")
    body = json.dumps(
        {"grant_type": "refresh_token", "client_id": CLIENT_ID, "refresh_token": refresh_token}
    )
    req = urllib.request.Request(
        TOKEN_URL, data=body.encode(), headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            fresh = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        raise Fail(
            f"Token refresh failed ({e.code}): {detail}\nRun `codex login` to sign in again."
        ) from e
    for key in ("id_token", "access_token", "refresh_token"):
        if fresh.get(key):
            auth["tokens"][key] = fresh[key]
    # timezone.utc, not UTC: macOS /usr/bin/python3 is 3.9.
    now = datetime.now(timezone.utc)  # noqa: UP017
    auth["last_refresh"] = now.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".auth.", suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump(auth, f, indent=2)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
    return auth


def codex_version() -> str:
    try:
        out = subprocess.run(
            ["codex", "--version"], capture_output=True, text=True, timeout=10
        ).stdout
        return out.split()[-1]
    except (OSError, subprocess.SubprocessError, IndexError):
        return "0.0.0"


def data_url(path: Path) -> str:
    if not path.is_file():
        raise Fail(f"reference image not found: {path}", 2)
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def post(url: str, body: dict[str, Any], tokens: dict[str, Any], version: str) -> tuple[int, bytes]:
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {tokens['access_token']}",
        "originator": "codex_cli_rs",
        "version": version,
        "User-Agent": f"codex_cli_rs/{version}",
    }
    if acct := account_id(tokens):
        headers["ChatGPT-Account-ID"] = acct
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def run(args: argparse.Namespace) -> dict[str, Any]:
    out = Path(args.out).expanduser()
    if out.exists() and not args.force:
        raise Fail(f"{out} exists; pick a new path or pass --force.", 2)
    prompt = sys.stdin.read() if args.prompt == "-" else args.prompt
    if not prompt.strip():
        raise Fail("empty prompt", 2)
    refs = [Path(r).expanduser() for r in args.ref]
    if len(refs) > MAX_REFS:
        raise Fail(f"at most {MAX_REFS} --ref images", 2)

    body: dict[str, Any] = {
        "prompt": prompt,
        "model": IMAGE_MODEL,
        "background": args.background,
        "quality": args.quality,
        # The server picks dimensions from the prompt for ChatGPT sign-ins; size is ignored.
        "size": "auto",
    }
    if refs:
        body["images"] = [{"image_url": data_url(r)} for r in refs]
    url = f"{BASE_URL}/images/{'edits' if refs else 'generations'}"

    auth_path = codex_home() / "auth.json"
    auth = load_auth(auth_path)
    exp = jwt_exp(auth["tokens"]["access_token"])
    if exp is not None and exp - time.time() < REFRESH_MARGIN_S:
        auth = refresh(auth_path)
    version = codex_version()

    started = time.monotonic()
    status, raw = post(url, body, auth["tokens"], version)
    if status == 401:
        auth = refresh(auth_path)
        status, raw = post(url, body, auth["tokens"], version)
    if status != 200:
        detail = raw.decode(errors="replace")[:500]
        hint = (
            " Image quota likely exhausted; see resets_at."
            if "image_gen" in detail or status == 429
            else ""
        )
        raise Fail(f"HTTP {status} from {url}: {detail}{hint}")

    resp = json.loads(raw)
    b64 = (resp.get("data") or [{}])[0].get("b64_json")
    if not b64:
        raise Fail(f"no image in response: {raw[:300]!r}")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(base64.b64decode(b64))
    return {
        "path": str(out.resolve()),
        "mode": "edit" if refs else "generate",
        "size": resp.get("size"),
        "quality": resp.get("quality"),
        "background": resp.get("background"),
        "seconds": round(time.monotonic() - started, 1),
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("prompt", help="image prompt, or - to read it from stdin")
    p.add_argument("-o", "--out", required=True, help="output PNG path")
    p.add_argument(
        "-r", "--ref", action="append", default=[], help="reference/edit image (repeatable, max 5)"
    )
    p.add_argument("--quality", default="auto", choices=["auto", "low", "medium", "high"])
    p.add_argument("--background", default="auto", choices=["auto", "transparent", "opaque"])
    p.add_argument("--force", action="store_true", help="overwrite --out if it exists")
    try:
        print(json.dumps(run(p.parse_args())))
    except Fail as e:
        print(f"codex_imagegen: {e}", file=sys.stderr)
        return e.code
    return 0


if __name__ == "__main__":
    sys.exit(main())
