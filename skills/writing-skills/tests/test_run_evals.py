"""Tests for scripts/run_evals.py.

Pure-core table tests, plus black-box CLI tests that put fake `claude` and
`codex` executables on PATH. The fakes replay transcripts captured from the
real CLIs (tests/fixtures/transcripts), so a client's output format drifting
away from what the parser expects shows up as a fixture refresh that fails.
"""

from __future__ import annotations

import importlib.util
import json
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "run_evals.py"
TRANSCRIPTS = Path(__file__).resolve().parent / "fixtures" / "transcripts"

spec = importlib.util.spec_from_file_location("run_evals", SCRIPT)
assert spec
assert spec.loader
run_evals = importlib.util.module_from_spec(spec)
sys.modules["run_evals"] = run_evals
spec.loader.exec_module(run_evals)


def lines(name: str) -> list[str]:
    return (TRANSCRIPTS / name).read_text().splitlines()


# --- parse_evals -------------------------------------------------------------


def test_parse_evals_reads_upstream_fields_and_checks():
    cases = run_evals.parse_evals(
        {
            "skill_name": "demo",
            "evals": [
                {
                    "id": 1,
                    "name": "one",
                    "prompt": "do it in <workspace>/x",
                    "expected_output": "done",
                    "files": ["evals/fixtures/x"],
                    "assertions": ["says done"],
                    "checks": [
                        {"type": "tool_used", "tool": "Bash", "input_match": "ls"},
                        {"type": "file_exists", "path": "x/*.md"},
                    ],
                }
            ],
        }
    )
    assert [c.name for c in cases] == ["one"]
    assert cases[0].files == ("evals/fixtures/x",)
    assert cases[0].checks[0] == run_evals.ToolUsed(tool="Bash", input_match="ls", min=1, max=None)
    assert cases[0].checks[1] == run_evals.FileExists(path="x/*.md")


def test_parse_evals_defaults_optional_fields():
    (case,) = run_evals.parse_evals({"evals": [{"id": 7, "prompt": "p"}]})
    assert case.name == "eval-7"
    assert case.files == ()
    assert case.assertions == ()
    assert case.checks == ()


@pytest.mark.parametrize(
    ("data", "message"),
    [
        ({}, "evals"),
        ({"evals": [{"id": 1}]}, "prompt"),
        (
            {"evals": [{"id": 1, "prompt": "p", "checks": [{"type": "nope"}]}]},
            "unknown check type 'nope'",
        ),
        ({"evals": [{"id": 1, "prompt": "p", "checks": [{"type": "regex"}]}]}, "pattern"),
        (
            {"evals": [{"id": 1, "prompt": "p", "checks": [{"type": "regex", "pattern": "("}]}]},
            "invalid regex",
        ),
    ],
)
def test_parse_evals_rejects_bad_input_with_a_named_cause(data, message):
    with pytest.raises(run_evals.EvalsError, match=message):
        run_evals.parse_evals(data)


# --- normalise -----------------------------------------------------------------


def test_normalise_claude_transcript():
    t = run_evals.normalise("claude", lines("claude-work.jsonl"), "spike-marker")
    assert [(c.tool, c.input_text[:12]) for c in t.tool_calls] == [
        ("Bash", '{"command": '),
        ("Write", '{"file_path"'),
    ]
    assert t.tool_calls[0].output == ".\n.."
    assert t.final_message.strip().lower().startswith("done")
    assert t.cost_usd == pytest.approx(0.0232872, rel=1e-3)
    assert t.tokens > 0
    assert t.skill_loaded is False


def test_normalise_codex_transcript_maps_shell_to_bash():
    t = run_evals.normalise("codex", lines("codex-work.jsonl"), "spike-marker")
    assert [c.tool for c in t.tool_calls] == ["Bash", "Bash"]
    assert "ls -a" in t.tool_calls[0].input_text
    assert t.final_message == "done"
    assert t.cost_usd is None
    assert t.tokens == 29392 + 84


@pytest.mark.parametrize(
    ("agent", "arm", "loaded"),
    [
        ("claude", "with", True),
        ("claude", "without", False),
        ("codex", "with", True),
        ("codex", "without", False),
    ],
)
def test_skill_load_is_detected_per_client(agent, arm, loaded):
    t = run_evals.normalise(agent, lines(f"{agent}-{arm}-skill.jsonl"), "spike-marker")
    assert t.skill_loaded is loaded
    assert "PERIWINKLE-42" in t.final_message or not loaded


