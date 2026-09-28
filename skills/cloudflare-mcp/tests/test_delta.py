"""Offline tests for scripts/delta.py. A fake transport stands in for GitHub and HTTP."""

import io
import json
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import delta

BASE = "a" * 40
HEAD = "b" * 40


class FakeTransport:
    """github(path) and get(url) answer from dicts; unknown keys raise FetchError."""

    gh = "gh"

    def __init__(self, github=None, http=None):
        self.github_routes = github or {}
        self.http_routes = http or {}
        self.calls = []

    def github(self, path):
        self.calls.append(path)
        for key, value in self.github_routes.items():
            if path == key or (key.endswith("*") and path.startswith(key[:-1])):
                return value(path) if callable(value) else value
        raise delta.FetchError(f"no route for {path}")

    def get(self, url, headers=None):
        self.calls.append(url)
        if url not in self.http_routes:
            raise delta.FetchError(f"no route for {url}")
        return self.http_routes[url]


def commit(sha, date, subject):
    return {
        "sha": sha,
        "commit": {"committer": {"date": date}, "message": subject + "\n\nbody"},
    }


def gh_source(**kw):
    return {
        "id": "repo",
        "kind": "github-paths",
        "repo": "o/r",
        "ref": "main",
        "paths": ["docs/mcp/", "README.md"],
        "informs": ["SKILL.md"],
        "watermark": {"value": BASE, "observed_at": "2026-01-01T00:00:00Z"},
        **kw,
    }


def compare(files, commits, total=None):
    return {
        "status": "ahead",
        "total_commits": len(commits) if total is None else total,
        "base_commit": commit(BASE, "2026-09-01T00:00:00Z", "base"),
        "commits": commits,
        "files": [{"filename": f, "status": "modified"} for f in files],
    }


# --------------------------------------------------------------------------- github-paths


def test_github_paths_unchanged_when_head_is_watermark():
    t = FakeTransport(github={"repos/o/r/commits/main": {"sha": BASE}})
    r = delta.check_source(gh_source(), t)
    assert r["status"] == "unchanged"
    assert r["head"] == BASE
    assert not any("compare" in c for c in t.calls)


def test_github_paths_filters_files_and_lists_only_in_range_commits():
    c1 = commit("c" * 40, "2026-09-02T00:00:00Z", "docs: tweak mcp page")
    stray = commit("d" * 40, "2026-08-01T00:00:00Z", "outside the range")
    t = FakeTransport(
        github={
            "repos/o/r/commits/main": {"sha": HEAD},
            f"repos/o/r/compare/{BASE}...{HEAD}": compare(["docs/mcp/a.md", "src/x.ts"], [c1]),
            "repos/o/r/commits?*": [c1, stray],
        }
    )
    r = delta.check_source(gh_source(), t)
    assert r["status"] == "changed"
    assert r["head"] == HEAD
    assert [i["path"] for i in r["items"] if i["type"] == "file"] == ["docs/mcp/a.md"]
    assert [i["sha"] for i in r["items"] if i["type"] == "commit"] == ["c" * 40]
    query = next(c for c in t.calls if c.startswith("repos/o/r/commits?"))
    assert urllib.parse.parse_qs(query.split("?", 1)[1])["path"] == ["docs/mcp/a.md"]


def test_github_paths_unchanged_when_no_tracked_file_moved():
    t = FakeTransport(
        github={
            "repos/o/r/commits/main": {"sha": HEAD},
            f"repos/o/r/compare/{BASE}...{HEAD}": compare(
                ["src/x.ts"], [commit("c" * 40, "2026-09-02T00:00:00Z", "x")]
            ),
        }
    )
    r = delta.check_source(gh_source(), t)
    assert r["status"] == "unchanged"
    assert r["head"] == HEAD
    assert r["items"] == []


