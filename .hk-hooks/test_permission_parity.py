# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Tests for the permission-parity pre-commit guard."""

import importlib.util
from pathlib import Path

import pytest

# Import the module under test (filename has a hyphen).
_spec = importlib.util.spec_from_file_location(
    "permission_parity", Path(__file__).parent / "permission-parity.py"
)
assert _spec and _spec.loader
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)


# --- syntax normalisation ---


class TestNormaliseClaude:
    @pytest.mark.parametrize(
        ("entry", "expected"),
        [
            ("Bash(eval:*)", "eval"),
            ("Bash(rm -rf:*)", "rm -rf"),
            ("Bash(rm -rf /)", "rm -rf /"),
            ("Bash(git add .:*)", "git add ."),
            ("Bash(git push --force-with-lease:*)", "git push --force-with-lease"),
            ("Bash(git --git-dir=*)", "git --git-dir=*"),
        ],
    )
    def test_strips_wrapper_and_arg_suffix(self, entry: str, expected: str) -> None:
        assert _mod.normalise_claude(entry) == expected

    @pytest.mark.parametrize("entry", ["WebFetch", "Read(//tmp/**)", "Edit(/tmp/**)"])
    def test_non_bash_returns_none(self, entry: str) -> None:
        assert _mod.normalise_claude(entry) is None


class TestNormaliseOpencode:
    @pytest.mark.parametrize(
        ("pattern", "expected"),
        [
            ("eval*", "eval"),
            ("rm -rf*", "rm -rf"),
            ("rm -rf /", "rm -rf /"),
            ("git add .", "git add ."),
        ],
    )
    def test_strips_trailing_glob(self, pattern: str, expected: str) -> None:
        assert _mod.normalise_opencode(pattern) == expected


# --- extraction ---


def _claude(deny=None, allow=None, hooks=None) -> dict:
    return {
        "permissions": {"deny": deny or [], "allow": allow or []},
        "hooks": hooks or {},
    }


def _opencode(bash: dict) -> dict:
    return {"permission": {"bash": bash}}


class TestExtraction:
    def test_claude_deny_bases(self) -> None:
        settings = _claude(deny=["Bash(eval:*)", "Bash(rm -rf /)", "WebFetch"])
        assert _mod.claude_deny_bases(settings) == {"eval", "rm -rf /"}

    def test_opencode_deny_bases_only_deny_values(self) -> None:
        config = _opencode({"eval*": "deny", "aws lambda invoke*": "ask", "ls*": "allow"})
        assert _mod.opencode_deny_bases(config) == {"eval"}


# --- canonical deny coverage ---


class TestCanonicalDenies:
    def _all_bases(self) -> set[str]:
        return {cmd for cmd, _ in _mod.CANONICAL_DANGEROUS}

    def test_passes_when_both_cover_everything(self) -> None:
        bases = self._all_bases()
        assert _mod.check_canonical_denies(bases, bases) == []

    def test_flags_claude_gap(self) -> None:
        bases = self._all_bases()
        claude = bases - {"git push -f"}
        errors = _mod.check_canonical_denies(claude, bases)
        assert any("Claude does not deny 'git push -f'" in e for e in errors)

    def test_flags_opencode_gap(self) -> None:
        bases = self._all_bases()
        opencode = bases - {"rm -rf"}
        errors = _mod.check_canonical_denies(bases, opencode)
        assert any("OpenCode does not deny 'rm -rf'" in e for e in errors)


# --- allow must not collide with an OpenCode deny ---


class TestAllowNotDenied:
    DENY_GLOBS = ["rm -rf*", "git push --force*", "eval*", "git add -A*", "git add ."]

    def test_passes_for_safe_allows(self) -> None:
        # A broad "git add" allow is fine: it does not match "git add -A*".
        allow = {"git add", "git status", "ls", "git rm --cached"}
        assert _mod.check_allow_not_denied(allow, self.DENY_GLOBS) == []

    def test_flags_dangerous_allow(self) -> None:
        allow = {"git push --force", "ls"}
        errors = _mod.check_allow_not_denied(allow, self.DENY_GLOBS)
        assert len(errors) == 1
        assert "git push --force" in errors[0]
        assert "git push --force*" in errors[0]

    def test_flags_specific_rm_allow(self) -> None:
        allow = {"rm -rf /tmp/scratch"}
        errors = _mod.check_allow_not_denied(allow, self.DENY_GLOBS)
        assert any("rm -rf*" in e for e in errors)


# --- gh api mutation gate ---


class TestGhApiGate:
    WIRED = {
        "hooks": {
            "PreToolUse": [
                {"matcher": "Skill", "hooks": [{"command": "x allow-global-skills.py"}]},
                {
                    "matcher": "Bash",
                    "hooks": [
                        {"command": "python3 ~/.claude/hooks/no-self-attribution.py"},
                        {"command": "python3 ~/.claude/hooks/guard-mutating-api.py"},
                    ],
                },
            ]
        }
    }

    def test_passes_when_wired_and_present(self) -> None:
        assert _mod.check_gh_api_gate(self.WIRED, hook_exists=True) == []

    def test_flags_missing_hook_file(self) -> None:
        errors = _mod.check_gh_api_gate(self.WIRED, hook_exists=False)
        assert any("missing" in e for e in errors)

    def test_flags_unwired_hook(self) -> None:
        settings = {"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": []}]}}
        errors = _mod.check_gh_api_gate(settings, hook_exists=True)
        assert any("not wired" in e for e in errors)

    def test_flags_wrong_matcher(self) -> None:
        settings = {
            "hooks": {
                "PreToolUse": [
                    {"matcher": "Skill", "hooks": [{"command": "guard-mutating-api.py"}]}
                ]
            }
        }
        errors = _mod.check_gh_api_gate(settings, hook_exists=True)
        assert any("not wired" in e for e in errors)