def test_normalise_tolerates_string_and_list_shaped_fields():
    # Claude emits permission_denied events whose `message` is a string.
    odd = [
        '{"type":"system","subtype":"permission_denied","message":"Claude requested permissions"}',
        '{"type":"assistant","message":{"content":["not-a-block"]}}',
        '{"type":"result","result":"ok","usage":[1]}',
    ]
    t = run_evals.normalise("claude", odd, "x")
    assert t.final_message == "ok"
    assert t.tool_calls == ()


def test_snapshot_hides_only_the_placed_skill(tmp_path):
    for rel in (
        ".claude/skills/mine/SKILL.md",
        ".agents/skills/mine/SKILL.md",
        ".claude/skills/made-by-agent/SKILL.md",
        "notes/a.md",
    ):
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_text("x")

    files = run_evals.snapshot(tmp_path, "mine")

    assert sorted(files) == [".claude/skills/made-by-agent/SKILL.md", "notes/a.md"]


def test_normalise_skips_non_json_lines():
    t = run_evals.normalise("claude", ["warning: noise", *lines("claude-work.jsonl")], "x")
    assert len(t.tool_calls) == 2


# --- grade -----------------------------------------------------------------------

CALLS = (
    run_evals.ToolCall("Bash", '{"command": "ls -a"}', ""),
    run_evals.ToolCall("Bash", '{"command": "bash scripts/check.sh ."}', ""),
    run_evals.ToolCall("Write", '{"file_path": "/w/x/SKILL.md"}', ""),
)
TRANSCRIPT = run_evals.Transcript(CALLS, "all done, name fixed", 10, None, False)
FILES = {"x/SKILL.md": "---\nname: x\n---\n", "notes/a.txt": "hi"}


@pytest.mark.parametrize(
    ("check", "passed"),
    [
        (run_evals.ToolUsed("Bash", r"check\.sh", 1, None), True),
        (run_evals.ToolUsed("Bash", r"rm -rf", 1, None), False),
        (run_evals.ToolUsed(None, None, 0, 3), True),
        (run_evals.ToolUsed(None, None, 0, 2), False),
        (run_evals.ToolUsed("Bash", None, 2, 2), True),
        (run_evals.ToolOrder((("Bash", "ls"), ("Write", None))), True),
        (run_evals.ToolOrder((("Write", None), ("Bash", "check"))), False),
        (run_evals.FileExists("*/SKILL.md"), True),
        (run_evals.FileExists("*/evals.json"), False),
        (run_evals.Regex(r"(?m)^name: x$", "x/SKILL.md"), True),
        (run_evals.Regex(r"(?m)^name: y$", "x/SKILL.md"), False),
        (run_evals.Regex(r"name fixed", None), True),
        (run_evals.Regex(r"anything", "missing.md"), False),
    ],
)
def test_grade_check(check, passed):
    result = run_evals.grade(check, TRANSCRIPT, FILES)
    assert result.passed is passed
    assert result.evidence


def test_workspace_diff_shows_edits_new_files_and_deletions():
    before = {"x/SKILL.md": "name: x-typo\nbody\n", "gone.md": "bye\n", "same.md": "same\n"}
    after = {"x/SKILL.md": "name: x\nbody\n", "new.md": "fresh\n", "same.md": "same\n"}

    diff = run_evals.workspace_diff(before, after)

    assert "-name: x-typo" in diff
    assert "+name: x" in diff
    assert "+fresh" in diff
    assert "gone.md" in diff
    assert "same.md" not in diff
    assert run_evals.workspace_diff(after, after) == ""


# --- aggregate -------------------------------------------------------------------


def record(case, arm, run, passed, total, loaded, tokens=100, seconds=10.0, cost=0.5):
    return run_evals.RunRecord(
        case=case,
        arm=arm,
        run=run,
        passed=passed,
        total=total,
        skill_loaded=loaded,
        tokens=tokens,
        seconds=seconds,
        cost_usd=cost,
        error=None,
        transcript="t.jsonl",
    )


def test_aggregate_computes_rates_spread_and_delta():
    records = [
        record("a", "with_skill", 1, 2, 2, True, tokens=200),
        record("a", "with_skill", 2, 1, 2, True, tokens=200),
        record("a", "without_skill", 1, 0, 2, False),
        record("a", "without_skill", 2, 0, 2, False),
    ]
    b = run_evals.aggregate(records)
    w = b["run_summary"]["with_skill"]
    assert w["pass_rate"]["mean"] == pytest.approx(0.75)
    assert w["pass_rate"]["stddev"] == pytest.approx(0.3536, abs=1e-3)
    assert w["skill_load_rate"] == 1.0
    assert b["run_summary"]["without_skill"]["skill_load_rate"] == 0.0
    assert b["run_summary"]["delta"]["pass_rate"] == pytest.approx(0.75)
    assert b["run_summary"]["delta"]["tokens"] == pytest.approx(100)
    assert b["run_summary"]["with_skill"]["cost_usd"] == pytest.approx(1.0)
    (case,) = b["cases"]
    assert case["name"] == "a"
    assert case["delta"]["pass_rate"] == pytest.approx(0.75)