def test_github_paths_truncated_compare_expands_partial_prefixes():
    c1 = commit("e" * 40, "2026-09-03T00:00:00Z", "examples: bump")
    t = FakeTransport(
        github={
            "repos/o/r/commits/main": {"sha": HEAD},
            f"repos/o/r/compare/{BASE}...{HEAD}": compare([], [], total=900),
            "repos/o/r/contents/examples?*": [
                {"path": "examples/mcp-worker", "type": "dir"},
                {"path": "examples/chat", "type": "dir"},
            ],
            "repos/o/r/commits?*": [c1],
        }
    )
    r = delta.check_source(gh_source(paths=["examples/mcp"]), t)
    assert r["status"] == "changed"
    assert "truncated" in r["info"][0]
    queried = [
        urllib.parse.parse_qs(c.split("?", 1)[1])["path"]
        for c in t.calls
        if c.startswith("repos/o/r/commits?")
    ]
    assert queried == [["examples/mcp-worker"]]


def test_prefix_matcher_star_matches_one_segment():
    m = delta.prefix_matcher(["docs/docs/*/tutorials/security/", "README.md"])
    assert m("docs/docs/2025-06-18/tutorials/security/authorization.mdx")
    assert not m("docs/docs/a/b/tutorials/security/x")
    assert m("README.md")
    assert not m("docs/README.md")


def test_github_paths_rewritten_history_is_an_error():
    t = FakeTransport(
        github={
            "repos/o/r/commits/main": {"sha": HEAD},
            f"repos/o/r/compare/{BASE}...{HEAD}": {"status": "diverged"},
        }
    )
    r = delta.check_source(gh_source(), t)
    assert r["status"] == "error"
    assert r["head"] is None
    assert "not an ancestor" in r["error"]


# --------------------------------------------------------------------------- github-tags


def tag_source(value="2026-07-28"):
    return {
        "id": "tags",
        "kind": "github-tags",
        "repo": "o/spec",
        "regex": r"^\d{4}-\d{2}-\d{2}(-RC)?$",
        "informs": [],
        "watermark": {"value": value, "observed_at": "x"},
    }


def refs(*names):
    return [{"ref": "refs/tags/" + n} for n in names]


def test_github_tags_lists_newer_matching_tags_with_rc_before_final():
    t = FakeTransport(
        github={
            "repos/o/spec/git/matching-refs/tags?*": refs(
                "2025-11-25", "2026-07-28-RC", "2026-07-28", "2027-01-15-RC", "v1.0.0"
            )
        }
    )
    r = delta.check_source(tag_source(), t)
    assert r["status"] == "changed"
    assert [i["tag"] for i in r["items"]] == ["2027-01-15-RC"]
    assert r["head"] == "2027-01-15-RC"
    t2 = FakeTransport(
        github={"repos/o/spec/git/matching-refs/tags?*": refs("2027-01-15-RC", "2027-01-15")}
    )
    assert delta.check_source(tag_source("2027-01-15-RC"), t2)["head"] == "2027-01-15"


def test_github_tags_unchanged():
    t = FakeTransport(
        github={"repos/o/spec/git/matching-refs/tags?*": refs("2026-07-28-RC", "2026-07-28")}
    )
    r = delta.check_source(tag_source(), t)
    assert r["status"] == "unchanged"
    assert r["head"] == "2026-07-28"


# --------------------------------------------------------------------------- npm


def packument(times, latest, peers=None):
    return (
        200,
        {},
        json.dumps(
            {
                "time": {"created": "2020", "modified": "2026", **times},
                "dist-tags": {"latest": latest},
                "versions": {latest: {"peerDependencies": peers or {}}},
            }
        ).encode(),
    )


def npm_source(value):
    return {
        "id": "npm",
        "kind": "npm",
        "packages": list(value),
        "informs": [],
        "peer_report": {"agents": "modelcontextprotocol|zod"},
        "watermark": {"value": value, "observed_at": "x"},
    }


