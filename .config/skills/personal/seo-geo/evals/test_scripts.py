"""Tests for scripts/probe.py against local fixtures (no internet).

Run from the skill root: uv run --with pytest pytest evals/test_scripts.py
Robots tests run probe.py through `uv run`, which installs protego from the
script's inline metadata; they skip when uv is missing.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

SKILL = Path(__file__).resolve().parents[1]
PROBE = SKILL / "scripts" / "probe.py"
FIXTURES = SKILL / "evals" / "fixtures"
UV = shutil.which("uv")
needs_uv = pytest.mark.skipif(UV is None, reason="uv not installed")

FILLER = " ".join(["Rota planning for small teams with shift swaps and holiday tracking."] * 12)


def run(*args: str, uv: bool = False) -> subprocess.CompletedProcess:
    cmd = [UV, "run", "--quiet", str(PROBE)] if uv else [sys.executable, str(PROBE)]
    return subprocess.run(
        cmd + list(args), capture_output=True, text=True, timeout=120, check=False
    )


def rows(out: str) -> list[dict]:
    return [json.loads(line) for line in out.splitlines() if line.startswith("{")]


def page(body: str, head: str = "<title>Rotaly</title>", jsonld: list | None = None) -> str:
    scripts = "".join(
        f'<script type="application/ld+json">{json.dumps(d)}</script>' for d in (jsonld or [])
    )
    return f"<!doctype html><html><head>{head}</head><body>{scripts}<h1>Rotaly</h1><p>{body}</p></body></html>"


@contextmanager
def serve(
    routes: dict[str, tuple[int, dict, str]],
    default: tuple[int, dict, str] | None = None,
):
    """Serve fixed responses. routes maps path -> (status, headers, body)."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            status, headers, body = routes.get(
                self.path.split("?")[0], default or (404, {}, "not found " * 80)
            )
            data = body.encode()
            self.send_response(status)
            headers = {"Content-Type": "text/html; charset=utf-8", **headers}
            for k, v in headers.items():
                self.send_header(k, v)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *a):
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{httpd.server_port}"
    finally:
        httpd.shutdown()


@pytest.fixture(scope="module")
def spa_shell():
    proc = subprocess.Popen(
        [sys.executable, str(FIXTURES / "spa-shell" / "serve.py"), "0"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    url = proc.stdout.readline().split()[-1]  # "serving on http://127.0.0.1:PORT/"
    yield url
    proc.terminate()
    proc.wait()


# ---------------------------------------------------------------- access flags


@needs_uv
def test_spa_shell_flags_empty_shell_soft404_and_html_robots(spa_shell):
    r = run("--soft404", "--robots", spa_shell, spa_shell + "pricing", uv=True)
    assert r.returncode == 1, r.stdout + r.stderr
    home = r.stdout.splitlines()[1]
    for flag in ("THIN_RAW_HTML", "SOFT_404_HOST", "ROBOTS_HTML", "NO_H1_RAW"):
        assert flag in home
    assert "\tspa-shell\t" in home


def test_redirecting_host_is_not_a_soft_404():
    good = (200, {}, page(FILLER))
    with serve({"/": good, "/login": good}, default=(307, {"Location": "/login"}, "")) as base:
        r = run("--soft404", "--json", base + "/")
    row = rows(r.stdout)[0]
    assert row["soft404_probe"]["hops"] == 1
    assert "SOFT_404_HOST" not in row["flags"]


def test_empty_body_and_fetch_error_exit_2():
    with serve({"/": (200, {}, "<html></html>")}) as base:
        assert run(base + "/").returncode == 2
    assert run("http://127.0.0.1:9/").returncode == 2


def test_base_rewrites_origin_and_accepts_production_canonical():
    head = '<title>Pricing</title><link rel="canonical" href="https://rotaly.example/pricing">'
    with serve({"/pricing": (200, {}, page(FILLER, head=head))}) as base:
        r = run("--base", base, "--json", "https://rotaly.example/pricing")
    row = rows(r.stdout)[0]
    assert row["url"] == base + "/pricing"
    assert "CANONICAL_ELSEWHERE" not in row["flags"]


# ---------------------------------------------------------------- JSON-LD

LAYOUT_GRAPH = {
    "@context": "https://schema.org",
    "@graph": [
        {
            "@type": "Organization",
            "@id": "https://rotaly.example/#org",
            "name": "Rotaly",
            "url": "https://rotaly.example/",
            "logo": "https://rotaly.example/logo.png",
            "sameAs": ["https://www.linkedin.com/company/rotaly"],
        },
        {
            "@type": "WebSite",
            "@id": "https://rotaly.example/#website",
            "url": "https://rotaly.example/",
            "name": "Rotaly",
            "publisher": {"@id": "https://rotaly.example/#org"},
        },
    ],
}


def test_layout_graph_counts_as_jsonld_in_raw():
    with serve({"/": (200, {}, page(FILLER, jsonld=[LAYOUT_GRAPH]))}) as base:
        r = run("--json", base + "/")
    row = rows(r.stdout)[0]
    assert "Organization" in row["raw"]["jsonld_types"]
    assert "NONE_IN_RAW" not in row["flags"]
    assert r.returncode == 0, row["flags"]


def test_third_party_rating_is_self_serving():
    app = {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": "Rotaly",
        "offers": {"@type": "Offer", "price": "4", "priceCurrency": "GBP"},
        "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": "4.8",
            "reviewCount": "312",
            "author": {"@type": "Organization", "name": "G2"},
        },
    }
    with serve(
        {
            "/": (
                200,
                {},
                page(FILLER + " From 4 GBP. Rated 4.8 from 312 reviews.", jsonld=[app]),
            )
        }
    ) as base:
        row = rows(run("--json", base + "/").stdout)[0]
    assert "SELF_SERVING_RATING" in row["flags"]
    assert "VALUE_NOT_VISIBLE" not in row["flags"]


def test_rating_on_own_business_via_id_reference():
    graph = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Dentist",
                "@id": "#clinic",
                "name": "Northgate Dental - Leeds",
                "address": {"@type": "PostalAddress", "streetAddress": "1 Park Row"},
                "aggregateRating": {"@id": "#rating"},
            },
            {
                "@type": "AggregateRating",
                "@id": "#rating",
                "ratingValue": "4.9",
                "reviewCount": "1287",
            },
        ],
    }
    with serve({"/": (200, {}, page(FILLER, jsonld=[graph]))}) as base:
        row = rows(run("--json", base + "/").stdout)[0]
    assert "SELF_SERVING_RATING" in row["flags"]
    assert "VALUE_NOT_VISIBLE" in row["flags"]  # 4.9, 1287 and the street are not on the page