def test_aggregate_counts_errored_runs_as_zero():
    b = run_evals.aggregate(
        [
            run_evals.RunRecord("a", "with_skill", 1, 0, 0, False, None, 1.0, None, "boom", ""),
        ]
    )
    assert b["run_summary"]["with_skill"]["pass_rate"]["mean"] == 0.0
    assert b["run_summary"]["with_skill"]["errors"] == 1


def test_run_one_records_an_unexpected_crash_as_that_runs_error(tmp_path):
    # One run's bug must not abort the suite and lose every other result.
    class Crashing:
        name = "claude"

        def run(self, ws, prompt, model):
            raise RuntimeError("boom")

        def judge(self, prompt, model):
            raise AssertionError("unreachable")

    skill = tmp_path / "s"
    skill.mkdir()
    case = run_evals.Case(1, "c", "p", "", (), (), ())
    args = type("A", (), {"model": None, "judge_model": None})()

    r = run_evals.run_one(
        Crashing(), args, skill, case, "with_skill", 1, tmp_path / "out", run_evals.Budget(None)
    )

    assert r is not None
    assert "boom" in r.error


# --- CLI (fake clients on PATH) ----------------------------------------------------

FAKE = r"""#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
argv = sys.argv[1:]
fixtures = Path(os.environ["FAKE_TRANSCRIPTS"])
prompt = sys.stdin.read()
log = Path(os.environ["FAKE_LOG"])
with log.open("a") as f:
    f.write(json.dumps({"agent": "AGENT", "argv": argv, "home": os.environ.get("HOME"), "cwd": os.getcwd()}) + "\n")
judge = "--json-schema" in argv or "--output-schema" in argv
if judge:
    verdict = {"results": [{"assertion": "a", "passed": True, "evidence": "fake judge"}]}
    if "AGENT" == "claude":
        print(json.dumps({"type": "result", "structured_output": verdict, "total_cost_usd": 0.01, "is_error": False}))
    else:
        out = argv[argv.index("-o") + 1]
        Path(out).write_text(json.dumps(verdict))
    sys.exit(0)
cwd = Path(argv[argv.index("-C") + 1]) if "-C" in argv else Path.cwd()
arm = "with" if (cwd / ".claude" / "skills").exists() or (cwd / ".agents" / "skills").exists() else "without"
(cwd / "notes").mkdir(exist_ok=True)
(cwd / "notes" / "out.md").write_text("hello\n")
sys.stdout.write((fixtures / f"AGENT-{arm}-skill.jsonl").read_text())
"""


def make_fake(bindir: Path, agent: str) -> None:
    path = bindir / agent
    path.write_text(FAKE.replace("AGENT", agent))
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


@pytest.fixture
def env(tmp_path):
    bindir = tmp_path / "bin"
    bindir.mkdir()
    for agent in ("claude", "codex"):
        make_fake(bindir, agent)
    home = tmp_path / "home"
    (home / ".codex").mkdir(parents=True)
    (home / ".codex" / "auth.json").write_text("{}")
    e = dict(os.environ)
    e.update(
        PATH=f"{bindir}{os.pathsep}{e['PATH']}",
        HOME=str(home),
        FAKE_TRANSCRIPTS=str(TRANSCRIPTS),
        FAKE_LOG=str(tmp_path / "calls.jsonl"),
    )
    e.pop("CODEX_HOME", None)
    return e


def make_skill(tmp_path: Path, checks: list[dict] | None = None) -> Path:
    skill = tmp_path / "spike-marker"
    (skill / "evals" / "fixtures" / "target").mkdir(parents=True)
    (skill / "SKILL.md").write_text(
        "---\nname: spike-marker\ndescription: Use for the spike word.\n---\n\nSay PERIWINKLE-42.\n"
    )
    (skill / "evals" / "fixtures" / "target" / "SKILL.fixture.md").write_text(
        "---\nname: target\n---\n"
    )
    (skill / "evals" / "evals.json").write_text(
        json.dumps(
            {
                "skill_name": "spike-marker",
                "evals": [
                    {
                        "id": 1,
                        "name": "spike-word",
                        "prompt": "what is the secret spike word? see <workspace>/target",
                        "expected_output": "PERIWINKLE-42",
                        "files": ["evals/fixtures/target"],
                        "assertions": ["Says the spike word"],
                        "checks": checks
                        if checks is not None
                        else [
                            {"type": "regex", "pattern": "PERIWINKLE-42"},
                            {"type": "file_exists", "path": "target/SKILL.md"},
                        ],
                    }
                ],
            }
        )
    )
    return skill


