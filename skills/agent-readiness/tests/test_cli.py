"""CLI contract, driven through the public command against real git repos.

These pin what SKILL.md relies on: exit codes, the JSON keys the workflow
reads, bounded output, and that probing never executes project code.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import SCRIPT

# A suite run from a git hook inherits GIT_DIR/GIT_WORK_TREE; fixture repos
# must not, or every git call lands in the outer repository.
ENV = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
ENV.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)


def git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@users.noreply.github.com", *args],
        cwd=repo, env=ENV, check=True, capture_output=True,
    )  # fmt: skip


def make_repo(tmp_path: Path, files: dict[str, str], *, commit: bool = True) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q")
    for rel, body in files.items():
        p = repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body)
    git(repo, "add", "--", *files)
    if commit:
        git(repo, "commit", "-q", "--no-verify", "-m", "init")
    return repo


def run(*args: str, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args], capture_output=True, text=True, env=ENV,
        cwd=cwd, stdin=subprocess.DEVNULL, timeout=60,
    )  # fmt: skip


BASIC = {
    "README.md": "# demo\n\nInstall with `pnpm install`, build with `pnpm build`.\n" * 3,
    "package.json": '{"scripts": {"test": "vitest"}, "devDependencies": {"vitest": "3"}}',
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "src/a.test.ts": "import { test } from 'vitest'\n",
    ".gitignore": ".env\nnode_modules/\n",
}


def test_not_a_git_repo_exits_2(tmp_path):
    got = run(str(tmp_path))
    assert got.returncode == 2
    assert "probe.py:" in got.stderr


def test_missing_repo_argument_exits_2():
    assert run().returncode == 2


def test_unknown_flag_exits_2(tmp_path):
    assert run(str(tmp_path), "--bogus").returncode == 2


def test_json_carries_the_keys_the_workflow_reads(tmp_path):
    repo = make_repo(tmp_path, BASIC)
    got = run(str(repo), "--json")
    assert got.returncode == 0, got.stderr
    body = json.loads(got.stdout)
    assert {"schema", "repo", "commit", "date", "score", "results"} <= body.keys()
    assert {"flat_pct", "flat_level", "gated_level", "gate_gap", "pending_judgements",
            "env_skipped", "flat_pct_range_if_env_checked"} <= body["score"].keys()  # fmt: skip
    row = next(r for r in body["results"] if r["id"] == "deps_pinned")
    assert row["status"] == "pass"
    assert "pnpm-lock.yaml" in row["evidence"]
    assert {"method", "needs_approval", "skip_cause", "level", "origin"} <= row.keys()


def test_probe_resolves_the_repo_root_from_a_subdirectory(tmp_path):
    repo = make_repo(tmp_path, BASIC)
    got = run(str(repo / "src"), "--json")
    assert json.loads(got.stdout)["repo"] == "repo"


def test_repo_without_commits_still_probes(tmp_path):
    repo = make_repo(tmp_path, BASIC, commit=False)
    got = run(str(repo), "--json")
    assert got.returncode == 0, got.stderr
    assert json.loads(got.stdout)["commit"] == "no commits"


def test_text_report_names_gated_and_comparable_scores(tmp_path):
    got = run(str(make_repo(tmp_path, BASIC)))
    assert got.returncode == 0
    assert "Gated level:" in got.stdout
    assert "Flat score:" in got.stdout


def test_judged_file_folds_decisions_into_the_score(tmp_path):
    repo = make_repo(tmp_path, BASIC)
    judged = tmp_path / "judged.json"
    judged.write_text(
        json.dumps({"interactive_qa_exists": {"status": "fail", "detail": "no run docs"}})
    )
    body = json.loads(run(str(repo), "--json", "--judged", str(judged)).stdout)
    row = next(r for r in body["results"] if r["id"] == "interactive_qa_exists")
    assert (row["status"], row["detail"]) == ("fail", "no run docs")


def test_bad_judged_file_exits_2(tmp_path):
    repo = make_repo(tmp_path, BASIC)
    judged = tmp_path / "judged.json"
    judged.write_text(json.dumps({"not_a_criterion": {"status": "pass"}}))
    got = run(str(repo), "--judged", str(judged))
    assert got.returncode == 2
    assert "not_a_criterion" in got.stderr


def test_previous_snapshot_is_diffed_mechanically(tmp_path):
    repo = make_repo(tmp_path, BASIC)
    before = tmp_path / "before.json"
    before.write_text(run(str(repo), "--json").stdout)
    (repo / "AGENTS.md").write_text(
        "Setup: `pnpm install`. Test: `pnpm test`. Lint: `pnpm lint`.\n" * 3
    )
    git(repo, "add", "AGENTS.md")
    git(repo, "commit", "-q", "--no-verify", "-m", "agents")
    got = run(str(repo), "--previous", str(before))
    assert "CHANGED since previous snapshot" in got.stdout
    assert "agents_md: fail -> pass" in got.stdout
    assert "Judged in only one run" not in got.stdout


def test_output_is_bounded_on_a_large_repo(tmp_path):
    files = {f"pkg{i // 100}/mod{i}.test.ts": "" for i in range(5000)}
    files.update({f"pkg{n}/package.json": "{}" for n in range(50)})
    repo = make_repo(tmp_path, {**BASIC, **files})
    got = run(str(repo))
    assert got.returncode == 0
    assert len(got.stdout) < 20_000
    assert len(got.stdout.splitlines()) < 250


def test_probe_never_executes_project_code(tmp_path):
    marker = tmp_path / "EXECUTED"
    touch = f"touch {marker}"
    files = {
        "package.json": json.dumps(
            {
                "scripts": {"postinstall": touch, "prepare": touch, "test": touch, "build": touch},
            }
        ),
        "Makefile": f"all:\n\t{touch}\ntest:\n\t{touch}\n",
        "justfile": f"default:\n    {touch}\n",
        "tests/test_a.py": f"import pathlib\npathlib.Path({str(marker)!r}).touch()\n",
        "conftest.py": f"import pathlib\npathlib.Path({str(marker)!r}).touch()\n",
        "setup.py": f"import pathlib\npathlib.Path({str(marker)!r}).touch()\n",
        ".husky/pre-commit": touch,
        ".envrc": touch,
    }
    repo = make_repo(tmp_path, files)
    for args in ((str(repo),), (str(repo), "--json")):
        assert run(*args).returncode == 0
    assert not marker.exists()


@pytest.mark.parametrize("args", [("--criteria-md",)])
def test_criteria_md_needs_no_repo(args, tmp_path):
    got = run(*args, cwd=tmp_path)
    assert got.returncode == 0
    assert got.stdout.startswith("# Criteria")
