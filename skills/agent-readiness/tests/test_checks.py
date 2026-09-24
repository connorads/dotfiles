"""Pure-core table tests: each check is a predicate over an in-memory Snapshot.

The tool-agnostic rule is tested directly: every mechanism a criterion's
examples name must pass it, and near-misses must not.
"""

from __future__ import annotations

from datetime import date

import pytest
from conftest import TODAY, probe, snap, verdict

LONG = "Run `pnpm install` then `pnpm test`. " * 5


def kind(v):
    return type(v).__name__


# --- the local gate: any mechanism counts ------------------------------------


@pytest.mark.parametrize(
    "files",
    [
        {".husky/pre-commit": "pnpm lint-staged"},
        {".pre-commit-config.yaml": "repos:\n- repo: ruff"},
        {"lefthook.yml": "pre-commit:\n  commands: {}"},
        {"hk.pkl": 'hooks { ["pre-commit"] {} }'},
        {".githooks/pre-commit": "#!/bin/sh\nmake lint"},
        {"package.json": '{"simple-git-hooks": {"pre-commit": "pnpm lint"}}'},
        {".claude/settings.json": '{"hooks": {"PostToolUse": [{"command": "pnpm lint"}]}}'},
    ],
    ids=["husky", "pre-commit", "lefthook", "hk", "githooks", "simple-git-hooks", "agent-hook"],
)
def test_local_gate_passes_for_any_hook_mechanism(files):
    assert kind(verdict("pre_commit_hooks", snap(files))) == "Pass"


def test_ci_only_lint_is_not_a_local_gate():
    files = {".github/workflows/ci.yml": "steps:\n  - run: pnpm lint"}
    assert kind(verdict("pre_commit_hooks", snap(files))) == "Fail"


def test_agent_settings_without_hooks_are_not_a_local_gate():
    files = {".claude/settings.json": '{"permissions": {"allow": []}}'}
    assert kind(verdict("pre_commit_hooks", snap(files))) == "Fail"


# --- toolchain_pinned: any version declaration counts ------------------------


@pytest.mark.parametrize(
    "files",
    [
        {".tool-versions": "nodejs 22.3.0"},
        {"mise.toml": '[tools]\nnode = "22"'},
        {"flake.nix": "{ outputs = _: {}; }"},
        {"devbox.json": '{"packages": ["nodejs@22"]}'},
        {".nvmrc": "22"},
        {".python-version": "3.12"},
        {"rust-toolchain.toml": '[toolchain]\nchannel = "1.80"'},
        {"go.mod": "module x\n\ngo 1.22\n"},
        {"gradle/wrapper/gradle-wrapper.properties": "distributionUrl=..."},
        {"package.json": '{"volta": {"node": "22.3.0"}}'},
    ],
    ids=[
        "asdf",
        "mise",
        "nix",
        "devbox",
        "nvmrc",
        "python-version",
        "rust",
        "go",
        "gradle",
        "volta",
    ],
)
def test_toolchain_pinned_passes_for_any_version_declaration(files):
    assert kind(verdict("toolchain_pinned", snap(files))) == "Pass"


def test_toolchain_unpinned_when_only_a_manifest_exists():
    files = {"package.json": '{"scripts": {"typecheck": "tsc"}}'}
    assert kind(verdict("toolchain_pinned", snap(files))) == "Fail"


# --- skills --------------------------------------------------------------------

SKILL = "---\nname: deploy\ndescription: Deploy the app to staging.\n---\n\nSteps..."


@pytest.mark.parametrize(
    "path",
    [
        ".agents/skills/deploy/SKILL.md",
        ".claude/skills/deploy/SKILL.md",
        ".codex/skills/deploy/SKILL.md",
    ],
)
def test_skills_pass_in_any_agent_skills_dir(path):
    assert kind(verdict("skills", snap({path: SKILL}))) == "Pass"


def test_skill_without_description_does_not_count():
    bad = "---\nname: deploy\n---\n\nSteps"
    assert kind(verdict("skills", snap({".agents/skills/deploy/SKILL.md": bad}))) == "Fail"


