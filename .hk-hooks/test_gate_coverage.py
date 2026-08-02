# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Tests for the gate-coverage pre-commit guard."""

import importlib.util
import subprocess
import sys
from pathlib import Path

# Import the module under test (filename has a hyphen). Register in sys.modules
# so its slots=True dataclasses resolve their own module during class creation.
_spec = importlib.util.spec_from_file_location(
    "gate_coverage", Path(__file__).parent / "gate-coverage.py"
)
assert _spec and _spec.loader
_mod = importlib.util.module_from_spec(_spec)
sys.modules["gate_coverage"] = _mod
_spec.loader.exec_module(_mod)


HK_SAMPLE = """\
local fast_steps = new Mapping<String, Step> {
    ["ts-tests-scoped"] {
        glob = List(".config/skl/**", "src/pin-audit/**")
        check = "bash .hk-hooks/ts-tests.sh {{files}}"
    }
    ["ts-typecheck-skl"] {
        glob = List(
            ".config/skl/src/**/*.ts",
            ".config/skl/tsconfig.json"
        )
        check = "bash .hk-hooks/ts-typecheck.sh .config/skl"
    }
}
"""


class TestParseHkSteps:
    def test_single_line_glob_and_check(self) -> None:
        steps = _mod.parse_hk_steps(HK_SAMPLE)
        step = steps["ts-tests-scoped"]
        assert step.globs == (".config/skl/**", "src/pin-audit/**")
        assert step.glob_line == 3
        assert step.check == "bash .hk-hooks/ts-tests.sh {{files}}"
        assert step.check_line == 4

    def test_multiline_glob_list(self) -> None:
        step = _mod.parse_hk_steps(HK_SAMPLE)["ts-typecheck-skl"]
        assert step.globs == (".config/skl/src/**/*.ts", ".config/skl/tsconfig.json")
        assert step.check_line == 11


class TestLiteralPrefix:
    def test_strips_wildcard_tail(self) -> None:
        assert _mod.literal_prefix(".config/skl/**") == ".config/skl"
        assert _mod.literal_prefix(".config/skl/src/**/*.ts") == ".config/skl/src"

    def test_plain_path_is_its_own_prefix(self) -> None:
        assert _mod.literal_prefix(".config/skl/bin/pick") == ".config/skl/bin/pick"

    def test_leading_wildcard_is_anchored_nowhere(self) -> None:
        assert _mod.literal_prefix("**/*.ts") == ""
        assert _mod.literal_prefix("**/vendor/.agents/skills/**") == ""


class TestOverlaps:
    def test_prefix_either_direction(self) -> None:
        assert _mod.overlaps(".config/skl", ".config/skl/src")
        assert _mod.overlaps(".config/skl/src", ".config/skl")
        assert _mod.overlaps("src/skl", "src/skl")

    def test_sibling_and_partial_name_do_not_overlap(self) -> None:
        assert not _mod.overlaps("src/skl", "src/pin-audit")
        assert not _mod.overlaps("src/skl", "src/skl-old")
        assert not _mod.overlaps("", ".config/skl")


class TestExtractors:
    def test_shell_roots(self) -> None:
        text = '#!/usr/bin/env bash\nROOTS=".config/skl src/pin-audit"\necho hi\n'
        assert _mod.shell_roots(text) == [".config/skl", "src/pin-audit"]

    def test_python_roots(self) -> None:
        text = (
            'ROOTS: tuple[str, ...] = (\n    ".config/skl/bin",\n    ".config/zsh/functions",\n)\n'
        )
        assert _mod.python_roots(text) == [".config/skl/bin", ".config/zsh/functions"]

    def test_case_arm_roots_substitutes_tests_dir(self) -> None:
        text = (
            "TESTS_DIR=.config/zsh/tests\n"
            "case $f in\n"
            '"$TESTS_DIR"/*.bats)\n'
            "\techo self\n"
            "\t;;\n"
            ".config/zsh/functions/* | .config/tmux/scripts/*)\n"
            "\tstem=$(basename $f)\n"
            "\t;;\n"
            "src/pin-audit/*)\n"
            "\t;;\n"
            "esac\n"
        )
        assert _mod.case_arm_roots(text) == [
            ".config/zsh/tests",
            ".config/zsh/functions",
            ".config/tmux/scripts",
            "src/pin-audit",
        ]

    def test_case_arm_roots_ignores_command_substitution_line(self) -> None:
        # `stem=$(basename $f)` also ends in `)`; it is a body, not an arm.
        text = "TESTS_DIR=t\ncase $f in\nfoo/*)\n\tstem=$(basename $f)\n\t;;\nesac\n"
        assert _mod.case_arm_roots(text) == ["foo"]