def run_cli(env, *args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )


@pytest.mark.parametrize("agent", ["claude", "codex"])
def test_cli_runs_both_arms_and_writes_benchmark(tmp_path, env, agent):
    skill = make_skill(tmp_path)
    out = tmp_path / "out"

    r = run_cli(env, str(skill), "--agent", agent, "--runs", "1", "--out", str(out))

    # A case passes on its with-skill arm; the baseline never says the word
    # and failing there is the expected, measured difference.
    assert r.returncode == 0, r.stderr
    results = json.loads((out / "results.json").read_text())
    summary = results["run_summary"]
    assert summary["with_skill"]["pass_rate"]["mean"] == 1.0
    assert summary["with_skill"]["skill_load_rate"] == 1.0
    assert summary["without_skill"]["skill_load_rate"] == 0.0
    assert summary["delta"]["pass_rate"] > 0
    assert (out / "report.md").read_text().count("/transcript.jsonl)") == 2
    assert "spike-word" in r.stdout
    assert len(r.stdout.splitlines()) < 20


def test_cli_isolates_codex_home_and_places_skill_for_both_clients(tmp_path, env):
    skill = make_skill(tmp_path)
    run_cli(env, str(skill), "--agent", "codex", "--runs", "1", "--out", str(tmp_path / "out"))

    calls = [json.loads(line) for line in Path(env["FAKE_LOG"]).read_text().splitlines()]
    runs = [c for c in calls if "--output-schema" not in c["argv"]]
    assert {c["home"] for c in runs}.isdisjoint({env["HOME"]})
    for c in runs:
        assert "--ignore-user-config" in c["argv"]
        assert "--ephemeral" in c["argv"]
    with_ws = [Path(c["argv"][c["argv"].index("-C") + 1]) for c in runs]
    placed = [ws for ws in with_ws if (ws / ".agents/skills/spike-marker/SKILL.md").exists()]
    assert len(placed) == 1
    assert (placed[0] / ".claude/skills/spike-marker/SKILL.md").exists()
    assert not (placed[0] / ".agents/skills/spike-marker/evals").exists()
    assert (placed[0] / "target/SKILL.md").exists()


def test_cli_stops_at_cost_ceiling_with_partial_exit(tmp_path, env):
    skill = make_skill(tmp_path)
    out = tmp_path / "out"

    r = run_cli(
        env,
        str(skill),
        "--agent",
        "claude",
        "--runs",
        "3",
        "-j",
        "1",
        "--max-cost-usd",
        "0.001",
        "--out",
        str(out),
    )

    assert r.returncode == 2, r.stderr
    results = json.loads((out / "results.json").read_text())
    assert results["meta"]["partial"] is True
    assert "cost ceiling" in r.stderr


def test_cli_fails_when_a_with_skill_check_fails(tmp_path, env):
    skill = make_skill(tmp_path, checks=[{"type": "regex", "pattern": "NEVER-SAID"}])

    r = run_cli(env, str(skill), "--agent", "claude", "--runs", "1", "--out", str(tmp_path / "out"))

    assert r.returncode == 1, r.stderr
    results = json.loads((tmp_path / "out" / "results.json").read_text())
    assert results["cases"][0]["with_skill"]["pass_rate"]["mean"] == pytest.approx(0.5)


@pytest.mark.parametrize(
    "args",
    [
        ["--agent", "gemini"],
        ["--agent", "claude", "--case", "no-such-case"],
    ],
)
def test_cli_usage_errors_exit_1(tmp_path, env, args):
    skill = make_skill(tmp_path)
    r = run_cli(env, str(skill), *args)
    assert r.returncode == 1
    assert r.stderr


def test_cli_missing_client_binary_is_actionable(tmp_path, env):
    skill = make_skill(tmp_path)
    env["PATH"] = "/usr/bin:/bin"
    r = run_cli(env, str(skill), "--agent", "codex", "--runs", "1")
    assert r.returncode == 1
    assert "codex" in r.stderr
    assert "PATH" in r.stderr