# --- min_release_age: every ecosystem's gate counts -------------------------


@pytest.mark.parametrize(
    "files",
    [
        {"pnpm-workspace.yaml": "minimumReleaseAge: 4320"},
        {".npmrc": "min-release-age=3"},
        {"pyproject.toml": '[tool.uv]\nexclude-newer = "7 days"'},
        {"uv.toml": 'exclude-newer = "7 days"'},
        {"renovate.json": '{"minimumReleaseAge": "3 days"}'},
        {"renovate.json": '{"packageRules": [{"stabilityDays": 3}]}'},
        {"bunfig.toml": "[install]\nminimumReleaseAge = 259200"},
        {".yarnrc.yml": "npmMinimalAgeGate: 3d"},
        {".github/dependabot.yml": "updates:\n  - cooldown:\n      default-days: 3"},
    ],
    ids=[
        "pnpm",
        "npm",
        "uv-pyproject",
        "uv-toml",
        "renovate",
        "renovate-stability",
        "bun",
        "yarn",
        "dependabot",
    ],
)
def test_min_release_age_passes_for_any_age_gate(files):
    assert kind(verdict("min_release_age", snap(files))) == "Pass"


def test_update_bot_without_a_delay_is_not_an_age_gate():
    files = {"renovate.json": '{"extends": ["config:recommended"]}'}
    assert kind(verdict("min_release_age", snap(files))) == "Fail"


# --- docs ------------------------------------------------------------------------


def test_empty_agents_md_fails():
    assert kind(verdict("agents_md", snap({"AGENTS.md": "# TODO\n"}))) == "Fail"


def test_substantive_agents_md_passes():
    assert kind(verdict("agents_md", snap({"AGENTS.md": LONG}))) == "Pass"


def test_nested_agents_md_is_not_the_root_file():
    assert kind(verdict("agents_md", snap({"pkg/AGENTS.md": LONG}))) == "Fail"


def test_readme_missing_fails_and_present_passes():
    assert kind(verdict("readme", snap({}))) == "Fail"
    assert kind(verdict("readme", snap({"README.md": LONG}))) == "Pass"


def test_documented_build_command_passes():
    assert kind(verdict("build_cmd_doc", snap({"README.md": "Build: `pnpm build`"}))) == "Pass"


def test_docs_without_a_build_command_need_judgement():
    got = verdict("build_cmd_doc", snap({"README.md": "A small library for parsing."}))
    assert kind(got) == "NeedsJudgement"
    assert "README.md" in got.candidates


def test_documentation_freshness_uses_last_commit_dates():
    fresh = snap({"README.md": "x"}, doc_dates={"README.md": date(2026, 6, 1)})
    stale = snap({"README.md": "x"}, doc_dates={"README.md": date(2025, 1, 1)})
    assert kind(verdict("documentation_freshness", fresh)) == "Pass"
    assert kind(verdict("documentation_freshness", stale)) == "Fail"


# --- dependencies -----------------------------------------------------------------


def test_lockfile_pins_dependencies():
    files = {"package.json": "{}", "pnpm-lock.yaml": "lockfileVersion: 9"}
    assert kind(verdict("deps_pinned", snap(files))) == "Pass"


def test_manifest_without_lockfile_fails():
    assert kind(verdict("deps_pinned", snap({"package.json": "{}"}))) == "Fail"


def test_repo_without_manifests_skips_dependency_pinning():
    got = verdict("deps_pinned", snap({"README.md": "x"}))
    assert kind(got) == "Skip"
    assert got.cause == "not_applicable"


def test_every_ecosystem_needs_its_own_lockfile():
    files = {"package.json": "{}", "bun.lock": "{}", "pyproject.toml": "[project]"}
    got = verdict("deps_pinned", snap(files))
    assert kind(got) == "Fail"
    assert "pyproject.toml" in got.reason


# --- tests exist, across languages ---------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "src/a.test.ts",
        "src/__tests__/a.js",
        "tests/test_a.py",
        "pkg/a_test.go",
        "src/test/java/AppTest.java",
        "spec/a_spec.rb",
        "test/cli.bats",
    ],
)
def test_unit_tests_exist_for_any_language(path):
    assert kind(verdict("unit_tests_exist", snap([path]))) == "Pass"