class TestCheckPairs:
    def _sources(self, ts_roots: str) -> dict[str, str]:
        return {
            ".hk-hooks/ts-tests.sh": f'ROOTS="{ts_roots}"\n',
            ".hk-hooks/bats-tests.sh": "TESTS_DIR=t\ncase $f in\nt/*.bats)\n\t;;\nesac\n",
            ".hk-hooks/fzf-bind-lint.py": 'ROOTS: tuple[str, ...] = (\n    "f/bin",\n)\n',
        }

    def _steps(self) -> dict[str, _mod.Step]:
        return _mod.parse_hk_steps(
            'x {\n    ["ts-tests-scoped"] {\n'
            '        glob = List(".config/skl/**", "src/pin-audit/**")\n'
            '        check = "a"\n    }\n'
            '    ["bats-scoped"] {\n        glob = List("t/**")\n        check = "b"\n    }\n'
            '    ["fzf-bind-lint"] {\n'
            '        glob = List("f/bin/pick", ".hk-hooks/fzf-bind-lint.py")\n'
            '        check = "c"\n    }\n}\n'
        )

    def test_agreeing_lists_pass(self) -> None:
        assert _mod.check_pairs(self._steps(), self._sources(".config/skl src/pin-audit")) == []

    def test_script_root_the_glob_misses_fails(self) -> None:
        errors = _mod.check_pairs(self._steps(), self._sources(".config/skl src/pin-audit src/new"))
        assert len(errors) == 1
        assert "'src/new' is not reachable" in errors[0]

    def test_glob_root_the_script_misses_fails(self) -> None:
        errors = _mod.check_pairs(self._steps(), self._sources(".config/skl"))
        assert len(errors) == 1
        assert "globs 'src/pin-audit'" in errors[0]

    def test_self_trigger_glob_is_not_a_root(self) -> None:
        # fzf-bind-lint globs its own source so editing it re-triggers the step;
        # that entry must not be demanded of the script's ROOTS.
        errors = _mod.check_pairs(self._steps(), self._sources(".config/skl src/pin-audit"))
        assert not any("fzf-bind-lint.py" in e for e in errors)

    def test_missing_step_is_reported(self) -> None:
        steps = _mod.parse_hk_steps("x {\n}\n")
        errors = _mod.check_pairs(steps, self._sources(".config/skl"))
        assert len(errors) == 3
        assert all("not found" in e for e in errors)


class TestPathLiterals:
    def test_check_command_paths_are_collected(self) -> None:
        steps = _mod.parse_hk_steps(HK_SAMPLE)
        literals = _mod.hk_path_literals(steps)
        paths = {rel for _, _, rel in literals}
        assert ".hk-hooks/ts-typecheck.sh" in paths  # embedded in the command
        assert ".config/skl" in paths  # the command's project argument
        assert ".config/skl/src" in paths  # a glob prefix

    def test_leading_wildcard_glob_contributes_nothing(self) -> None:
        steps = _mod.parse_hk_steps(
            'x {\n    ["oxlint"] {\n        glob = List("**/*.ts")\n        check = "oxlint"\n    }\n}\n'
        )
        assert _mod.hk_path_literals(steps) == []

    def test_mise_cd_targets_and_for_lists(self) -> None:
        text = (
            'run = "cd .config/skl && bun install"\n'
            "for d in .pi/agent/extensions/goal .pi/agent/extensions/workflows; do\n"
            "bash .hk-hooks/ts-tests.sh --all\n"
        )
        paths = [rel for _, _, rel in _mod.mise_path_literals(text)]
        assert paths == [
            ".config/skl",
            ".pi/agent/extensions/goal",
            ".pi/agent/extensions/workflows",
            ".hk-hooks/ts-tests.sh",
        ]

    def test_mise_shell_noise_is_not_a_path(self) -> None:
        text = 'run = "cd \\"$HOME\\" && bats"\nfor i in $(seq 1 "$runs"); do\n'
        assert _mod.mise_path_literals(text) == []

    def test_missing_path_is_reported_with_its_line(self) -> None:
        errors = _mod.check_paths_exist(
            [("hk.pkl (ts-typecheck-skl glob)", 354, "src/skl/src")],
            resolve=lambda rel: Path("/nonexistent") / rel,
        )
        assert errors == [
            "hk.pkl (ts-typecheck-skl glob): line 354 keys on 'src/skl/src', which does not exist"
        ]