def test_npm_lists_stable_versions_after_watermark_and_agents_peers():
    t = FakeTransport(
        http={
            "https://registry.npmjs.org/agents": packument(
                {
                    "0.24.0": "2026-09-18T00:00:00Z",
                    "0.25.0-beta.1": "2026-09-20T00:00:00Z",
                    "0.25.0": "2026-09-21T00:00:00Z",
                },
                "0.25.0",
                {
                    "@modelcontextprotocol/server": "2.1.0",
                    "zod": "^4.0.0",
                    "react": "^19",
                },
            ),
            "https://registry.npmjs.org/@cloudflare%2fworkers-oauth-provider": packument(
                {"1.1.0": "2026-09-24T00:00:00Z", "0.10.5": "2026-09-01T00:00:00Z"},
                "1.1.0",
            ),
        }
    )
    r = delta.check_source(
        npm_source({"agents": "0.24.0", "@cloudflare/workers-oauth-provider": "1.1.0"}),
        t,
    )
    assert r["status"] == "changed"
    assert [(i["package"], i["version"]) for i in r["items"]] == [("agents", "0.25.0")]
    assert r["head"] == {
        "agents": "0.25.0",
        "@cloudflare/workers-oauth-provider": "1.1.0",
    }
    assert r["info"] == ["agents@0.25.0 peers: @modelcontextprotocol/server 2.1.0, zod ^4.0.0"]


def test_npm_unknown_watermark_version_is_an_error():
    t = FakeTransport(
        http={"https://registry.npmjs.org/agents": packument({"0.24.0": "2026"}, "0.24.0")}
    )
    r = delta.check_source(npm_source({"agents": "9.9.9"}), t)
    assert r["status"] == "error"
    assert r["head"] is None


# --------------------------------------------------------------------------- rss


RSS = b"""<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item><title>Build MCP servers faster</title><link>https://blog.example/mcp</link><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate><description>about McpAgent</description></item>
<item><title>Unrelated launch</title><link>https://blog.example/other</link><pubDate>Wed, 30 Sep 2026 10:00:00 GMT</pubDate><description>R2 things</description></item>
<item><title>Old MCP post</title><link>https://blog.example/old</link><pubDate>Mon, 01 Sep 2026 10:00:00 GMT</pubDate></item>
</channel></rss>"""

ATOM = b"""<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Model Context Protocol update</title><link href="https://atom.example/1"/><updated>2026-09-29T12:00:00Z</updated></entry>
</feed>"""


def rss_source(feeds):
    return {
        "id": "blog",
        "kind": "rss",
        "feeds": feeds,
        "include": r"\bMCP\b|Model Context Protocol|McpAgent",
        "informs": [],
        "watermark": {"value": "2026-09-22T13:00:00Z", "observed_at": "x"},
    }


def test_rss_and_atom_new_matching_items_and_head_is_newest_seen():
    t = FakeTransport(http={"https://f/rss": (200, {}, RSS), "https://f/atom": (200, {}, ATOM)})
    r = delta.check_source(rss_source(["https://f/rss", "https://f/atom"]), t)
    assert r["status"] == "changed"
    assert [i["url"] for i in r["items"]] == [
        "https://atom.example/1",
        "https://blog.example/mcp",
    ]
    assert r["head"] == "2026-09-30T10:00:00Z"


def test_rss_429_and_non_xml_are_per_source_errors_without_head():
    t = FakeTransport(
        http={
            "https://f/rss": (429, {}, b"slow down"),
            "https://f/html": (
                200,
                {"content-type": "text/html"},
                b"<html><p>challenge",
            ),
        }
    )
    r = delta.check_source(rss_source(["https://f/rss", "https://f/html"]), t)
    assert r["status"] == "error"
    assert r["head"] is None
    assert "429" in r["error"]
    assert "not XML" in r["error"]


def test_rss_429_alone_is_deferred_without_head():
    t = FakeTransport(
        http={
            "https://f/rss": (429, {"retry-after": "120"}, b"slow down"),
            "https://f/atom": (200, {}, ATOM),
        }
    )
    r = delta.check_source(rss_source(["https://f/rss", "https://f/atom"]), t)
    assert r["status"] == "deferred"
    assert r["head"] is None
    assert r["error"] is None
    assert "429" in r["info"][0]
    assert "Retry-After 120" in r["info"][0]
    assert [i["url"] for i in r["items"]] == ["https://atom.example/1"]


# --------------------------------------------------------------------------- url-hash