def test_no_test_files_fails():
    assert kind(verdict("unit_tests_exist", snap(["src/a.ts"]))) == "Fail"


def test_runnable_tests_need_approved_collection():
    files = {"package.json": '{"devDependencies": {"vitest": "3"}}', "src/a.test.ts": ""}
    got = verdict("unit_tests_runnable", snap(files))
    assert kind(got) == "NeedsJudgement"
    assert "vitest list" in got.question


def test_runnable_tests_skip_when_there_are_no_tests():
    got = verdict("unit_tests_runnable", snap({"package.json": "{}"}))
    assert kind(got) == "Skip"


# --- environment checks never blame the repo ----------------------------------


@pytest.mark.parametrize(
    "cid", ["vcs_cli_tools", "branch_protection", "backlog_health", "fast_ci_feedback"]
)
def test_forge_only_checks_skip_as_environment(cid):
    got = verdict(cid, snap({".github/workflows/ci.yml": "on: pull_request"}))
    assert kind(got) == "Skip"
    assert got.cause == "environment"


def test_file_evidence_passes_an_env_criterion_without_credentials():
    files = {".github/workflows/review.yml": "uses: anthropics/claude-code-action@v1"}
    assert kind(verdict("automated_pr_review", snap(files))) == "Pass"


def test_fast_ci_feedback_fails_when_there_is_no_ci_at_all():
    assert kind(verdict("fast_ci_feedback", snap({"README.md": "x"}))) == "Fail"


# --- git history --------------------------------------------------------------------


def test_agent_coauthor_trailer_shows_agentic_development():
    commits = [
        "Ada <ada@users.noreply.github.com>",
        "Co-authored-by: Claude <noreply@anthropic.com>",
    ]
    assert kind(verdict("agentic_development", snap({}, commits=commits))) == "Pass"


def test_dependency_bots_are_not_agents():
    commits = ["dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>"]
    assert kind(verdict("agentic_development", snap({}, commits=commits))) == "Fail"


# --- applicability ----------------------------------------------------------------


def test_single_package_repo_skips_monorepo_tooling():
    got = verdict("monorepo_tooling", snap({"package.json": "{}"}))
    assert kind(got) == "Skip"
    assert got.cause == "not_applicable"


def test_workspace_config_passes_monorepo_tooling():
    files = {"package.json": "{}", "a/package.json": "{}", "pnpm-workspace.yaml": "packages: ['a']"}
    assert kind(verdict("monorepo_tooling", snap(files))) == "Pass"


def test_database_schema_skips_without_a_database_library():
    got = verdict("database_schema", snap({"package.json": '{"dependencies": {"zod": "3"}}'}))
    assert kind(got) == "Skip"


def test_database_library_without_schema_fails():
    files = {"package.json": '{"dependencies": {"pg": "8"}}'}
    assert kind(verdict("database_schema", snap(files))) == "Fail"


def test_prisma_schema_passes():
    files = {
        "package.json": '{"dependencies": {"@prisma/client": "5"}}',
        "prisma/schema.prisma": "",
    }
    assert kind(verdict("database_schema", snap(files))) == "Pass"


def test_api_schema_skips_for_non_http_projects():
    got = verdict("api_schema_docs", snap({"package.json": '{"bin": {"x": "cli.js"}}'}))
    assert kind(got) == "Skip"


# --- hygiene ------------------------------------------------------------------------


def test_gitignore_must_cover_env_and_stack_artefacts():
    ok = {"package.json": "{}", ".gitignore": ".env\nnode_modules/\ndist/\n"}
    missing = {"package.json": "{}", ".gitignore": ".env\n"}
    assert kind(verdict("gitignore_comprehensive", snap(ok))) == "Pass"
    got = verdict("gitignore_comprehensive", snap(missing))
    assert kind(got) == "Fail"
    assert "node_modules" in got.reason