def test_faq_placeholder_parse_error_and_branchof():
    faq = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": "Is it free?",
                "acceptedAnswer": {"@type": "Answer", "text": "TODO"},
            }
        ],
    }
    branch = {
        "@context": "https://schema.org",
        "@type": "Restaurant",
        "name": "Tablekit Cafe",
        "address": {"@type": "PostalAddress", "streetAddress": "2 Mill Lane"},
        "branchOf": {"@id": "#org"},
    }
    html = page(FILLER + " 2 Mill Lane", jsonld=[faq, branch]).replace(
        "</body>", '<script type="application/ld+json">{bad</script></body>'
    )
    with serve({"/": (200, {}, html)}) as base:
        row = rows(run("--json", base + "/").stdout)[0]
    for flag in (
        "NO_RICH_RESULT_TYPE",
        "PLACEHOLDER_VALUE",
        "JSONLD_PARSE_ERROR",
        "DEPRECATED_PROP",
    ):
        assert flag in row["flags"]
    assert "VALUE_NOT_VISIBLE" not in row["flags"]


def test_missing_required_property():
    product = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Rotaly Pro",
    }
    with serve({"/": (200, {}, page(FILLER, jsonld=[product]))}) as base:
        row = rows(run("--json", base + "/").stdout)[0]
    assert "MISSING_REQUIRED" in row["flags"]


# ---------------------------------------------------------------- robots


@needs_uv
def test_named_group_ignores_star_group():
    robots = FIXTURES / "bot-policy" / "robots.txt"
    r = run(
        "--robots-file",
        str(robots),
        "--json",
        "/",
        "/admin/",
        "/blog/drafts/x",
        uv=True,
    )
    rb = rows(r.stdout)[0]
    cell = {
        (row["bot"], p): c
        for row in rb["rows"]
        for p, c in zip(rb["paths"], row["cells"], strict=True)
    }
    assert cell[("Googlebot", "/admin/")] == "BLOCK"
    assert cell[("PerplexityBot", "/admin/")] == "BLOCK"  # falls under *
    assert cell[("OAI-SearchBot", "/admin/")] == "allow"  # own group drops every * rule
    assert cell[("OAI-SearchBot", "/blog/drafts/x")] == "BLOCK"
    assert cell[("GPTBot", "/")] == "BLOCK"
    assert any("OAI-SearchBot" in n and "ignored" in n for n in rb["notes"])
    assert any("Crawl-delay" in n for n in rb["notes"])
    assert "SEARCH_BOT_BLOCKED:OAI-SearchBot" in rb["flags"]
    assert r.returncode == 1


@needs_uv
def test_robots_file_replaces_live_robots(spa_shell, tmp_path):
    proposed = tmp_path / "robots.txt"
    proposed.write_text(
        "User-agent: *\nAllow: /\n\nUser-agent: OAI-SearchBot\nDisallow: /pricing\n"
    )
    r = run(
        "--robots-file",
        str(proposed),
        "--json",
        spa_shell,
        spa_shell + "pricing",
        uv=True,
    )
    url_rows = [x for x in rows(r.stdout) if x["kind"] == "url"]
    assert all(
        "ROBOTS_HTML" not in x["flags"] for x in url_rows
    )  # the live HTML robots.txt is not read
    assert "SEARCH_BOT_BLOCKED:OAI-SearchBot" in url_rows[1]["flags"]
    assert "SEARCH_BOT_BLOCKED:OAI-SearchBot" not in url_rows[0]["flags"]


def test_robots_without_protego_prints_skipped():
    try:
        import protego  # noqa: F401

        pytest.skip("protego importable in this interpreter")
    except ImportError:
        pass
    with serve({"/": (200, {}, page(FILLER, jsonld=[LAYOUT_GRAPH]))}) as base:
        r = run("--robots", base + "/")
    assert r.stdout.startswith("SKIPPED (robots: protego not installed")
    assert r.returncode == 0
    robots = FIXTURES / "bot-policy" / "robots.txt"
    assert run("--robots-file", str(robots), "/").returncode == 2  # nothing else was asked for
