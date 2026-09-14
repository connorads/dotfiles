#!/usr/bin/env python3
"""Reach the inspo archive of real production websites without an MCP server.

The archive behind ``inspo-mcp`` is served over unauthenticated public HTTP, so
the MCP layer is packaging rather than the product. This script speaks the same
stateless JSON-RPC and downloads the same captures, at zero per-session cost.

Usage:
    inspo.py tools
    inspo.py call <tool> [--arg KEY=VALUE]... [--json OBJECT]
    inspo.py recommend "<brief>"
    inspo.py shots <slug>... [--variant hero|thumb|full|mobile|mobile-full]

Exit status: 0 ok, 1 the operation failed, 2 bad arguments.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from hashlib import sha256
from pathlib import Path
from typing import Any

ENDPOINT = "https://inspomcp.dev/api/mcp"
BLOB_BASE = "https://0nme3pk5am3urwa9.public.blob.vercel-storage.com/captures"
USER_AGENT = "inspo-skill/1 (stdlib urllib)"

DEFAULT_MAX_TOKENS = 4000
DEFAULT_MAX_BYTES = 1_048_576
DEFAULT_TIMEOUT = 30
# A request body is capped at 256 KB upstream and the rate limit is per IP, so a
# wide batch is also the shape most likely to hit it. Eight is a reading list.
MAX_SLUGS = 8

# Capture filename and the get_screen field that also names it. The naming is
# not derivable: `mobile-full` is a PNG while every other variant is WebP, so a
# constructed `<variant>.webp` 404s on exactly one of the five.
VARIANTS: dict[str, tuple[str, str]] = {
    "hero": ("hero.1440.webp", "image"),
    "thumb": ("thumb.384.webp", "thumb"),
    "full": ("full.1440.webp", "fullPage"),
    "mobile": ("mobile.384.webp", "mobile"),
    "mobile-full": ("mobile-full.png", "mobileFull"),
}


class InspoError(Exception):
    """The operation failed: exit 1."""


class UsageError(Exception):
    """The arguments were wrong: exit 2."""


# --------------------------------------------------------------------------
# Transport
# --------------------------------------------------------------------------


def build_request(
    endpoint: str, method: str, params: dict[str, Any], max_tokens: int
) -> urllib.request.Request:
    """One JSON-RPC request.

    Two details the server enforces and nothing else records. The ``Accept``
    header must list **both** types or the Streamable-HTTP transport answers
    406, whatever the body says. And ``images=none`` suppresses the base64
    image block while leaving every capture URL in the text payload, which is
    what keeps a megabyte of encoded screenshot out of the agent's context.
    """
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    return urllib.request.Request(
        f"{endpoint}?images=none&maxTokens={max_tokens}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "User-Agent": USER_AGENT,
        },
    )


def fetch(request: urllib.request.Request | str, timeout: int, max_bytes: int) -> bytes:
    """Retrieve one body, refusing to hold more than ``max_bytes`` of it.

    No retry anywhere, including on 429: a script that sleeps and tries again
    is the failure the harness cannot recover from, so the rate limit surfaces
    as an exit telling the caller to wait.
    """
    if isinstance(request, str):
        request = urllib.request.Request(request, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            chunks: list[bytes] = []
            total = 0
            while True:
                chunk = response.read(min(65536, max_bytes - total + 1))
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)
                if total > max_bytes:
                    raise InspoError(
                        f"response exceeds --max-bytes ({max_bytes}): {request.full_url}"
                    )
            return b"".join(chunks)
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            raise InspoError(
                "rate limited (120 requests/minute per IP); wait a minute and rerun"
            ) from exc
        raise InspoError(f"HTTP {exc.code} from {request.full_url}") from exc
    except urllib.error.URLError as exc:
        raise InspoError(f"cannot reach {request.full_url}: {exc.reason}") from exc


# --------------------------------------------------------------------------
# Cache
# --------------------------------------------------------------------------


class Cache:
    """Fetched bytes on disk, indexed by a readable manifest.

    Captures are read **and** written: the same screenshot is worth downloading
    once. Tool responses are only ever **read**, so a real run never accumulates
    a stale copy of a search the archive has since re-ranked. The tests populate
    both sides by hand, which is what the manifest is for: a content-addressed
    cache is fine for a throwaway run and unreviewable in a repo.
    """

    def __init__(self, directory: Path, offline: bool) -> None:
        self.dir = directory
        self.offline = offline
        self.manifest_path = directory / "manifest.json"
        self.manifest: dict[str, str] = {}
        if self.manifest_path.exists():
            self.manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))

    def path_for(self, key: str) -> Path | None:
        name = self.manifest.get(key)
        if not name:
            return None
        path = self.dir / name
        return path if path.exists() else None

    def get(self, key: str) -> bytes | None:
        path = self.path_for(key)
        return path.read_bytes() if path else None

    def put(self, key: str, data: bytes, name: str | None = None) -> Path:
        name = self.manifest.get(key) or name or f"bodies/{sha256(key.encode()).hexdigest()[:16]}"
        path = self.dir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        self.manifest[key] = name
        self.manifest_path.write_text(
            json.dumps(dict(sorted(self.manifest.items())), indent=2) + "\n", encoding="utf-8"
        )
        return path


def default_cache_dir() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or (Path.home() / ".cache")
    return Path(base) / "inspo"


# --------------------------------------------------------------------------
# Response classifier
# --------------------------------------------------------------------------


def rpc_key(method: str, params: dict[str, Any], max_tokens: int) -> str:
    return f"{method} {json.dumps(params, sort_keys=True)} maxTokens={max_tokens}"


def post(
    method: str, params: dict[str, Any], opts: argparse.Namespace, cache: Cache
) -> dict[str, Any]:
    """Send one JSON-RPC call and return its ``result``."""
    key = rpc_key(method, params, opts.max_tokens)
    body = cache.get(key)
    if body is None:
        if cache.offline:
            raise InspoError(f"not in cache and --offline was given: {key}")
        request = build_request(opts.endpoint, method, params, opts.max_tokens)
        body = fetch(request, opts.timeout, opts.max_bytes)
    try:
        payload = json.loads(body)
    except ValueError as exc:
        raise InspoError(f"response was not JSON: {body[:200]!r}") from exc
    if not isinstance(payload, dict):
        raise InspoError(f"response was not a JSON-RPC envelope: {body[:200]!r}")
    if "error" in payload:
        error = payload["error"]
        message = error.get("message", error) if isinstance(error, dict) else error
        raise InspoError(str(message))
    return payload.get("result") or {}


def tool_text(result: dict[str, Any]) -> str:
    """The text payload of a tool result, triaging both of the error channels.

    They are not one channel. A bad argument comes back as ``isError: true``
    with an ``MCP error -32602`` text; an unknown slug comes back HTTP 200 with
    **no** ``isError`` at all, and a JSON body whose only key is ``error``.
    Reading the second as success hands the agent an error string as its design
    brief, which is a failure that looks exactly like working software.
    """
    text = "\n".join(
        block.get("text", "") for block in result.get("content", []) if block.get("type") == "text"
    ).strip()

    if result.get("isError"):
        raise InspoError(text or "the tool call failed and said nothing")

    try:
        parsed = json.loads(text)
    except ValueError:
        return text

    if isinstance(parsed, dict):
        if "error" in parsed:
            hint = parsed.get("hint")
            raise InspoError(f"{parsed['error']}{f' {hint}' if hint else ''}")
        note = parsed.get("budgetNote")
        if note:
            # Stderr, so stdout stays a clean JSON document. The server drops
            # whole ranked records rather than bytes, and says which, so its
            # trimming is better than anything this script could do.
            print(f"inspo: {note}", file=sys.stderr)
    return text


def call_tool(tool: str, arguments: dict[str, Any], opts: argparse.Namespace, cache: Cache) -> str:
    return tool_text(post("tools/call", {"name": tool, "arguments": arguments}, opts, cache))


# --------------------------------------------------------------------------
# Subcommands
# --------------------------------------------------------------------------


def cmd_tools(opts: argparse.Namespace, cache: Cache) -> int:
    result = post("tools/list", {}, opts, cache)
    print("# inspo tools (* = required argument)")
    for tool in result.get("tools", []):
        schema = tool.get("inputSchema") or {}
        required = set(schema.get("required") or [])
        properties: dict[str, Any] = schema.get("properties") or {}
        names = ", ".join(f"{name}*" if name in required else name for name in properties)
        print(f"\n{tool.get('name')}({names})")
        description = (tool.get("description") or "").strip()
        if description:
            print(f"    {description}")
        # The accepted values, not just the argument names. A rejected call is
        # the whole cost of guessing one, and the schema is the only place they
        # are written down.
        for name, spec in properties.items():
            if spec.get("enum"):
                print(f"    {name}: {'|'.join(str(value) for value in spec['enum'])}")
    return 0


def parse_arg_pairs(pairs: list[str]) -> dict[str, Any]:
    """``KEY=VALUE`` pairs into tool arguments, splitting on the first ``=``.

    Each value is coerced with ``json.loads`` and falls back to the raw string,
    so ``limit=3`` is an int, ``slugs=["a","b"]`` is a list, and an apostrophe
    in a brief survives the shell without a layer of nested JSON quoting.
    """
    arguments: dict[str, Any] = {}
    for pair in pairs:
        key, separator, raw = pair.partition("=")
        if not separator or not key:
            raise UsageError(f"--arg wants KEY=VALUE, got {pair!r}")
        try:
            arguments[key] = json.loads(raw)
        except ValueError:
            arguments[key] = raw
    return arguments


def call_arguments(opts: argparse.Namespace) -> dict[str, Any]:
    """Tool arguments from ``--json`` overlaid with ``--arg``. Pure: no I/O."""
    arguments: dict[str, Any] = {}
    if opts.json:
        try:
            decoded = json.loads(opts.json)
        except ValueError as exc:
            raise UsageError(f"--json is not valid JSON: {exc}") from exc
        if not isinstance(decoded, dict):
            raise UsageError("--json must be a JSON object of tool arguments")
        arguments.update(decoded)
    arguments.update(parse_arg_pairs(opts.arg))
    return arguments


def cmd_call(opts: argparse.Namespace, cache: Cache) -> int:
    print(call_tool(opts.tool, opts.arguments, opts, cache))
    return 0


def cmd_recommend(opts: argparse.Namespace, cache: Cache) -> int:
    print(call_tool("recommend", {"brief": opts.brief}, opts, cache))
    return 0


def capture_url(slug: str, variant: str) -> str:
    return f"{BLOB_BASE}/{slug}/{VARIANTS[variant][0]}"


def authoritative_url(slug: str, variant: str, opts: argparse.Namespace, cache: Cache) -> str:
    """The capture URL the archive itself reports for a slug."""
    screen = json.loads(call_tool("get_screen", {"slug": slug}, opts, cache))
    url = screen.get(VARIANTS[variant][1])
    if not url:
        raise InspoError(f"{slug} publishes no {variant} capture")
    return str(url)


def download(slug: str, variant: str, opts: argparse.Namespace, cache: Cache) -> Path:
    """One capture on disk, by the constructed URL or by the archive's own."""
    key = capture_url(slug, variant)
    cached = cache.path_for(key)
    if cached:
        return cached
    if cache.offline:
        raise InspoError(f"not in cache and --offline was given: {key}")
    try:
        data = fetch(key, opts.timeout, opts.max_bytes)
    except InspoError:
        # The filename scheme is this host's, undocumented, and not ours to
        # pin. Asking the archive where the capture actually is costs one call
        # and lets an upstream rename heal instead of killing the command.
        data = fetch(
            authoritative_url(slug, variant, opts, cache).split("?", 1)[0],
            opts.timeout,
            opts.max_bytes,
        )
    return cache.put(key, data, name=f"captures/{slug}/{VARIANTS[variant][0]}")