def test_url_hash_ignores_markup_and_whitespace_and_flags_text_change():
    same = delta.normalise_text(
        b"<html><script>x=1</script><p>Hello   world</p></html>", "text/html"
    )
    assert same == delta.normalise_text(b"<div>Hello</div>\n<b>world</b>", "text/html")
    digest = delta.hashlib.sha256(same.encode()).hexdigest()[:16]
    src = {
        "id": "pages",
        "kind": "url-hash",
        "urls": ["https://p/a", "https://p/b"],
        "informs": [],
        "watermark": {
            "value": {"https://p/a": digest, "https://p/b": "0" * 16},
            "observed_at": "x",
        },
    }
    t = FakeTransport(
        http={
            "https://p/a": (200, {"content-type": "text/html"}, b"<p>Hello world</p>"),
            "https://p/b": (200, {"content-type": "text/markdown"}, b"# New text"),
        }
    )
    r = delta.check_source(src, t)
    assert r["status"] == "changed"
    assert [i["url"] for i in r["items"]] == ["https://p/b"]
    assert r["head"]["https://p/a"] == digest


def test_url_hash_429_is_deferred():
    src = {
        "id": "pages",
        "kind": "url-hash",
        "urls": ["https://p/a"],
        "informs": [],
        "watermark": {"value": {}, "observed_at": "x"},
    }
    t = FakeTransport(http={"https://p/a": (429, {}, b"")})
    r = delta.check_source(src, t)
    assert r["status"] == "deferred"
    assert r["head"] is None


# --------------------------------------------------------------------------- commands


def write_sources(tmp_path, *sources):
    p = tmp_path / "sources.json"
    p.write_text(json.dumps({"schema": 1, "sources": list(sources)}))
    return p


def run_check(path, transport, *extra):
    out, err = io.StringIO(), io.StringIO()
    args = delta.build_parser().parse_args(["check", *extra])
    return (
        delta.cmd_check(args, transport, path, out=out, err=err),
        out.getvalue(),
        err.getvalue(),
    )


def test_exit_codes_unchanged_changed_error(tmp_path):
    unchanged = FakeTransport(github={"repos/o/spec/git/matching-refs/tags?*": refs("2026-07-28")})
    changed = FakeTransport(github={"repos/o/spec/git/matching-refs/tags?*": refs("2027-01-01")})
    path = write_sources(tmp_path, tag_source())
    assert run_check(path, unchanged)[0] == 0
    assert run_check(path, changed)[0] == 10
    assert run_check(path, FakeTransport())[0] == 1
    assert run_check(path, unchanged, "--source", "nope")[0] == 1


def test_deferred_alone_exits_0_or_10_and_says_retry_later(tmp_path):
    blog = {**rss_source(["https://f/rss"]), "why": "x"}
    limited = {"https://f/rss": (429, {}, b"")}
    path = write_sources(tmp_path, blog, tag_source())
    tags = {"repos/o/spec/git/matching-refs/tags?*": refs("2026-07-28")}
    code, out, _ = run_check(path, FakeTransport(github=tags, http=limited))
    assert code == 0
    assert "[deferred] blog" in out
    assert "deferred: retry later" in out
    assert "0 errors, 1 deferred" in out
    tags = {"repos/o/spec/git/matching-refs/tags?*": refs("2027-01-01")}
    assert run_check(path, FakeTransport(github=tags, http=limited))[0] == 10
    assert run_check(path, FakeTransport(http=limited))[0] == 1


def test_repeated_source_flags_accumulate(tmp_path):
    a, b, c = (
        tag_source(),
        {**tag_source(), "id": "tags2"},
        {**tag_source(), "id": "tags3"},
    )
    path = write_sources(tmp_path, a, b, c)
    t = FakeTransport(github={"repos/o/spec/git/matching-refs/tags?*": refs("2026-07-28")})
    code, out, _ = run_check(path, t, "--source", "tags", "--source", "tags2")
    assert code == 0
    assert "tags2" in out
    assert "tags3" not in out
    code, out, _ = run_check(path, t, "--source", "tags", "tags3")
    assert code == 0
    assert "tags3" in out
    assert "tags2" not in out
    args = delta.build_parser().parse_args(
        ["bump", "r.json", "--source", "tags", "--source", "tags2", "tags3"]
    )
    assert args.source == ["tags", "tags2", "tags3"]