class TestDiscoverProjects:
    def test_manifest_resolves_to_its_root_and_language(self) -> None:
        assert _mod.discover_projects(
            ["src/pin-audit/package.json", "src/pin-audit/tsconfig.json", ".hk-hooks/pyrefly.toml"]
        ) == {"src/pin-audit": "ts", ".hk-hooks": "py"}

    def test_vendored_and_fixture_trees_are_excluded(self) -> None:
        assert (
            _mod.discover_projects(
                [
                    ".config/skills/vendor/.agents/skills/deepsec/package.json",
                    ".config/skills/vendor/expo/.agents/skills/eas/scripts/package.json",
                    "skills/web-perf/evals/fixtures/astro-font-swap/package.json",
                    "src/pin-audit/node_modules/dep/package.json",
                ]
            )
            == {}
        )


class TestCheckProjects:
    STEPS = _mod.parse_hk_steps(
        'x {\n    ["ts-tests-scoped"] {\n        glob = List("src/pin-audit/**")\n'
        '        check = "a"\n    }\n'
        '    ["ts-typecheck-pin-audit"] {\n        glob = List("src/pin-audit/src/**/*.ts")\n'
        '        check = "b"\n    }\n'
        '    ["py-typecheck-hk-hooks"] {\n        glob = List(".hk-hooks/*.py")\n'
        '        check = "c"\n    }\n}\n'
    )

    def test_fully_wired_project_passes(self) -> None:
        projects = {"src/pin-audit": "ts", ".hk-hooks": "py"}
        assert _mod.check_projects(projects, self.STEPS, ungated={}) == []

    def test_new_ts_project_fails_both_gates(self) -> None:
        errors = _mod.check_projects({"src/new": "ts"}, self.STEPS, ungated={})
        assert len(errors) == 2
        assert "ts-tests-scoped glob" in errors[0]
        assert "no ts-typecheck-* step" in errors[1]

    def test_new_py_project_fails(self) -> None:
        errors = _mod.check_projects({"src/newpy": "py"}, self.STEPS, ungated={})
        assert len(errors) == 1
        assert "no py-typecheck-* step" in errors[0]

    def test_ungated_root_is_exempt(self) -> None:
        exempt = {"src/new": "reason"}
        assert _mod.check_projects({"src/new": "ts"}, self.STEPS, ungated=exempt) == []

    def test_stale_ungated_entry_is_reported(self) -> None:
        exempt = {"src/gone": "reason"}
        errors = _mod.check_projects({"src/pin-audit": "ts"}, self.STEPS, ungated=exempt)
        assert len(errors) == 1
        assert "no longer a discovered project" in errors[0]


class TestLive:
    def test_real_tree_passes(self) -> None:
        """The gate against the real work-tree - the contract the hk step runs."""
        result = subprocess.run(
            [sys.executable, str(Path(__file__).parent / "gate-coverage.py")],
            cwd=Path.home(),
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr

    def test_every_ungated_entry_is_still_a_real_project(self) -> None:
        for root in _mod.UNGATED:
            assert (Path.home() / root).is_dir(), root
