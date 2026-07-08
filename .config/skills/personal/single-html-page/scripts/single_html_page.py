#!/usr/bin/env python3
"""Bundle an HTML page or URL into one shareable HTML file."""

from __future__ import annotations

import argparse
import html.parser
import os
import re
import shutil
import subprocess
import sys
import urllib.parse
from pathlib import Path


ASSET_LINK_RELS = {
    "apple-touch-icon",
    "dns-prefetch",
    "icon",
    "manifest",
    "modulepreload",
    "preconnect",
    "prefetch",
    "preload",
    "shortcut",
    "stylesheet",
}
NETWORK_HINT_RELS = {"dns-prefetch", "modulepreload", "preconnect", "prefetch", "preload"}
CSS_URL_RE = re.compile(r"url\(([^)]+)\)", re.I)
CSS_IMPORT_RE = re.compile(r"@import\s+(?:url\()?['\"]?([^'\";)]+)", re.I)


class AssetRefParser(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.refs: list[tuple[str, str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._collect(tag.lower(), attrs)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._collect(tag.lower(), attrs)

    def _collect(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key.lower(): value or "" for key, value in attrs}
        rels = {part.strip().lower() for part in data.get("rel", "").split() if part.strip()}

        for attr in ("src", "poster", "data"):
            value = data.get(attr)
            if value:
                self.refs.append((tag, attr, value))

        if data.get("srcset"):
            for value in parse_srcset(data["srcset"]):
                self.refs.append((tag, "srcset", value))

        href = data.get("href")
        if href and tag == "link" and rels.intersection(ASSET_LINK_RELS):
            self.refs.append((tag, "href", href))


def parse_srcset(value: str) -> list[str]:
    refs: list[str] = []
    for candidate in value.split(","):
        candidate = candidate.strip()
        if candidate:
            refs.append(candidate.split()[0])
    return refs


def is_url(value: str) -> bool:
    return urllib.parse.urlparse(value).scheme in {"http", "https"}


def default_output(target: str) -> Path:
    if is_url(target):
        parsed = urllib.parse.urlparse(target)
        slug = "-".join(part for part in [parsed.netloc, parsed.path.strip("/").replace("/", "-")] if part)
        slug = re.sub(r"[^A-Za-z0-9._-]+", "-", slug).strip(".-") or "page"
        return Path(f"{slug}-shareable.html")
    path = Path(target)
    return path.with_name(f"{path.stem}-shareable.html")


def base_url_for(target: str) -> str | None:
    if is_url(target) or target == "-":
        return None
    path = Path(target).expanduser().resolve()
    return path.parent.as_uri() + "/"


def run_monolith(args: argparse.Namespace, output: Path) -> None:
    monolith = shutil.which("monolith")
    if not monolith:
        raise SystemExit(
            "monolith not found on PATH. Install or enable it through the local "
            "tool manager, then rerun this script."
        )

    cmd = [monolith, "-q", "-I", "-M", "-o", str(output)]
    if args.ignore_errors:
        cmd.append("-e")
    if args.timeout:
        cmd.extend(["-t", str(args.timeout)])
    if args.user_agent:
        cmd.extend(["-u", args.user_agent])
    if args.no_js:
        cmd.append("-j")
    if args.no_frames:
        cmd.append("-f")
    if args.no_audio:
        cmd.append("-a")
    if args.no_video:
        cmd.append("-v")

    if base_url := base_url_for(args.target):
        cmd.extend(["-b", base_url])
    cmd.append(args.target)

    subprocess.run(cmd, check=True)


def strip_base_tags(text: str) -> str:
    return re.sub(r"<base\b[^>]*>", "", text, flags=re.I)


def strip_network_hint_links(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        tag = match.group(0)
        rel_match = re.search(r"""\brel\s*=\s*(["']?)([^"'\s>]+(?:\s+[^"'\s>]+)*)\1""", tag, re.I)
        if not rel_match:
            return tag
        rels = {part.strip().lower() for part in rel_match.group(2).split() if part.strip()}
        return "" if rels.intersection(NETWORK_HINT_RELS) else tag

    return re.sub(r"<link\b[^>]*>", replace, text, flags=re.I)


def clean_ref(value: str) -> str:
    value = value.strip().strip("\"'")
    return value.replace("&amp;", "&")


def is_embedded_or_safe(value: str) -> bool:
    value = clean_ref(value)
    if not value:
        return True
    if value.startswith("#"):
        return True
    parsed = urllib.parse.urlparse(value)
    return parsed.scheme in {"data", "blob"}


def remaining_asset_refs(text: str) -> list[str]:
    parser = AssetRefParser()
    parser.feed(text)
    refs = [f"<{tag} {attr}={value}>" for tag, attr, value in parser.refs if not is_embedded_or_safe(value)]

    for match in CSS_URL_RE.finditer(text):
        value = clean_ref(match.group(1))
        if not is_embedded_or_safe(value) and not value.startswith("#"):
            refs.append(f"CSS url({value})")

    for match in CSS_IMPORT_RE.finditer(text):
        value = clean_ref(match.group(1))
        if not is_embedded_or_safe(value):
            refs.append(f"CSS @import {value}")

    return sorted(set(refs))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", help="Local HTML file, URL, or '-' for stdin")
    parser.add_argument("-o", "--output", type=Path, help="Output HTML path")
    parser.add_argument("--timeout", type=int, default=60, help="Network timeout passed to monolith")
    parser.add_argument("--strict", action="store_true", help="Fail monolith on network errors")
    parser.add_argument("--keep-network-hints", action="store_true", help="Keep preconnect/prefetch link tags")
    parser.add_argument("--user-agent", help="Custom user agent passed to monolith")
    parser.add_argument("--no-js", action="store_true", help="Remove JavaScript")
    parser.add_argument("--no-frames", action="store_true", help="Remove frames and iframes")
    parser.add_argument("--no-audio", action="store_true", help="Remove audio sources")
    parser.add_argument("--no-video", action="store_true", help="Remove video sources")
    args = parser.parse_args()
    args.ignore_errors = not args.strict

    output = args.output or default_output(args.target)
    output = output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    run_monolith(args, output)

    text = output.read_text(encoding="utf-8", errors="replace")
    text = strip_base_tags(text)
    if not args.keep_network_hints:
        text = strip_network_hint_links(text)
    output.write_text(text, encoding="utf-8")

    refs = remaining_asset_refs(text)
    print(f"Wrote {output}")
    print(f"Size: {output.stat().st_size:,} bytes")
    if refs:
        print("Remaining asset references:", file=sys.stderr)
        for ref in refs[:50]:
            print(f"- {ref}", file=sys.stderr)
        if len(refs) > 50:
            print(f"- ... {len(refs) - 50} more", file=sys.stderr)
        return 2

    print("Verification: no external or local asset references found")
    return 0


if __name__ == "__main__":
    os.environ.setdefault("NO_COLOR", "1")
    raise SystemExit(main())