def test_main_defaults_to_check(tmp_path, capsys):
    path = write_sources(tmp_path, tag_source())
    t = FakeTransport(github={"repos/o/spec/git/matching-refs/tags?*": refs("2026-07-28")})
    assert delta.main(["--source", "tags"], transport=t, sources_path=path) == 0
    assert "[unchanged] tags" in capsys.readouterr().out


def test_human_output_is_bounded_and_json_is_full(tmp_path):
    many = [f"2027-01-{d:02d}" for d in range(1, 31)]
    t = FakeTransport(github={"repos/o/spec/git/matching-refs/tags?*": refs(*many)})
    path = write_sources(tmp_path, tag_source())
    code, out, _ = run_check(path, t)
    block = out.splitlines()[:-1]
    assert code == 10
    assert len(block) <= 15
    assert "18 more" in block[-1]
    report_file = tmp_path / "r.json"
    code, out, _ = run_check(path, t, "--json", "--out", str(report_file))
    assert len(json.loads(out)["results"][0]["items"]) == 30
    assert json.loads(report_file.read_text())["results"][0]["head"] == "2027-01-30"


def bump(path, report, *extra):
    report_file = path.parent / "report.json"
    report_file.write_text(json.dumps(report))
    args = delta.build_parser().parse_args(["bump", str(report_file), *extra])
    return delta.cmd_bump(args, path, out=io.StringIO(), err=io.StringIO())


def report_for(*results):
    return {
        "schema": 1,
        "generated_at": "2026-10-01T00:00:00Z",
        "results": list(results),
    }


def test_bump_only_named_sources_from_report_heads(tmp_path):
    a, b = tag_source(), {**tag_source(), "id": "tags2"}
    path = write_sources(tmp_path, a, b)
    rep = report_for(
        {"id": "tags", "status": "changed", "base": "2026-07-28", "head": "2027-01-01"},
        {
            "id": "tags2",
            "status": "changed",
            "base": "2026-07-28",
            "head": "2027-02-02",
        },
    )
    assert bump(path, rep, "--source", "tags") == 0
    saved = {s["id"]: s["watermark"] for s in json.loads(path.read_text())["sources"]}
    assert saved["tags"] == {
        "value": "2027-01-01",
        "observed_at": "2026-10-01T00:00:00Z",
    }
    assert saved["tags2"]["value"] == "2026-07-28"


def test_bump_requires_explicit_selection(tmp_path):
    path = write_sources(tmp_path, tag_source())
    rep = report_for(
        {"id": "tags", "status": "changed", "base": "2026-07-28", "head": "2027-01-01"}
    )
    assert bump(path, rep) == 1
    assert json.loads(path.read_text())["sources"][0]["watermark"]["value"] == "2026-07-28"
    assert bump(path, rep, "--all") == 0
    assert json.loads(path.read_text())["sources"][0]["watermark"]["value"] == "2027-01-01"


def test_bump_refuses_errored_sources_and_stale_reports(tmp_path):
    path = write_sources(tmp_path, tag_source())
    errored = report_for({"id": "tags", "status": "error", "base": "2026-07-28", "head": None})
    assert bump(path, errored, "--all") == 1
    stale = report_for(
        {"id": "tags", "status": "changed", "base": "2025-01-01", "head": "2027-01-01"}
    )
    assert bump(path, stale, "--source", "tags") == 1
    deferred = report_for({"id": "tags", "status": "deferred", "base": "2026-07-28", "head": None})
    assert bump(path, deferred, "--all") == 1
    assert json.loads(path.read_text())["sources"][0]["watermark"]["value"] == "2026-07-28"


def test_shipped_sources_json_is_well_formed():
    data = json.loads(delta.SOURCES_FILE.read_text())
    ids = [s["id"] for s in data["sources"]]
    assert len(ids) == len(set(ids))
    for s in data["sources"]:
        assert s["kind"] in delta.KINDS
        assert s["informs"]
        assert s["why"]
        assert {"value", "observed_at"} <= set(s["watermark"])