def test_tracked_env_file_fails_secrets_management():
    files = {".env": "API_KEY=abc", ".github/workflows/ci.yml": "${{ secrets.TOKEN }}"}
    assert kind(verdict("secrets_management", snap(files))) == "Fail"


def test_strict_tsconfig_passes_strict_typing():
    files = {"tsconfig.json": '{"compilerOptions": {"strict": true}}'}
    assert kind(verdict("strict_typing", snap(files))) == "Pass"


def test_lax_tsconfig_fails_strict_typing():
    files = {"tsconfig.json": '{"compilerOptions": {"strict": false}}'}
    assert kind(verdict("strict_typing", snap(files))) == "Fail"


def test_linter_config_passes_lint_config():
    assert kind(verdict("lint_config", snap({"eslint.config.js": ""}))) == "Pass"
    assert kind(verdict("lint_config", snap({"pyproject.toml": "[tool.ruff]\n"}))) == "Pass"


def test_no_linter_fails_lint_config():
    assert kind(verdict("lint_config", snap({"package.json": "{}"}))) == "Fail"


# --- evaluate ---------------------------------------------------------------------------


def test_evaluate_returns_one_result_per_criterion_in_registry_order():
    results = probe.evaluate(snap({"README.md": LONG}))
    assert [r.id for r in results] == [c.id for c in probe.REGISTRY]


def test_judged_verdicts_replace_pending_results():
    results = probe.evaluate(snap({"README.md": "A small library."}))
    judged = probe.apply_judgements(
        results, {"build_cmd_doc": {"status": "pass", "detail": "no build step; README says so"}}
    )
    got = next(r for r in judged if r.id == "build_cmd_doc")
    assert (got.status, got.numerator, got.denominator) == ("pass", 1, 1)


def test_judged_fraction_is_kept_for_multi_app_repos():
    results = probe.evaluate(snap({}))
    judged = probe.apply_judgements(
        results, {"lint_config": {"status": "fail", "numerator": 2, "denominator": 3}}
    )
    got = next(r for r in judged if r.id == "lint_config")
    assert (got.numerator, got.denominator) == (2, 3)


def test_judgement_for_unknown_id_is_rejected():
    with pytest.raises(ValueError, match="nope"):
        probe.apply_judgements(probe.evaluate(snap({})), {"nope": {"status": "pass"}})


def test_snapshot_today_is_the_injected_clock():
    assert snap({}).today == TODAY


# --- regressions found probing real repos ---------------------------------------


@pytest.mark.parametrize(
    "path",
    ["tests/tmux.integration.test.ts", "tests/api.int.test.ts", "pkg/db_integration_test.go"],
)
def test_integration_naming_patterns_pass(path):
    assert kind(verdict("integration_tests_exist", snap([path]))) == "Pass"


def test_separate_test_dir_needs_judgement_not_a_fail():
    got = verdict("integration_tests_exist", snap(["tests/cli.test.ts", "src/a.ts"]))
    assert kind(got) == "NeedsJudgement"
    assert "tests/cli.test.ts" in got.candidates


def test_fixture_skill_files_are_not_offered_as_docs_to_read():
    files = {"tests/fixtures/repo/alpha/SKILL.md": SKILL, "README.md": LONG}
    got = verdict("interactive_qa_exists", snap(files))
    assert got.candidates == ("README.md",)


@pytest.mark.parametrize(
    "prefix",
    [
        "skills/x/evals/fixtures/app/",
        "tests/fixtures/",
        "vendor/lib/",
        "pkg/testdata/",
        "third_party/x/",
    ],
)
def test_fixture_and_vendored_manifests_are_not_the_project(prefix):
    files = {f"{prefix}package.json": '{"dependencies": {"pg": "8"}}'}
    assert kind(verdict("database_schema", snap(files))) == "Skip"


def test_agent_permission_lists_are_not_evidence_of_what_runs():
    files = {
        ".claude/settings.json": '{"permissions": {"allow": ["Bash(npm publish:*)", "Bash(gitleaks:*)"]}}'
    }
    assert kind(verdict("release_automation", snap(files))) == "Fail"
    assert kind(verdict("secret_scanning", snap(files))) == "Skip"


