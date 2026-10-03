#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["protego>=0.3"]
# ///
"""probe.py - what a crawler receives on each URL, before and after JavaScript.

Usage:
  uv run scripts/probe.py [options] (URL ... | --sitemap URL [--limit N] | --urls-file FILE)

Options:
  --ua NAME        oai-searchbot (default) | googlebot | bingbot | gptbot | chatgpt-user |
                   claudebot | claude-searchbot | perplexitybot | browser | "<raw UA>"
  --render         headless Chrome --dump-dom with the same UA; raw vs rendered diff
                   (needs Chrome; else prints SKIPPED)
  --chrome PATH    Chrome binary (default $CHROME_PATH, then usual macOS/Linux paths)
  --compare-ua     also fetch as a browser; UA_DIFFERS means UNRESOLVED, not "bot blocked"
  --soft404        one random path per host; flags only a direct 200 (redirects ignored)
  --robots         fetch /robots.txt per host; allow/block matrix for 15 tokens x URL paths
                   (needs protego: run with `uv run`; else prints SKIPPED)
  --robots-file F  test a proposed robots.txt instead of the live one; with only /paths as
                   arguments, no page is fetched
  --base ORIGIN    rewrite each URL's origin (probe a local build with production paths);
                   bare /paths are joined to ORIGIN
  --out DIR        DIR/raw/<slug>.html DIR/dom/<slug>.html DIR/head/<slug>.json
                   DIR/robots-matrix.tsv DIR/summary.tsv
  --json           JSON Lines on stdout instead of the table
  --limit N        max URLs taken from --sitemap (default 25)

stdout: status hops words rwords h1 canon ld stack url flags (one line per URL)
Exit: 0 no flags, 1 flags, 2 usage, dependency or fetch failure (never a pass).
Without uv, `python3 scripts/probe.py` runs everything except the robots matrix.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import html as htmllib
import http.client
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zlib
from html.parser import HTMLParser
from pathlib import Path

try:
    from protego import Protego
except ImportError:  # plain python3 without the inline-metadata dependency
    Protego = None

TOOL_UA = "seo-geo-probe/1.0 (SEO audit script; robots and sitemap fetches)"
UAS = {
    "browser": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    "googlebot": "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "bingbot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/140.0.0.0 Safari/537.36",
    "gptbot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.3; +https://openai.com/gptbot",
    "oai-searchbot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.3; +https://openai.com/searchbot",
    "chatgpt-user": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
    "claudebot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    "claude-searchbot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)",
    "perplexitybot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
}
ROBOTS_TOKENS = [
    "Googlebot",
    "Google-Extended",
    "Bingbot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "GPTBot",
    "Claude-SearchBot",
    "Claude-User",
    "ClaudeBot",
    "PerplexityBot",
    "Perplexity-User",
    "Applebot",
    "Applebot-Extended",
    "CCBot",
    "meta-externalagent",
]
SEARCH_TOKENS = {
    "Googlebot",
    "Bingbot",
    "OAI-SearchBot",
    "Claude-SearchBot",
    "PerplexityBot",
    "Applebot",
}

TIMEOUT = 20
HTML_LIMIT = 2 * 1024 * 1024  # Googlebot reads the first 2 MB of an HTML file
ROBOTS_LIMIT = 500 * 1024  # Google ignores robots.txt rules past 500 KiB
EMPTY_BYTES = 512  # a smaller body is a challenge, error stub or nothing
THIN_WORDS = 50
MATRIX_PATHS_SHOWN = 6

# Schema rules. Rich-result status changes: check references/volatile-facts.md before
# relying on these sets, and update them here when a row changes.
SELF_TYPES = {  # an entity rating itself is self-serving under Google's review-snippet rules
    "Organization",
    "Corporation",
    "OnlineBusiness",
    "OnlineStore",
    "NGO",
    "EducationalOrganization",
    "LocalBusiness",
    "ProfessionalService",
    "MedicalBusiness",
    "MedicalClinic",
    "Dentist",
    "Physician",
    "HealthClub",
    "ExerciseGym",
    "SportsActivityLocation",
    "HealthAndBeautyBusiness",
    "BeautySalon",
    "DaySpa",
    "HairSalon",
    "FoodEstablishment",
    "Restaurant",
    "CafeOrCoffeeShop",
    "BarOrPub",
    "Store",
    "ClothingStore",
    "HomeAndConstructionBusiness",
    "Plumber",
    "Electrician",
    "HVACBusiness",
    "RoofingContractor",
    "GeneralContractor",
    "LegalService",
    "Attorney",
    "FinancialService",
    "AccountingService",
    "RealEstateAgent",
    "AutomotiveBusiness",
    "AutoRepair",
    "LodgingBusiness",
    "Hotel",
    "ChildCare",
    "AnimalShelter",
    "VeterinaryCare",
    "TravelAgency",
}
LOCAL_TYPES = SELF_TYPES - {
    "Organization",
    "Corporation",
    "OnlineBusiness",
    "OnlineStore",
    "NGO",
    "EducationalOrganization",
}
THIRD_PARTY_REVIEW_HOSTS = re.compile(
    r"\b(g2|capterra|trustpilot|google|yelp|tripadvisor|trustradius|getapp|softwareadvice|facebook|feefo|reviews\.io)\b",
    re.IGNORECASE,
)
RICH_TYPES = {
    "Article",
    "NewsArticle",
    "BlogPosting",
    "BreadcrumbList",
    "Product",
    "ProductGroup",
    "SoftwareApplication",
    "MobileApplication",
    "WebApplication",
    "Event",
    "JobPosting",
    "Recipe",
    "VideoObject",
    "Course",
    "Dataset",
    "ProfilePage",
    "QAPage",
    "DiscussionForumPosting",
    "Book",
    "Movie",
    "ImageObject",
    "EmployerAggregateRating",
    "Organization",
    "WebSite",
    "Review",
} | LOCAL_TYPES
NO_RESULT_TYPES = {"FAQPage", "HowTo"}  # no longer shown as rich results
DEPRECATED_PROPS = {"branchOf": "superseded by parentOrganization"}
# all-of keys; a tuple inside means any one of those keys
REQUIRED = {
    "Product": ["name", ("offers", "review", "aggregateRating")],
    "SoftwareApplication": ["name", "offers", ("aggregateRating", "review")],
    "Event": ["name", "startDate", "location"],
    "JobPosting": [
        "title",
        "description",
        "datePosted",
        "hiringOrganization",
        ("jobLocation", "jobLocationType"),
    ],
    "BreadcrumbList": ["itemListElement"],
    "VideoObject": ["name", "thumbnailUrl", "uploadDate"],
    "Recipe": ["name", "image"],
    "LocalBusiness": ["name", "address"],
}
PLACEHOLDER = re.compile(
    r"lorem ipsum|\byour[ _-]?(business|company|name|phone|address)\b|\bYOUR_[A-Z_]+|\bTODO\b|\bTBD\b|\bXXX+\b"
    r"|\{\{.*?\}\}|\[verify|\binsert\b.*\bhere\b|\bexample\.(com|org)\b|\b555-\d{4}\b|123[- ]?456[- ]?7890"
    r"|\bplaceholder\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------- fetching


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def fetch(url: str, ua: str, max_hops: int = 10) -> dict:
    """GET with manual redirects so every hop is recorded."""
    chain, cur = [], url
    for _ in range(max_hops + 1):
        req = urllib.request.Request(
            cur,
            headers={
                "User-Agent": ua,
                "Accept-Encoding": "gzip, deflate",
                "Accept": "text/html,*/*",
            },
        )
        try:
            resp = OPENER.open(req, timeout=TIMEOUT)
            status, headers, raw = resp.status, resp.headers, resp.read()
        except urllib.error.HTTPError as e:
            status, headers, raw = e.code, e.headers, e.read()
        except (
            OSError,
            http.client.HTTPException,
            ValueError,
        ) as e:  # DNS, TLS, timeout, bad URL
            return {"error": f"{type(e).__name__}: {e}", "chain": chain}
        if 300 <= status < 400 and headers.get("Location"):
            chain.append((status, cur))
            cur = urllib.parse.urljoin(cur, headers["Location"])
            continue
        enc = (headers.get("Content-Encoding") or "").lower()
        try:
            if enc == "gzip" or raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            elif enc == "deflate":
                raw = zlib.decompress(raw)
        except (OSError, zlib.error):
            pass
        charset = headers.get_content_charset() or "utf-8"
        return {
            "status": status,
            "final_url": cur,
            "chain": chain,
            "headers": headers,
            "bytes": len(raw),
            "text": raw.decode(charset, errors="replace"),
        }
    return {"error": f"more than {max_hops} redirects", "chain": chain}


# ---------------------------------------------------------------- HTML parsing


class Extract(HTMLParser):
    """Collects the SEO-relevant fields of one HTML document."""

    SKIP = frozenset({"script", "style", "noscript", "template", "svg"})

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = None
        self.title_in_body = False
        self.meta = {}
        self.canonicals, self.hreflang, self.h1, self.ld_raw = [], [], [], []
        self.links = self.words = 0
        self.text = []
        self._skip = self._svg = 0
        self._in_title = self._in_h1 = self._in_ld = self._in_body = False
        self._buf, self._h1buf = [], []

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "body":
            self._in_body = True
        if tag == "svg":
            self._svg += 1
        if tag == "title" and self.title is None and not self._svg:
            self._in_title, self._buf = True, []
            self.title_in_body = self._in_body
        elif tag == "meta":
            name = (a.get("name") or a.get("property") or "").lower()
            if name:
                self.meta.setdefault(name, a.get("content", ""))
        elif tag == "link":
            rel = a.get("rel", "").lower().split()
            if "canonical" in rel:
                self.canonicals.append(a.get("href", ""))
            if "alternate" in rel and a.get("hreflang"):
                self.hreflang.append((a["hreflang"], a.get("href", "")))
        elif tag == "h1":
            self._in_h1, self._h1buf = True, []
        elif (
            tag == "a"
            and a.get("href", "").strip()
            and not a["href"].startswith(("javascript:", "#"))
        ):
            self.links += 1
        if tag == "script" and a.get("type", "").lower() == "application/ld+json":
            self._in_ld, self._buf = True, []
        if tag in self.SKIP:
            self._skip += 1

    def handle_endtag(self, tag):
        if tag == "title" and self._in_title:
            self.title, self._in_title = " ".join("".join(self._buf).split()), False
        elif tag == "h1" and self._in_h1:
            self.h1.append(" ".join("".join(self._h1buf).split()))
            self._in_h1 = False
        elif tag == "script" and self._in_ld:
            self.ld_raw.append("".join(self._buf))
            self._in_ld = False
        if tag == "svg" and self._svg:
            self._svg -= 1
        if tag in self.SKIP and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if self._in_title or self._in_ld:
            self._buf.append(data)
        if self._in_h1:
            self._h1buf.append(data)
        if not self._skip and self._in_body:
            self.words += len(data.split())
            if data.strip():
                self.text.append(data)


def parse_page(html: str) -> dict:
    p = Extract()
    p.feed(html)
    # An SPA mount point with nothing inside: <div id="root"></div>
    empty_root = bool(
        re.search(
            r'<div[^>]*\bid=["\'](root|app|__nuxt|svelte)["\'][^>]*>\s*</div>',
            html,
            re.IGNORECASE,
        )
    )
    ld = parse_jsonld(p.ld_raw)
    return {
        "title": p.title,
        "title_in_body": p.title_in_body,
        "description": p.meta.get("description"),
        "robots": " ".join(filter(None, [p.meta.get("robots", ""), p.meta.get("googlebot", "")])),
        "canonicals": p.canonicals,
        "hreflang": len(p.hreflang),
        "h1": p.h1,
        "words": p.words,
        "links": p.links,
        "empty_root": empty_root,
        "generator": p.meta.get("generator", ""),
        "jsonld_types": ld["types"],
        "jsonld_errors": ld["errors"],
        "_nodes": ld["nodes"],
        "_text": " ".join(" ".join(p.text).split()),
    }


# ---------------------------------------------------------------- JSON-LD


def as_list(v):
    return v if isinstance(v, list) else [v]


def types_of(node: dict) -> set[str]:
    return {str(t).rsplit("/", 1)[-1] for t in as_list(node.get("@type") or []) if t}


def parse_jsonld(raws: list[str]) -> dict:
    """Top-level and @graph nodes, plus parse error count. Nested nodes are walked later."""
    nodes, errors = [], 0
    for r in raws:
        try:
            doc = json.loads(r)
        except json.JSONDecodeError:
            errors += 1
            continue
        for item in as_list(doc):
            if not isinstance(item, dict):
                continue
            if "@graph" in item:
                nodes += [n for n in as_list(item["@graph"]) if isinstance(n, dict)]
                if types_of(item):
                    nodes.append({k: v for k, v in item.items() if k != "@graph"})
            else:
                nodes.append(item)
    types = []
    for n in nodes:
        types += sorted(types_of(n))
    return {"nodes": nodes, "types": types, "errors": errors}


def walk(node, parent=None):
    """Yield (node, parent) for every dict in the tree."""
    if isinstance(node, dict):
        yield node, parent
        for k, v in node.items():
            if k != "@context":
                for child in as_list(v):
                    yield from walk(child, node)
    elif isinstance(node, list):
        for child in node:
            yield from walk(child, parent)


def strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for k, v in node.items():
            if k not in ("@context", "@type", "@id"):
                yield from strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from strings(v)


def visible(value, text: str, digits: str) -> bool:
    v = str(value).strip()
    if not v:
        return True
    if re.fullmatch(r"[\d.,]+", v):
        num = v.replace(",", "")
        return num in text.replace(",", "") or (num.endswith(".0") and num[:-2] in text)
    if re.fullmatch(r"[\d\s()+.-]{7,}", v):  # phone number
        return re.sub(r"\D", "", v)[-9:] in digits
    return v.lower() in text.lower()


def check_jsonld(nodes: list[dict], page_text: str) -> tuple[list[str], list[str]]:
    """Return (flags, details) for the JSON-LD nodes of one page."""
    flags, details = [], []

    def add(flag, detail):
        if flag not in flags:
            flags.append(flag)
        details.append(f"{flag}: {detail}")

    by_id = {}
    for n, _ in walk(nodes):
        if n.get("@id") and len(n) > 1:
            by_id.setdefault(n["@id"], n)

    def resolve(v):
        if isinstance(v, dict) and set(v) == {"@id"}:
            return by_id.get(v["@id"], v)
        return v

    digits = re.sub(r"\D", "", page_text)
    for n, parent in walk(nodes):
        t = types_of(n)
        name = "/".join(sorted(t)) or "node"
        for s in strings(n):
            if PLACEHOLDER.search(s):
                add("PLACEHOLDER_VALUE", f"{name}: {s[:60]!r}")
                break
        for prop, why in DEPRECATED_PROPS.items():
            if prop in n:
                add("DEPRECATED_PROP", f"{name}.{prop} ({why})")
        # ratings: on the node itself, or a standalone AggregateRating/Review with itemReviewed
        ratings = [
            resolve(r) for key in ("aggregateRating", "review") for r in as_list(n.get(key) or [])
        ]
        if t & {"AggregateRating", "Review"} and "itemReviewed" in n:
            subject = resolve(n["itemReviewed"])
            subject = subject if isinstance(subject, dict) else {}
            ratings_for = [(subject, n)]
        else:
            ratings_for = [(n, r) for r in ratings if isinstance(r, dict)]
        for subject, rating in ratings_for:
            st = types_of(subject)
            source = " ".join(strings(rating))
            if st & SELF_TYPES:
                add(
                    "SELF_SERVING_RATING",
                    f"rating on {'/'.join(sorted(st))} (the site's own entity)",
                )
            elif THIRD_PARTY_REVIEW_HOSTS.search(source):
                add(
                    "SELF_SERVING_RATING",
                    f"rating sourced from a third-party platform: {source[:60]!r}",
                )
            for key in ("ratingValue", "reviewCount", "ratingCount"):
                if key in rating and not visible(rating[key], page_text, digits):
                    add("VALUE_NOT_VISIBLE", f"{key}={rating[key]}")
        for offer in as_list(resolve(n.get("offers")) or []):
            if (
                isinstance(offer, dict)
                and "price" in offer
                and not visible(offer["price"], page_text, digits)
            ):
                add("VALUE_NOT_VISIBLE", f"{name}.offers.price={offer['price']}")
        if t & LOCAL_TYPES:
            if n.get("telephone") and not visible(n["telephone"], page_text, digits):
                add("VALUE_NOT_VISIBLE", f"{name}.telephone={n['telephone']}")
            addr = resolve(n.get("address"))
            street = addr.get("streetAddress") if isinstance(addr, dict) else None
            if street and not visible(street, page_text, digits):
                add("VALUE_NOT_VISIBLE", f"{name}.address.streetAddress={street!r}")
        for rtype, rules in REQUIRED.items():
            if rtype in t or (rtype == "LocalBusiness" and t & LOCAL_TYPES):
                if parent is not None and set(n) <= {"@type", "@id", "name"}:
                    continue  # a nested mention, not a definition
                missing = [
                    r if isinstance(r, str) else "|".join(r)
                    for r in rules
                    if not (n.get(r) if isinstance(r, str) else any(n.get(k) for k in r))
                ]
                if missing:
                    caution = (
                        " (add only real, visible reviews; else drop the rich-result goal)"
                        if any("aggregateRating" in m for m in missing)
                        else ""
                    )
                    add(
                        "MISSING_REQUIRED",
                        f"{name} lacks {', '.join(missing)}{caution}",
                    )

    top_types = set().union(*(types_of(n) for n in nodes)) if nodes else set()
    for t in sorted(top_types & NO_RESULT_TYPES):
        add("NO_RICH_RESULT_TYPE", f"{t} no longer gets a rich result")
    if nodes and not top_types & RICH_TYPES:
        add(
            "NO_RICH_RESULT_TYPE",
            f"no rich-result type among {', '.join(sorted(top_types)) or 'untyped nodes'}",
        )
    seen = {}
    for n in nodes:
        t = types_of(n) & {"Organization", "Corporation", "WebSite"}
        key = str(n.get("name") or n.get("url") or "").strip().lower()
        if t and key and len(n) > 3:
            for tt in t:
                if (tt, key) in seen and seen[(tt, key)] != n.get("@id"):
                    add("DUPLICATE_ENTITY", f"two {tt} nodes named {key!r}")
                seen.setdefault((tt, key), n.get("@id"))
    return flags, details


# ---------------------------------------------------------------- stack, render


def detect_stack(headers, html: str, parsed: dict) -> str:
    powered = (headers.get("X-Powered-By") or "").lower()
    if (
        any(k.lower().startswith("x-nextjs") for k in headers)
        or "next.js" in powered
        or "__NEXT_DATA__" in html
        or "self.__next_f" in html
        or "/_next/static/" in html
    ):
        return "next"
    if "nuxt" in powered or "__NUXT__" in html or "/_nuxt/" in html:
        return "nuxt"
    if "wordpress" in parsed["generator"].lower() or "/wp-content/" in html or "api.w.org" in html:
        return "wordpress"
    if parsed["empty_root"] and parsed["words"] < THIN_WORDS:
        return "spa-shell"
    if "express" in powered:
        return "express"
    return "unknown"


def find_chrome(explicit: str | None) -> str | None:
    for c in [
        explicit,
        os.environ.get("CHROME_PATH"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        shutil.which("google-chrome"),
        shutil.which("google-chrome-stable"),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
    ]:
        if c and os.path.exists(c):
            return c
    return None


def render(chrome: str, url: str, ua: str) -> str | None:
    # No --user-data-dir: with one, Chrome on macOS prints the DOM but never exits.
    cmd = [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--virtual-time-budget=10000",
        f"--user-agent={ua}",
        "--dump-dom",
        url,
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=60, check=False).stdout
    except subprocess.TimeoutExpired as e:  # keep a DOM that was printed before the hang
        out = e.stdout or b""
    except OSError:
        return None
    dom = out.decode("utf-8", errors="replace")
    return dom if "</html>" in dom.lower() else None


# ---------------------------------------------------------------- robots


def check_robots_text(status: int | None, ctype: str, body: str, size: int) -> list[str]:
    flags = []
    if status is not None and (status >= 500 or status == 429):
        flags.append("ROBOTS_5XX")
    if status in (None, 200):
        head = body[:2000].lower()
        if "<html" in head or "<!doctype html" in head:
            flags.append("ROBOTS_HTML")
        if status == 200 and ctype and not ctype.lower().startswith("text/plain"):
            flags.append("ROBOTS_CONTENT_TYPE")
        if size > ROBOTS_LIMIT:
            flags.append("ROBOTS_TOO_LARGE")
    return flags


def robots_groups(text: str) -> set[str]:
    return {
        line.split(":", 1)[1].split("#")[0].strip().lower()
        for line in text.splitlines()
        if line.strip().lower().startswith("user-agent:")
    }


def robots_for_host(origin: str, paths: list[str], robots_file: str | None) -> dict:
    """Allow/block matrix for ROBOTS_TOKENS x paths, plus file-level flags and notes."""
    if robots_file:
        body = Path(robots_file).read_text(encoding="utf-8", errors="replace")
        status, ctype, size, source = None, "", len(body.encode()), robots_file
    else:
        r = fetch(origin + "/robots.txt", TOOL_UA, max_hops=5)
        if "error" in r:
            return {
                "origin": origin,
                "source": origin + "/robots.txt",
                "error": r["error"],
                "flags": [],
                "rows": [],
            }
        status, ctype, size, source = (
            r["status"],
            r["headers"].get("Content-Type", ""),
            r["bytes"],
            r["final_url"],
        )
        body = r["text"] if status == 200 else ""
    flags = check_robots_text(status, ctype, body, size)
    rp = Protego.parse(body)
    groups = robots_groups(body)
    rows, blocked = [], {}
    for bot in ROBOTS_TOKENS:
        cells = []
        for p in paths:
            if "ROBOTS_5XX" in flags:
                cells.append("PAUSED")
            else:
                ok = rp.can_fetch(origin + p, bot)
                cells.append("allow" if ok else "BLOCK")
                if not ok and bot in SEARCH_TOKENS:
                    blocked.setdefault(p, []).append(bot)
        rows.append({"bot": bot, "own_group": bot.lower() in groups, "cells": cells})
    notes = []
    named = [b for b in ROBOTS_TOKENS if b.lower() in groups]
    if "*" in groups and named:
        notes.append(
            f"{', '.join(named)} have their own group, so every 'User-agent: *' rule is ignored for them"
        )
    if re.search(r"^\s*crawl-delay\s*:", body, re.IGNORECASE | re.MULTILINE):
        notes.append("Crawl-delay is present; Google ignores it")
    if status is not None and 400 <= status < 500 and status != 429:
        notes.append(
            f"robots.txt HTTP {status}: crawlers treat this as no robots.txt (crawl everything)"
        )
    return {
        "origin": origin,
        "source": source,
        "status": status,
        "content_type": ctype,
        "bytes": size,
        "paths": paths,
        "flags": flags,
        "rows": rows,
        "blocked": blocked,
        "notes": notes,
        "sitemaps": list(rp.sitemaps),
    }


# ---------------------------------------------------------------- audit


def norm(u: str | None) -> str:
    if not u:
        return ""
    s = urllib.parse.urlsplit(u)
    return urllib.parse.urlunsplit(
        (s.scheme.lower(), s.netloc.lower(), s.path.rstrip("/") or "", s.query, "")
    )


def origin_of(u: str) -> str:
    s = urllib.parse.urlsplit(u)
    return f"{s.scheme}://{s.netloc}"


def path_of(u: str) -> str:
    s = urllib.parse.urlsplit(u)
    return (s.path or "/") + (f"?{s.query}" if s.query else "")


def audit(url: str, prod_url: str, args, ua: str, chrome: str | None, soft404_done: set) -> dict:
    r = fetch(url, ua)
    row = {"url": url, "ua": args.ua, "flags": [], "details": []}
    if prod_url != url:
        row["prod_url"] = prod_url
    if "error" in r:
        row.update(error=r["error"], flags=["FETCH_ERROR"])
        return row
    h, html = r["headers"], r["text"]
    raw = parse_page(html)
    xrt = ", ".join(h.get_all("X-Robots-Tag") or [])
    row.update(
        status=r["status"],
        final_url=r["final_url"],
        hops=len(r["chain"]),
        chain=[f"{s} {u}" for s, u in r["chain"]],
        bytes=r["bytes"],
        content_type=h.get("Content-Type"),
        x_robots_tag=xrt,
        stack=detect_stack(h, html, raw),
        edge=next(
            (
                e
                for k, e in (
                    ("x-vercel-id", "vercel"),
                    ("cf-ray", "cloudflare"),
                    ("x-nf-request-id", "netlify"),
                )
                if h.get(k)
            ),
            None,
        ),
        _html=html,
    )
    f = row["flags"]
    if r["status"] != 200:
        f.append(f"STATUS_{r['status']}")
    if len(r["chain"]) > 1:
        f.append("REDIRECT_CHAIN")
    if r["bytes"] < EMPTY_BYTES:
        f.append("EMPTY_BODY")
    if "noindex" in raw["robots"].lower():
        f.append("NOINDEX")
    if "noindex" in xrt.lower():
        f.append("X_ROBOTS_NOINDEX")
    if not raw["title"]:
        f.append("NO_TITLE")
    if raw["title_in_body"]:
        f.append("TITLE_IN_BODY")
    if not raw["h1"]:
        f.append("NO_H1_RAW")
    # the canonical should name the production URL, also when probing a local build via --base
    selves = {norm(r["final_url"]), norm(prod_url), norm(url)}
    if len(raw["canonicals"]) > 1:
        f.append("MULTIPLE_CANONICALS")
    elif (
        raw["canonicals"]
        and norm(urllib.parse.urljoin(r["final_url"], raw["canonicals"][0])) not in selves
    ):
        f.append("CANONICAL_ELSEWHERE")
    if r["bytes"] > HTML_LIMIT:
        f.append("HTML_OVER_2MB")
    if raw["words"] < THIN_WORDS:
        f.append("THIN_RAW_HTML")

    if args.compare_ua and args.ua != "browser":
        b = fetch(url, UAS["browser"])
        if "error" in b:
            row["browser_error"] = b["error"]
        else:
            bp = parse_page(b["text"])
            row["browser_status"] = b["status"]
            if (
                b["status"] != r["status"]
                or bp["title"] != raw["title"]
                or len(bp["h1"]) != len(raw["h1"])
            ):
                f.append("UA_DIFFERS")
                row["verdict"] = "UNRESOLVED"

    host = origin_of(url)
    if args.soft404 and host not in soft404_done:
        soft404_done.add(host)
        probe_url = f"{host}/{uuid.uuid4().hex}"
        p = fetch(probe_url, ua)
        row["soft404_probe"] = {
            "url": probe_url,
            "status": p.get("status"),
            "hops": len(p.get("chain", [])),
        }
        if p.get("status") == 200 and not p.get(
            "chain"
        ):  # a redirect (e.g. to /login) is not a soft 404
            f.append("SOFT_404_HOST")

    rd = None
    if args.render and chrome:
        dom = render(chrome, r["final_url"], ua)
        if dom:
            rd = parse_page(dom)
            row["_dom"] = dom
            if rd["words"] >= 100 and raw["words"] < 0.5 * rd["words"]:
                f.append("JS_DEPENDENT_CONTENT")
            if rd["h1"] and not raw["h1"]:
                f.append("H1_ONLY_AFTER_JS")
            if norm((rd["canonicals"] or [None])[0]) != norm((raw["canonicals"] or [None])[0]):
                f.append("CANONICAL_CHANGES_WITH_JS")
            if set(rd["jsonld_types"]) - set(raw["jsonld_types"]):
                f.append("JSONLD_ONLY_AFTER_JS")
        else:
            f.append("RENDER_FAILED")

    if raw["jsonld_errors"]:
        f.append("JSONLD_PARSE_ERROR")
    if not raw["_nodes"]:
        f.append("NONE_IN_RAW")
    page_text = (rd or raw)["_text"]
    ld_flags, ld_details = check_jsonld(raw["_nodes"], page_text)
    f += ld_flags
    row["details"] += ld_details
    row["raw"] = {k: v for k, v in raw.items() if not k.startswith("_")}
    row["raw"]["jsonld"] = raw["_nodes"]
    if rd:
        row["rendered"] = {k: v for k, v in rd.items() if not k.startswith("_")}
    return row


def sitemap_urls(url: str, limit: int, depth: int = 0) -> list[str]:
    r = fetch(url, TOOL_UA)
    if "error" in r or r["status"] != 200:
        raise RuntimeError(f"sitemap {url}: {r.get('error') or 'HTTP ' + str(r.get('status'))}")
    locs = [htmllib.unescape(u) for u in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", r["text"])]
    if "<sitemapindex" in r["text"] and depth < 3:
        out = []
        for child in locs:
            out += sitemap_urls(child, limit - len(out), depth + 1)
            if len(out) >= limit:
                break
        return out[:limit]
    return locs[:limit]


# ---------------------------------------------------------------- output

COLS = [
    "status",
    "hops",
    "words",
    "rwords",
    "h1",
    "canon",
    "ld",
    "stack",
    "url",
    "flags",
]


def table_row(r: dict, full: bool) -> list[str]:
    if "error" in r:
        return [
            "ERR",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            r["url"],
            f"FETCH_ERROR {r['error']}",
        ]
    raw, rd = r["raw"], r.get("rendered")
    canon = (
        "none"
        if not raw["canonicals"]
        else (
            "multi"
            if "MULTIPLE_CANONICALS" in r["flags"]
            else "other"
            if "CANONICAL_ELSEWHERE" in r["flags"]
            else "self"
        )
    )
    ld = "+".join(dict.fromkeys(raw["jsonld_types"])) or "-"
    if not full and len(ld) > 40:
        ld = ld[:37] + "..."
    return [
        str(r["status"]),
        str(r["hops"]),
        str(raw["words"]),
        str(rd["words"]) if rd else "-",
        str(len(raw["h1"])),
        canon,
        ld,
        r["stack"],
        r["url"],
        ",".join(r["flags"]) or "ok",
    ]


def slug(url: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "_", re.sub(r"^https?://", "", url)).strip("_")[:80]
    return f"{s}_{hashlib.sha1(url.encode(), usedforsecurity=False).hexdigest()[:6]}"


def write_out(out: Path, rows: list[dict], robots: list[dict]) -> None:
    for sub in ("raw", "dom", "head"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    for r in rows:
        name = slug(r["url"])
        if "_html" in r:
            (out / "raw" / f"{name}.html").write_text(r["_html"], encoding="utf-8")
        if "_dom" in r:
            (out / "dom" / f"{name}.html").write_text(r["_dom"], encoding="utf-8")
        (out / "head" / f"{name}.json").write_text(
            json.dumps(public(r), indent=2, ensure_ascii=False), encoding="utf-8"
        )
    with open(out / "summary.tsv", "w", encoding="utf-8") as fh:
        fh.write("\t".join([*COLS, "details"]) + "\n")
        for r in rows:
            fh.write("\t".join([*table_row(r, True), "; ".join(r.get("details", []))]) + "\n")
    if robots:
        with open(out / "robots-matrix.tsv", "w", encoding="utf-8") as fh:
            fh.write("origin\tsource\tbot\town_group\tpath\tresult\n")
            for rb in robots:
                for row in rb.get("rows", []):
                    fh.writelines(
                        f"{rb['origin']}\t{rb['source']}\t{row['bot']}\t{'yes' if row['own_group'] else '-'}\t{p}\t{c}\n"
                        for p, c in zip(rb["paths"], row["cells"], strict=True)
                    )


def public(r: dict) -> dict:
    return {k: v for k, v in r.items() if not k.startswith("_")}


def print_robots(rb: dict) -> None:
    if rb.get("error"):
        print(f"\nrobots {rb['source']}: FETCH_ERROR {rb['error']}")
        return
    paths = rb["paths"][:MATRIX_PATHS_SHOWN]
    more = (
        f" (+{len(rb['paths']) - len(paths)} paths in robots-matrix.tsv)"
        if len(rb["paths"]) > len(paths)
        else ""
    )
    status = f"HTTP {rb['status']} {rb['content_type']} " if rb["status"] is not None else ""
    print(
        f"\nrobots {rb['source']}: {status}{rb['bytes']} B flags={','.join(rb['flags']) or 'ok'}{more}"
    )
    print(f"{'bot':20}{'own':5}" + "".join(f"{p[:18]:20}" for p in paths))
    for row in rb["rows"]:
        print(
            f"{row['bot']:20}{'yes' if row['own_group'] else '-':5}"
            + "".join(f"{c:20}" for c in row["cells"][: len(paths)])
        )
    for n in rb["notes"]:
        print(f"note: {n}")
    print(f"sitemaps: {', '.join(rb['sitemaps']) or 'none'}")


# ---------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("urls", nargs="*")
    ap.add_argument("--ua", default="oai-searchbot")
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--chrome")
    ap.add_argument("--compare-ua", action="store_true")
    ap.add_argument("--soft404", action="store_true")
    ap.add_argument("--robots", action="store_true")
    ap.add_argument("--robots-file")
    ap.add_argument("--base")
    ap.add_argument("--sitemap")
    ap.add_argument("--urls-file")
    ap.add_argument("--limit", type=int, default=25)
    ap.add_argument("--out")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    def emit_skip(what: str, why: str) -> None:
        if args.json:
            print(json.dumps({"kind": "skipped", "check": what, "reason": why}))
        else:
            print(f"SKIPPED ({what}: {why})")

    # dependencies first
    if args.robots_file and not os.path.isfile(args.robots_file):
        print(f"error: --robots-file {args.robots_file}: no such file", file=sys.stderr)
        return 2
    want_robots = args.robots or bool(args.robots_file)
    if want_robots and Protego is None:
        emit_skip(
            "robots",
            "protego not installed; run `uv run scripts/probe.py ...` (reads the inline "
            "dependency) or `uv pip install protego`. urllib.robotparser is not used: it gets Google's "
            "group and longest-match rules wrong",
        )
        want_robots = False
        if (
            args.robots_file
            and all(u.startswith("/") for u in args.urls)
            and not (args.sitemap or args.urls_file)
        ):
            return 2  # nothing else was asked for
    chrome = None
    if args.render:
        chrome = find_chrome(args.chrome)
        if not chrome:
            emit_skip("render", "no Chrome found; set CHROME_PATH or pass --chrome PATH")

    targets = list(args.urls)
    try:
        if args.urls_file:
            targets += [
                ln.strip()
                for ln in Path(args.urls_file).read_text().splitlines()
                if ln.strip() and not ln.lstrip().startswith("#")
            ]
        if args.sitemap:
            targets += sitemap_urls(args.sitemap, args.limit)
    except (OSError, RuntimeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    if not targets:
        ap.print_usage(sys.stderr)
        return 2

    # robots-file with bare paths: test the proposed file only, fetch nothing
    if args.robots_file and all(t.startswith("/") for t in targets) and not args.base:
        rb = robots_for_host(
            "https://robots-file.invalid",
            list(dict.fromkeys(targets)),
            args.robots_file,
        )
        rb["origin"] = "(file)"
        flags = rb["flags"] + [
            f"SEARCH_BOT_BLOCKED:{b}" for p in rb["blocked"] for b in rb["blocked"][p]
        ]
        if args.json:
            print(json.dumps({"kind": "robots", **rb, "flags": list(dict.fromkeys(flags))}))
        else:
            print_robots(rb)
        if args.out:
            write_out(Path(args.out), [], [rb])
        return 1 if flags else 0

    pairs = []  # (url to fetch, production url)
    for t in targets:
        if args.base:
            base = args.base.rstrip("/")
            pairs.append((base + (t if t.startswith("/") else path_of(t)), t))
        elif t.startswith("/"):
            print(
                f"error: {t} is a path; pass a full URL or --base ORIGIN",
                file=sys.stderr,
            )
            return 2
        else:
            pairs.append((t, t))

    ua = UAS.get(args.ua.lower(), args.ua)
    done: set = set()
    rows = [audit(u, p, args, ua, chrome, done) for u, p in pairs]

    robots = []
    if want_robots:
        by_host: dict[str, list[str]] = {}
        for u, _ in pairs:
            by_host.setdefault(origin_of(u), []).append(path_of(u))
        for origin, paths in by_host.items():
            rb = robots_for_host(origin, list(dict.fromkeys(paths)), args.robots_file)
            robots.append(rb)
            for r in rows:
                if origin_of(r["url"]) == origin and "error" not in r:
                    r["flags"] += rb["flags"]
                    r["flags"] += [
                        f"SEARCH_BOT_BLOCKED:{b}"
                        for b in rb.get("blocked", {}).get(path_of(r["url"]), [])
                    ]

    if args.json:
        for r in rows:
            print(json.dumps({"kind": "url", **public(r)}, ensure_ascii=False))
        for rb in robots:
            print(json.dumps({"kind": "robots", **rb}, ensure_ascii=False))
    else:
        print("\t".join(COLS))
        for r in rows:
            print("\t".join(table_row(r, False)))
        for rb in robots:
            print_robots(rb)
        if any("UA_DIFFERS" in r["flags"] for r in rows):
            print(
                "note: UA_DIFFERS is UNRESOLVED - a spoofed UA proves only the UA rule; logs or Search Console settle it"
            )
    if args.out:
        write_out(Path(args.out), rows, robots)
        if not args.json:
            print(f"evidence: {args.out}/summary.tsv")

    if any(set(r["flags"]) & {"FETCH_ERROR", "EMPTY_BODY"} for r in rows) or any(
        rb.get("error") for rb in robots
    ):
        return 2
    return 1 if any(r["flags"] for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
