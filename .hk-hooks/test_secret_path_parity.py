# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Tests for the secret-path-parity pre-commit guard."""

import importlib.util
import subprocess
import sys
from pathlib import Path

# Import the module under test (filename has hyphens).
_spec = importlib.util.spec_from_file_location(
    "secret_path_parity", Path(__file__).parent / "secret-path-parity.py"
)
assert _spec and _spec.loader
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)


class TestRequiredRules:
    def test_directory_needs_bare_and_glob(self) -> None:
        assert _mod.required_rules("~/.ssh", "Read") == ["Read(~/.ssh)", "Read(~/.ssh/**)"]

    def test_file_needs_bare_only(self) -> None:
        assert _mod.required_rules("~/.netrc", "Read") == ["Read(~/.netrc)"]
        assert _mod.required_rules("~/.zshenv", "Edit") == ["Edit(~/.zshenv)"]


class TestClaudeDeny:
    def test_full_coverage_passes(self) -> None:
        settings = {
            "permissions": {
                "deny": [
                    "Read(~/.ssh)",
                    "Read(~/.ssh/**)",
                    "Edit(~/.ssh)",
                    "Edit(~/.ssh/**)",
                    "Edit(~/.zshenv)",
                ]
            }
        }
        assert _mod.check_claude_deny(settings, ["~/.ssh"], ["~/.ssh", "~/.zshenv"]) == []

    def test_missing_glob_form_fails(self) -> None:
        settings = {"permissions": {"deny": ["Read(~/.ssh)"]}}
        errors = _mod.check_claude_deny(settings, ["~/.ssh"], [])
        assert any("Read(~/.ssh/**)" in e for e in errors)


class TestTsExtraction:
    def test_extracts_static_array(self) -> None:
        src = 'export const SECRET_PATHS = [\n  ".ssh",\n  ".aws",\n] as const;\n'
        assert _mod.ts_secret_paths(src) == {".ssh", ".aws"}

    def test_missing_array_extracts_nothing(self) -> None:
        assert _mod.ts_secret_paths("export const OTHER = 1;") == set()


class TestCovers:
    def test_superset_passes(self) -> None:
        assert _mod.check_covers("x", {".ssh", ".aws", ".extra"}, {".ssh", ".aws"}) == []

    def test_missing_path_reported(self) -> None:
        errors = _mod.check_covers("x", {".ssh"}, {".ssh", ".aws"})
        assert errors == ["x is missing srt denyRead path '.aws'"]


class TestLiveTree:
    """The real dotfiles must pass - the same invocation hk runs."""

    CHECKER = str(Path(__file__).parent / "secret-path-parity.py")

    def test_current_tree_passes(self) -> None:
        r = subprocess.run(
            [sys.executable, self.CHECKER],
            capture_output=True,
            text=True,
            cwd=Path.home(),
        )
        assert r.returncode == 0, r.stderr