def test_a_declared_tool_version_is_not_evidence_the_tool_runs():
    files = {"mise.toml": '[tools]\ngitleaks = "8"\n"npm:knip" = "5"'}
    assert kind(verdict("secret_scanning", snap(files))) == "Skip"
    assert kind(verdict("unused_dependencies_detection", snap(files))) == "Fail"


def test_a_hook_that_runs_the_tool_is_evidence():
    files = {"hk.pkl": '["gitleaks"] { check = "gitleaks protect --staged" }'}
    assert kind(verdict("secret_scanning", snap(files))) == "Pass"


def test_mise_release_age_setting_still_counts_as_an_age_gate():
    files = {"mise.toml": '[settings]\nminimum_release_age = "4d"'}
    assert kind(verdict("min_release_age", snap(files))) == "Pass"


def test_tool_names_match_whole_words_only():
    sources = {f"src/m{i}.py": "" for i in range(60)}
    files = {**sources, "pyproject.toml": '[project]\ndescription = "attach to sessions"'}
    assert kind(verdict("code_modularization", snap(files))) == "Fail"
    naming = {"tools/check.py": 'KEY = "N"\n'}
    assert kind(verdict("naming_consistency", snap(naming))) == "Fail"


def test_supply_chain_quarantine_is_not_flaky_test_quarantine():
    files = {"pnpm-workspace.yaml": "# 4-day quarantine\nminimumReleaseAge: 5760"}
    assert kind(verdict("flaky_test_detection", snap(files))) == "Skip"


def test_skill_bodies_are_not_project_docs():
    files = {
        "skills/ux/SKILL.md": SKILL + "\nHandle PII and GDPR carefully. Canary deploys.",
        "README.md": LONG,
    }
    assert kind(verdict("pii_handling", snap(files))) == "NeedsJudgement"


def test_secret_scanner_redaction_is_not_log_scrubbing():
    files = {"hk.pkl": 'check = "gitleaks git --staged --redact"'}
    assert kind(verdict("log_scrubbing", snap(files))) == "Fail"


def test_logger_without_visible_redaction_needs_judgement():
    files = {"package.json": '{"dependencies": {"pino": "9"}}', "src/logger.ts": ""}
    got = verdict("log_scrubbing", snap(files))
    assert kind(got) == "NeedsJudgement"
    assert "src/logger.ts" in got.candidates


def test_a_word_in_a_repo_name_is_not_a_dashboard():
    files = {"docs/adr/0005.md": "Repos: `fittr-dashboard-app`, `other`."}
    assert kind(verdict("deployment_observability", snap(files))) == "Fail"


def test_a_casing_word_in_passing_is_not_a_naming_convention():
    files = {"AGENTS.md": "pnpm reads config from YAML (camelCase keys)."}
    assert kind(verdict("naming_consistency", snap(files))) == "Fail"
    files = {"AGENTS.md": "## Naming conventions\n\nUse snake_case for functions."}
    assert kind(verdict("naming_consistency", snap(files))) == "Pass"


def test_scrollback_is_not_rollback():
    files = {"Dockerfile": "# tmux config (mouse + scrollback)\nFROM alpine"}
    assert kind(verdict("rollback_automation", snap(files))) == "Fail"


def test_an_http_client_dependency_is_not_an_integration_test():
    files = {"requirements.txt": "fastapi\nhttpx\n", "tests/test_orders.py": ""}
    assert kind(verdict("integration_tests_exist", snap(files))) != "Pass"


def test_diff_separates_new_judgements_from_real_transitions():
    results = probe.evaluate(snap({"README.md": LONG}))
    previous = {"results": [
        {"id": "readme", "status": "fail"},
        {"id": "single_command_setup", "status": "judge"},
    ]}  # fmt: skip
    judged = probe.apply_judgements(results, {"single_command_setup": {"status": "pass"}})
    changed, judged_only = probe.diff(previous, judged)
    assert ("readme", "fail", "pass") in changed
    assert ("single_command_setup", "judge", "pass") in judged_only
    assert all("judge" not in (old, new) for _, old, new in changed)
