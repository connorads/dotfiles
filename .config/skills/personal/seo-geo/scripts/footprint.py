#!/usr/bin/env python3
"""Template-similarity (footprint) test for sibling pages.

Compares pages built from one template - location, city, vs, integration or
programmatic pages - and reports how much of each page the template carries.

    python3 scripts/footprint.py (URL ... | --files GLOB) [--strip-tokens FILE]
                                 [--threshold T] [--json]

Method:
  1. Main text from raw HTML. Drops head, script, style, nav, aside, iframe,
     and header/footer outside main/article/section. Keeps only main/article
     content when a page has it.
  2. Boilerplate by cross-page frequency: a block that repeats on at least
     half the pages and is link-dense or inside a chrome container
     (menu, cookie, banner, breadcrumb, sidebar ...) is dropped.
  3. Removes digits, the phrases in --strip-tokens, and auto slot tokens:
     capitalised words that occur 2+ times on a page and on under half the
     pages (the swapped city, area, staff or competitor name).
  4. 5-word shingles; Jaccard for every pair; unique-shingle share per page.

Exit: 0 no pair at or over the threshold | 1 pairs at or over it |
      2 usage error or fewer than 2 pages with text. Exit 2 is never a pass.
Stdlib only. No prompts. Raw HTML only: render a JS app first and pass the
rendered files with --files.
"""

from __future__ import annotations

import argparse
import glob
import itertools
import json
import math
import re
import statistics
import sys
import urllib.error
import urllib.request
from html.parser import HTMLParser

# Calibrated on the sets in evals/test_footprint.py (pair Jaccard, auto strip):
#   city-swap pages from one template              1.00 (0.35-0.37 with names left in)
#   local-chain fixture location template          1.00
#   enriched location pages, shared frame and FAQ  0.30-0.33
#   vs pages, shared frame, different tables       0.30-0.32
# The threshold is a heuristic starting value, not evidence about Google.
DEFAULT_THRESHOLD = 0.6
CALIBRATION = "city-swap 1.00; enriched and vs with own tables 0.30-0.33"
SHINGLE = 5
LOW_UNIQUE_SHARE = 0.20
BOILERPLATE_PAGE_SHARE = 0.5
LINK_DENSE = 0.5
MAX_ROWS = 15
MAX_BYTES = 5_000_000
TIMEOUT = 20
UA = "seo-geo-footprint/1.0 (template-similarity check for sibling pages)"

SKIP_ALWAYS = {
    "head",
    "title",
    "script",
    "style",
    "noscript",
    "template",
    "svg",
    "canvas",
    "iframe",
    "object",
    "embed",
    "nav",
    "aside",
    "select",
    "option",
    "datalist",
}
SKIP_OUTSIDE_CONTENT = {"header", "footer"}
CONTENT_CONTAINERS = {"main", "article", "section"}
BLOCK = {
    "address",
    "article",
    "aside",
    "blockquote",
    "body",
    "br",
    "dd",
    "details",
    "div",
    "dl",
    "dt",
    "figcaption",
    "figure",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "li",
    "main",
    "ol",
    "p",
    "pre",
    "section",
    "summary",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "ul",
}
VOID = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
}
CHROME_HINT = re.compile(
    r"(?:^|[\s_-])(nav|navbar|menu|breadcrumbs?|cookies?|consent|banner|footer|"
    r"header|sidebar|social|share|newsletter|subscribe|modal|popup|skip)(?:$|[\s_-])",
    re.IGNORECASE,
)
WORD = re.compile(r"[^\W\d_]+(?:['\u2019][^\W\d_]+)*")