def cmd_shots(opts: argparse.Namespace, cache: Cache) -> int:
    if len(opts.slugs) > MAX_SLUGS:
        raise UsageError(f"at most {MAX_SLUGS} slugs per run, got {len(opts.slugs)}")
    failed: list[str] = []
    for slug in opts.slugs:
        try:
            print(download(slug, opts.variant, opts, cache).resolve())
        except InspoError as exc:
            print(f"inspo: {slug}: {exc}", file=sys.stderr)
            failed.append(slug)
    if failed:
        # Partial success at exit 0 reads as "every screenshot is there" to
        # whatever reads the path list next.
        raise InspoError(f"no capture for: {', '.join(failed)}")
    return 0


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="inspo.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--endpoint", default=ENDPOINT, help="JSON-RPC endpoint")
    parser.add_argument("--cache", type=Path, help="cache directory (default: XDG cache)")
    parser.add_argument("--offline", action="store_true", help="never fetch; a miss fails")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="seconds per request")
    parser.add_argument(
        "--max-tokens", type=int, default=DEFAULT_MAX_TOKENS, help="server-side response budget"
    )
    parser.add_argument(
        "--max-bytes", type=int, default=DEFAULT_MAX_BYTES, help="refuse a body larger than this"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("tools", help="live listing of every tool and its arguments")

    call = sub.add_parser("call", help="call any tool")
    call.add_argument("tool")
    call.add_argument("--arg", action="append", default=[], metavar="KEY=VALUE")
    call.add_argument("--json", metavar="OBJECT", help="tool arguments as one JSON object")

    recommend = sub.add_parser("recommend", help="ranked screens for a free-text brief")
    recommend.add_argument("brief")

    shots = sub.add_parser("shots", help="download captures, printing one path per line")
    shots.add_argument("slugs", nargs="+")
    shots.add_argument("--variant", default="hero", choices=sorted(VARIANTS))
    return parser


def main(argv: list[str] | None = None) -> int:
    opts = build_parser().parse_args(argv)
    commands = {
        "tools": cmd_tools,
        "call": cmd_call,
        "recommend": cmd_recommend,
        "shots": cmd_shots,
    }
    try:
        # Arguments are assembled before the cache directory is read and before
        # anything is fetched, so a typo never costs a request.
        if opts.command == "call":
            opts.arguments = call_arguments(opts)
        cache = Cache(opts.cache or default_cache_dir(), offline=opts.offline)
        return commands[opts.command](opts, cache)
    except UsageError as exc:
        print(f"inspo: {exc}", file=sys.stderr)
        return 2
    except InspoError as exc:
        print(f"inspo: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
