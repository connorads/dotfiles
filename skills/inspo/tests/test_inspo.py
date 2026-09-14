"""Hermetic tests for ``scripts/inspo.py``: fixtures on disk, never the network.

Two layers. Unit tests reach the module through ``importlib`` and pin the things
a fixture cannot show - the headers on a constructed request, the fallback route
when a capture URL 404s. CLI tests run the script as a subprocess and pin the
contract an agent actually depends on: exit status, what lands on stdout, and
what lands on stderr.

Every CLI test passes ``--offline --cache tests/fixtures``, so a test that
reached for the network would fail rather than silently pass.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "inspo.py"
FIXTURES = Path(__file__).resolve().parent / "fixtures"


def load_module():
    spec = importlib.util.spec_from_file_location("inspo", SCRIPT)
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


inspo = load_module()


def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--offline", "--cache", str(FIXTURES), *args],
        capture_output=True,
        text=True,
        check=False,
    )


# --------------------------------------------------------------------------
# Transport
# --------------------------------------------------------------------------


def test_request_accepts_both_json_and_event_stream():
    """Omit either type and the transport answers 406, whatever the body says."""
    request = inspo.build_request(inspo.ENDPOINT, "tools/list", {}, 4000)
    accept = request.get_header("Accept")
    assert "application/json" in accept
    assert "text/event-stream" in accept


@pytest.mark.parametrize("method", ["tools/list", "tools/call"])
def test_every_request_suppresses_the_image_block(method):
    """No base64 screenshot ever reaches the agent through this transport."""
    request = inspo.build_request(inspo.ENDPOINT, method, {}, 4000)
    assert "images=none" in request.full_url
    assert "maxTokens=4000" in request.full_url


def test_a_body_over_max_bytes_is_refused_by_name(monkeypatch):
    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def read(self, size):
            return b"x" * size

    monkeypatch.setattr(inspo.urllib.request, "urlopen", lambda *a, **k: FakeResponse())
    with pytest.raises(inspo.InspoError) as caught:
        inspo.fetch("https://example.invalid/big", timeout=1, max_bytes=64)
    assert "--max-bytes" in str(caught.value)


# --------------------------------------------------------------------------
# Argument coercion
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("pair", "key", "value"),
    [
        ("limit=3", "limit", 3),
        ('slugs=["a","b"]', "slugs", ["a", "b"]),
        ("brief=a designer's portfolio", "brief", "a designer's portfolio"),
        ("query=", "query", ""),
        ("live=false", "live", False),
    ],
)
def test_arg_pairs_coerce_through_json_then_fall_back_to_the_raw_string(pair, key, value):
    assert inspo.parse_arg_pairs([pair]) == {key: value}


def test_an_arg_without_an_equals_sign_is_a_usage_error():
    with pytest.raises(inspo.UsageError):
        inspo.parse_arg_pairs(["limit"])


# --------------------------------------------------------------------------
# The two error channels
# --------------------------------------------------------------------------


def test_is_error_true_exits_1_with_the_server_text():
    done = run("call", "search_screens", "--arg", "query=x", "--arg", "vibe=editorial")
    assert done.returncode == 1
    assert "MCP error -32602" in done.stderr
    assert done.stdout == ""


def test_an_unknown_slug_exits_1_although_the_call_reported_success():
    """HTTP 200, no ``isError``, and the payload is an error object.

    Exiting 0 here would hand the agent an error string as its design brief.
    """
    done = run("call", "get_screen", "--arg", "slug=nope-xyz")
    assert done.returncode == 1
    assert "No screen with slug" in done.stderr
    assert "Slugs come from" in done.stderr
    assert done.stdout == ""


def test_a_budget_note_goes_to_stderr_and_stdout_stays_json():
    done = run(
        "--max-tokens",
        "200",
        "call",
        "search_screens",
        "--arg",
        "query=a designer's portfolio",
        "--arg",
        "limit=8",
    )
    assert done.returncode == 0
    assert "Trimmed to fit maxTokens" in done.stderr
    assert json.loads(done.stdout)["count"]


# --------------------------------------------------------------------------
# Validation precedes I/O
# --------------------------------------------------------------------------


def test_malformed_json_exits_2_before_the_cache_is_touched(tmp_path):
    done = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--offline",
            "--cache",
            str(tmp_path),
            "call",
            "search_screens",
            "--json",
            "{oops",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert done.returncode == 2
    assert "--json is not valid JSON" in done.stderr
    assert list(tmp_path.iterdir()) == []


def test_a_json_array_is_a_usage_error_not_a_tool_call(tmp_path):
    done = subprocess.run(
        [sys.executable, str(SCRIPT), "--cache", str(tmp_path), "call", "x", "--json", "[1]"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert done.returncode == 2
    assert "JSON object" in done.stderr


def test_more_than_eight_slugs_is_a_usage_error():
    done = run("shots", *[f"slug-{n}" for n in range(9)])
    assert done.returncode == 2
    assert "at most 8 slugs" in done.stderr


# --------------------------------------------------------------------------
# Captures
# --------------------------------------------------------------------------


def test_shots_prints_one_absolute_path_per_line_and_the_files_exist():
    done = run("shots", "karocrafts-com")
    assert done.returncode == 0
    paths = [Path(line) for line in done.stdout.splitlines()]
    assert paths
    for path in paths:
        assert path.is_absolute()
        assert path.exists()


def test_a_warm_cache_needs_no_fetch():
    """The same run under ``--offline`` is the proof that nothing was fetched."""
    assert run("shots", "karocrafts-com").returncode == 0


def test_a_missing_capture_fails_by_name_rather_than_partly_succeeding():
    done = run("shots", "karocrafts-com", "not-cached-at-all")
    assert done.returncode == 1
    assert "not-cached-at-all" in done.stderr


def test_a_404_on_the_constructed_url_falls_back_to_get_screen(tmp_path, monkeypatch):
    """An upstream filename change heals instead of killing the command."""
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    (cache_dir / "manifest.json").write_text(
        json.dumps(
            {
                inspo.rpc_key(
                    "tools/call",
                    {"name": "get_screen", "arguments": {"slug": "karocrafts-com"}},
                    4000,
                ): "get-screen.json"
            }
        )
    )
    (cache_dir / "get-screen.json").write_text(
        (FIXTURES / "get-screen.json").read_text(encoding="utf-8"), encoding="utf-8"
    )

    asked: list[str] = []

    def fake_fetch(target, timeout, max_bytes):
        asked.append(target if isinstance(target, str) else target.full_url)
        if len(asked) == 1:
            raise inspo.InspoError("HTTP 404")
        return b"capture bytes"

    monkeypatch.setattr(inspo, "fetch", fake_fetch)
    opts = inspo.build_parser().parse_args(["shots", "karocrafts-com"])
    opts.cache = cache_dir
    cache = inspo.Cache(cache_dir, offline=False)

    path = inspo.download("karocrafts-com", "hero", opts, cache)

    assert path.read_bytes() == b"capture bytes"
    assert len(asked) == 2
    assert asked[0] == inspo.capture_url("karocrafts-com", "hero")
    # The archive's own URL, with its cache-buster dropped: the captures are
    # public and serve fine without it.
    assert asked[1].endswith("hero.1440.webp")
    assert "?" not in asked[1]


def test_an_offline_run_writes_nothing_into_the_cache():
    before = {p: p.stat().st_mtime_ns for p in sorted(FIXTURES.rglob("*"))}
    assert run("shots", "karocrafts-com").returncode == 0
    assert run("tools").returncode == 0
    after = {p: p.stat().st_mtime_ns for p in sorted(FIXTURES.rglob("*"))}
    assert before == after


# --------------------------------------------------------------------------
# Listing
# --------------------------------------------------------------------------


def test_tools_lists_each_tool_with_its_arguments_marking_the_required_ones():
    done = run("tools")
    assert done.returncode == 0
    assert "search_screens(query, style" in done.stdout
    assert "get_screen(slug*)" in done.stdout


def test_tools_prints_the_accepted_values_of_an_enumerated_argument():
    """Argument names alone leave an enum value as something to guess at."""
    done = run("tools")
    assert "detail: concise|standard|full" in done.stdout
    assert "mode: light|dark" in done.stdout
