# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Tests for the _secretpaths shared core."""

from pathlib import Path

import pytest

from _secretpaths import SECRET_PATHS, secret_access_reason

HOME = str(Path.home())


class TestMatches:
    @pytest.mark.parametrize(
        "command",
        [
            "cat ~/.ssh/id_rsa",
            "xxd ~/.aws/credentials",
            "base64 ~/.config/gh-gate/app.pem",
            "cd ~/.ssh",
            "ls ~/.ssh",
            "cat .ssh/id_rsa",
            "cat $HOME/.ssh/id_rsa",
            "cat ${HOME}/.ssh/id_rsa",
            f"cat {HOME}/.ssh/id_rsa",
            "head ~/.netrc",
            "cat ~/.docker/config.json",
            "cat ~/.zshrc.local",
            "ls ~/Library/Keychains",
            "cp ~/.kube/config /tmp/x",
            # deliberately denied: legitimate-looking key use still reads the key
            "ssh -i ~/.ssh/key.pem host",
            # glued value forms
            "restic --password-file=~/.aws/credentials snapshots",
            "KEYFILE=~/.ssh/id_rsa ./run.sh",
            # later segment of a compound command
            "echo hi && cat ~/.gnupg/secring.gpg",
            # falsey bypass marker does not opt out
            "SECRETS_OK=0 cat ~/.ssh/id_rsa",
            "SECRETS_OK= cat ~/.ssh/id_rsa",
        ],
    )
    def test_flagged(self, command: str) -> None:
        assert secret_access_reason(command) is not None

    def test_reason_names_the_path(self) -> None:
        reason = secret_access_reason("cat ~/.ssh/id_rsa")
        assert reason is not None
        assert "~/.ssh" in reason


class TestNonMatches:
    @pytest.mark.parametrize(
        "command",
        [
            # ssh the command, not the directory
            "ssh host uptime",
            "ssh -p 2222 connor@rpi5",
            # prefix must be component-aware
            "cat ~/.ssherfoo",
            "cat ~/.aws-backup/notes",
            "ls ~/.config/ghost",
            # commit messages mentioning paths
            'git commit -m "stop reading ~/.ssh in CI"',
            'dotfiles commit -m "document ~/.aws quarantine"',
            # absolute paths outside home
            "cat /etc/ssh/sshd_config",
            "cat /tmp/.ssh/fake",
            # unrelated commands
            "ls -la",
            "git status",
            "cat README.md",
            # SECRETS_OK escape hatch
            "SECRETS_OK=1 cat ~/.ssh/known_hosts",
            "SECRETS_OK=true xxd ~/.aws/credentials",
        ],
    )
    def test_not_flagged(self, command: str) -> None:
        assert secret_access_reason(command) is None

    def test_bypass_scoped_to_segment(self) -> None:
        # The opt-out covers its own segment only.
        cmd = "SECRETS_OK=1 cat ~/.ssh/a && cat ~/.ssh/b"
        assert secret_access_reason(cmd) is not None


class TestFallback:
    # An unclosed quote defeats shlex; the regex fallback must still catch
    # explicitly home-anchored secret paths.
    def test_unparseable_home_anchored_flagged(self) -> None:
        assert secret_access_reason("cat ~/.ssh/id_rsa 'unclosed") is not None

    def test_unparseable_unrelated_not_flagged(self) -> None:
        assert secret_access_reason("echo 'unclosed oops") is None

    def test_unparseable_bypass_honoured(self) -> None:
        assert secret_access_reason("SECRETS_OK=1 cat ~/.ssh/x 'unclosed") is None


class TestParity:
    def test_covers_srt_deny_read(self) -> None:
        # Local twin of the secret-path-parity hk check so the hook suite
        # fails fast when srt gains a path this module lacks.
        import json

        srt = json.loads(
            (Path.home() / ".config" / "srt" / "base.json").read_text()
        )
        srt_paths = {p.removeprefix("~/") for p in srt["filesystem"]["denyRead"]}
        assert srt_paths <= set(SECRET_PATHS)