class _Extractor(HTMLParser):
    """Splits raw HTML into text blocks with link and chrome metadata."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, bool, bool, bool]] = []  # tag, skip, chrome, main
        self.blocks: list[dict] = []
        self.has_main = False
        self._buf: list[str] = []
        self._link_chars = 0
        self._link_depth = 0

    def _state(self) -> tuple[bool, bool, bool]:
        if not self.stack:
            return False, False, False
        _, skip, chrome, main = self.stack[-1]
        return skip, chrome, main

    def _flush(self) -> None:
        text = " ".join("".join(self._buf).split())
        if text:
            _, chrome, main = self._state()
            self.blocks.append(
                {
                    "text": text,
                    "link": self._link_chars / len(text),
                    "chrome": chrome,
                    "main": main,
                }
            )
        self._buf = []
        self._link_chars = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in BLOCK:
            self._flush()
        if tag in VOID:
            return
        if tag == "p" and self.stack and self.stack[-1][0] == "p":
            self.handle_endtag("p")
        skip, chrome, main = self._state()
        a = dict(attrs)
        in_content = any(t in CONTENT_CONTAINERS for t, *_ in self.stack)
        skip = skip or tag in SKIP_ALWAYS or (tag in SKIP_OUTSIDE_CONTENT and not in_content)
        hint = " ".join(filter(None, [a.get("class"), a.get("id"), a.get("role")]))
        chrome = chrome or bool(CHROME_HINT.search(hint))
        is_main = tag in {"main", "article"} or a.get("role") == "main"
        if is_main and not skip:
            self.has_main = True
        main = main or is_main
        self.stack.append((tag, skip, chrome, main))
        if tag == "a":
            self._link_depth += 1

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in BLOCK:
            self._flush()

    def handle_endtag(self, tag: str) -> None:
        if not any(t == tag for t, *_ in self.stack):
            return
        if tag in BLOCK:
            self._flush()
        while self.stack:
            t, *_ = self.stack.pop()
            if t == "a":
                self._link_depth = max(0, self._link_depth - 1)
            if t == tag:
                break

    def handle_data(self, data: str) -> None:
        skip, _, _ = self._state()
        if skip:
            return
        self._buf.append(data)
        if self._link_depth:
            self._link_chars += len(data.strip())

    def close(self) -> None:
        super().close()
        self._flush()


def extract_blocks(html: str) -> list[dict]:
    p = _Extractor()
    p.feed(html)
    p.close()
    if p.has_main:
        return [b for b in p.blocks if b["main"]]
    return p.blocks


def _norm(text: str) -> str:
    return " ".join(w.lower() for w in WORD.findall(text))


def drop_boilerplate(pages: list[list[dict]]) -> tuple[list[list[dict]], int]:
    """Drops chrome-like blocks that repeat across pages."""
    need = max(2, math.ceil(len(pages) * BOILERPLATE_PAGE_SHARE))
    freq: dict[str, int] = {}
    for blocks in pages:
        for key in {_norm(b["text"]) for b in blocks}:
            freq[key] = freq.get(key, 0) + 1
    dropped = 0
    out = []
    for blocks in pages:
        kept = []
        for b in blocks:
            key = _norm(b["text"])
            if key and freq.get(key, 0) >= need and (b["chrome"] or b["link"] >= LINK_DENSE):
                dropped += 1
                continue
            kept.append(b)
        out.append(kept)
    return out, dropped


def tokens(blocks: list[dict]) -> list[str]:
    """Words with original case; digits never match WORD, so they drop out."""
    return [w for b in blocks for w in WORD.findall(b["text"])]


def load_strip(path: str) -> list[list[str]]:
    phrases = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            words = [w.lower() for w in WORD.findall(line)]
            if words:
                phrases.append(words)
    return sorted(phrases, key=len, reverse=True)


def strip_phrases(words: list[str], phrases: list[list[str]]) -> list[str]:
    if not phrases:
        return words
    low = [w.lower() for w in words]
    by_first: dict[str, list[list[str]]] = {}
    for ph in phrases:
        by_first.setdefault(ph[0], []).append(ph)
    out, i = [], 0
    while i < len(words):
        for ph in by_first.get(low[i], ()):
            if low[i : i + len(ph)] == ph:
                i += len(ph)
                break
        else:
            out.append(words[i])
            i += 1
    return out


def slot_tokens(pages: list[list[str]]) -> list[set[str]]:
    """Capitalised words used 2+ times on a page and on under half the pages.

    "Under half" (at least one page) keeps multi-word slots whose words recur
    on a few siblings, such as "Leeds" in "Leeds Headingley" and "Leeds City
    Centre", while a brand that appears everywhere stays in.
    """
    max_df = max(1, (len(pages) - 1) // 2)
    df: dict[str, int] = {}
    for words in pages:
        for w in {w.lower() for w in words}:
            df[w] = df.get(w, 0) + 1
    result = []
    for words in pages:
        counts: dict[str, int] = {}
        lower_seen: set[str] = set()
        for w in words:
            k = w.lower()
            counts[k] = counts.get(k, 0) + 1
            if not w[0].isupper():
                lower_seen.add(k)
        result.append(
            {k for k, c in counts.items() if c >= 2 and df[k] <= max_df and k not in lower_seen}
        )
    return result


def shingles(words: list[str]) -> set[tuple[str, ...]]:
    if not words:
        return set()
    if len(words) < SHINGLE:
        return {tuple(words)}
    return {tuple(words[i : i + SHINGLE]) for i in range(len(words) - SHINGLE + 1)}


def jaccard(a: set, b: set) -> float:
    union = len(a | b)
    return len(a & b) / union if union else 0.0


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        body = r.read(MAX_BYTES + 1)
        charset = r.headers.get_content_charset() or "utf-8"
    return body[:MAX_BYTES].decode(charset, errors="replace")


def label(src: str) -> str:
    if src.startswith(("http://", "https://")):
        m = re.match(r"https?://[^/]+(/.*)?$", src)
        return (m.group(1) if m and m.group(1) else "/") if m else src
    return src


def analyse(sources: list[tuple[str, str]], strip: list[list[str]], auto: bool) -> dict:
    """sources: (name, html). Returns pages, pairs and counts."""
    blocks = [extract_blocks(html) for _, html in sources]
    blocks, dropped = drop_boilerplate(blocks)
    words = [strip_phrases(tokens(b), strip) for b in blocks]
    slots = slot_tokens(words) if auto else [set() for _ in words]
    words = [
        [w.lower() for w in ws if w.lower() not in s] for ws, s in zip(words, slots, strict=True)
    ]
    sh = [shingles(ws) for ws in words]
    pages = []
    for i, (name, _) in enumerate(sources):
        others = set().union(*(s for j, s in enumerate(sh) if j != i)) if len(sh) > 1 else set()
        uniq = len(sh[i] - others) / len(sh[i]) if sh[i] else 0.0
        pages.append(
            {
                "page": name,
                "words": len(words[i]),
                "shingles": len(sh[i]),
                "unique_share": round(uniq, 3),
                "slots": sorted(slots[i]),
            }
        )
    usable = [i for i, p in enumerate(pages) if p["shingles"]]
    pairs = [
        {
            "a": pages[i]["page"],
            "b": pages[j]["page"],
            "jaccard": round(jaccard(sh[i], sh[j]), 3),
        }
        for i, j in itertools.combinations(usable, 2)
    ]
    pairs.sort(key=lambda p: p["jaccard"], reverse=True)
    return {
        "pages": pages,
        "pairs": pairs,
        "boilerplate_blocks": dropped,
        "usable": len(usable),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Template-similarity test for sibling pages (5-word shingle Jaccard)."
    )
    ap.add_argument("urls", nargs="*", metavar="URL", help="http(s) URLs to fetch as raw HTML")
    ap.add_argument(
        "--files",
        action="append",
        default=[],
        metavar="GLOB",
        help="local HTML files; quote the glob; repeatable",
    )
    ap.add_argument(
        "--strip-tokens",
        metavar="FILE",
        help="phrases to remove, one per line (city, area, address, brand, competitor)",
    )
    ap.add_argument(
        "--no-auto-strip",
        action="store_true",
        help="keep page-unique capitalised words (auto slot detection off)",
    )
    ap.add_argument(
        "--threshold",
        type=float,
        default=DEFAULT_THRESHOLD,
        help=f"pair Jaccard that flags a footprint (default {DEFAULT_THRESHOLD})",
    )
    ap.add_argument("--json", action="store_true", help="JSON Lines output")
    a = ap.parse_args(argv)

    for u in a.urls:
        if not u.startswith(("http://", "https://")):
            print(
                f"error: {u!r} is not a URL; pass local files with --files",
                file=sys.stderr,
            )
            return 2
    paths: list[str] = []
    for g in a.files:
        hits = sorted(glob.glob(g, recursive=True))
        if not hits:
            print(f"warning: --files {g!r} matched nothing", file=sys.stderr)
        paths.extend(h for h in hits if h not in paths)

    strip: list[list[str]] = []
    if a.strip_tokens:
        try:
            strip = load_strip(a.strip_tokens)
        except OSError as e:
            print(f"error: --strip-tokens: {e}", file=sys.stderr)
            return 2

    sources: list[tuple[str, str]] = []
    for p in paths:
        try:
            with open(p, encoding="utf-8", errors="replace") as f:
                sources.append((p, f.read()))
        except OSError as e:
            print(f"READ_FAILED {p}: {e}", file=sys.stderr)
    for u in a.urls:
        try:
            sources.append(
                (
                    label(u) if len({label(x) for x in a.urls}) == len(a.urls) else u,
                    fetch(u),
                )
            )
        except (urllib.error.URLError, OSError, ValueError) as e:
            print(f"FETCH_FAILED {u}: {getattr(e, 'reason', e)}", file=sys.stderr)

    if len(sources) < 2:
        print(f"SKIPPED: {len(sources)} page(s) read; need 2 or more. Exit 2 is not a pass.")
        return 2

    r = analyse(sources, strip, auto=not a.no_auto_strip)
    pages, pairs = r["pages"], r["pairs"]
    flagged = [p for p in pairs if p["jaccard"] >= a.threshold]
    low = [p for p in pages if p["shingles"] and p["unique_share"] < LOW_UNIQUE_SHARE]
    empty = [p["page"] for p in pages if not p["shingles"]]
    scores = [p["jaccard"] for p in pairs]
    summary = {
        "type": "summary",
        "pages": len(pages),
        "usable": r["usable"],
        "pairs": len(pairs),
        "threshold": a.threshold,
        "flagged_pairs": len(flagged),
        "low_unique_pages": len(low),
        "max": max(scores, default=0.0),
        "median": round(statistics.median(scores), 3) if scores else 0.0,
        "strip_phrases": len(strip),
        "auto_slots": sum(len(p["slots"]) for p in pages),
        "boilerplate_blocks": r["boilerplate_blocks"],
        "empty_pages": empty,
    }
    code = 2 if r["usable"] < 2 else (1 if flagged else 0)
    summary["exit"] = code

    if a.json:
        print(json.dumps(summary))
        for p in pages:
            print(json.dumps({"type": "page", **p}))
        for p in flagged:
            print(json.dumps({"type": "pair", **p}))
        return code

    print(
        f"footprint: {len(pages)} pages, {len(pairs)} pairs, threshold {a.threshold:.2f} "
        f"(default {DEFAULT_THRESHOLD}; calibrated: {CALIBRATION})"
    )
    print(
        f"removed: digits, {len(strip)} --strip-tokens phrases, {summary['auto_slots']} auto slot "
        f"words, {r['boilerplate_blocks']} boilerplate blocks; {SHINGLE}-word shingles"
    )
    if empty:
        shown = ", ".join(empty[:5]) + (" ..." if len(empty) > 5 else "")
        print(f"NO_TEXT {len(empty)} page(s) with no main text in raw HTML (JS-rendered?): {shown}")
    if r["usable"] < 2:
        print(
            "SKIPPED: fewer than 2 pages with text. Render them first and pass --files. "
            "Exit 2 is not a pass."
        )
        return 2
    print(f"pair jaccard: max {summary['max']:.2f}, median {summary['median']:.2f}")
    print(f"PAIRS >= {a.threshold:.2f}: {len(flagged)} of {len(pairs)}")
    for p in flagged[:MAX_ROWS]:
        print(f"  {p['jaccard']:.2f}  {p['a']}  {p['b']}")
    if len(flagged) > MAX_ROWS:
        print(f"  ... {len(flagged) - MAX_ROWS} more (use --json)")
    print(f"UNIQUE SHARE < {LOW_UNIQUE_SHARE:.0%}: {len(low)} of {r['usable']} pages")
    for p in sorted(low, key=lambda p: p["unique_share"])[:MAX_ROWS]:
        print(f"  {p['unique_share']:.0%}  {p['shingles']} shingles  {p['page']}")
    if len(low) > MAX_ROWS:
        print(f"  ... {len(low) - MAX_ROWS} more (use --json)")
    if flagged:
        print(
            "VERDICT: template footprint. Merge, or enrich each page with data only it has, "
            "then rerun."
        )
    else:
        print("VERDICT: no pair over the threshold. Still name one fact unique to each page.")
    return code


if __name__ == "__main__":
    sys.exit(main())
