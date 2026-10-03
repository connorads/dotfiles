#!/usr/bin/env python3
"""Recheck references/volatile-facts.md rows against their primary sources.

Reads evals/fact-claims.json. Each claim has an `id` (a volatile-facts row),
a `url`, and `needle` (texts that must appear) and/or `absent` (texts that
must not appear). Matching is case-insensitive on whitespace-collapsed text,
with curly quotes and dashes folded. A needle passes if it appears in the
tag-stripped text or in the raw body; an absent text fails if it appears in
either.

Usage: python3 evals/check_facts.py [--id ID ...] [--json] [--timeout S]

One line per claim: OK | DRIFT | FETCH-FAIL, id, detail.
Exit 0 all OK; 1 any DRIFT; 2 any FETCH-FAIL and no DRIFT (the check is
incomplete, never a pass).
"""

from __future__ import annotations

import argparse
import gzip
import html
import json
import re
import sys
import urllib.error
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path

UA = "Mozilla/5.0 (compatible; seo-geo-fact-check/1.0; Agent Skill maintainer check)"
CLAIMS = Path(__file__).resolve().parent / "fact-claims.json"
FOLD = str.maketrans(
    {
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2013": "-",
        "\u2014": "-",
        "\u00a0": " ",
        "\u2011": "-",
    }
)

BLOCK = {
    "p",
    "div",
    "li",
    "tr",
    "td",
    "th",
    "br",
    "pre",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "section",
    "article",
    "table",
    "ul",
    "ol",
    "dt",
    "dd",
    "blockquote",
}


class _Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self.skip += 1
        if tag in BLOCK:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript") and self.skip:
            self.skip -= 1
        if tag in BLOCK:
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)

    def handle_entityref(self, name):
        if not self.skip:
            self.parts.append(f"&{name};")

    def handle_charref(self, name):
        if not self.skip:
            self.parts.append(f"&#{name};")


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(s).translate(FOLD)).strip().lower()


def fetch(url: str, timeout: float) -> tuple[str | None, str]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept-Encoding": "gzip, deflate",
            "Accept": "text/html,application/json,text/plain,*/*",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            enc = (r.headers.get("Content-Encoding") or "").lower()
            if enc == "gzip":
                body = gzip.decompress(body)
            elif enc == "deflate":
                body = zlib.decompress(body)
            charset = r.headers.get_content_charset() or "utf-8"
            return body.decode(charset, errors="replace"), f"{r.status}"
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except Exception as e:  # any failure becomes a FETCH-FAIL row
        return None, f"{type(e).__name__}: {e}"[:100]


def check(claim: dict, pages: dict) -> dict:
    body, status = pages[claim["url"]]
    out = {"id": claim["id"], "url": claim["url"]}
    if body is None:
        return out | {"result": "FETCH-FAIL", "detail": status}
    if len(body) < 200:
        return out | {"result": "FETCH-FAIL", "detail": f"body only {len(body)} chars"}
    p = _Text()
    p.feed(body)
    text, raw = norm("".join(p.parts)), norm(body)
    missing = [n for n in claim.get("needle", []) if norm(n) not in text and norm(n) not in raw]
    present = [a for a in claim.get("absent", []) if norm(a) in text or norm(a) in raw]
    if missing or present:
        bits = ([f"missing {missing!r}"] if missing else []) + (
            [f"present {present!r}"] if present else []
        )
        return out | {"result": "DRIFT", "detail": "; ".join(bits)[:160]}
    return out | {"result": "OK", "detail": ""}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--id", action="append", help="check only this id (repeatable)")
    ap.add_argument("--json", action="store_true", help="emit JSON Lines")
    ap.add_argument("--timeout", type=float, default=30.0)
    a = ap.parse_args()
    try:
        claims = json.loads(CLAIMS.read_text())
    except (OSError, json.JSONDecodeError) as e:
        print(f"usage error: cannot read {CLAIMS.name}: {e}", file=sys.stderr)
        return 2
    if a.id:
        claims = [c for c in claims if c["id"] in set(a.id)]
        if not claims:
            print(f"usage error: no claim with id {a.id}", file=sys.stderr)
            return 2
    urls = sorted({c["url"] for c in claims})
    with ThreadPoolExecutor(max_workers=8) as ex:
        pages = dict(zip(urls, ex.map(lambda u: fetch(u, a.timeout), urls), strict=True))
    results = [check(c, pages) for c in claims]
    for r in results:
        if a.json:
            print(json.dumps(r))
        else:
            print(f"{r['result']:<10} {r['id']:<34} {r['detail']}".rstrip())
    counts = {k: sum(r["result"] == k for r in results) for k in ("OK", "DRIFT", "FETCH-FAIL")}
    if not a.json:
        print(f"-- {counts['OK']} OK, {counts['DRIFT']} DRIFT, {counts['FETCH-FAIL']} FETCH-FAIL")
    if counts["DRIFT"]:
        return 1
    return 2 if counts["FETCH-FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
