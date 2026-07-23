"""Shared secret-path detection for agent Bash guards.

One conceptual policy, many enforcement surfaces: this module is the Python
core used by the Claude hook (guard-secret-paths.py, JSON-deny contract) and
the Codex hook (guard-secret-paths-codex.py, exit-2 contract). The pi guard
(~/.pi/agent/extensions/agent-guard/guard.ts) carries a TypeScript twin of
SECRET_PATHS. The `secret-path-parity` hk step keeps every copy in lock-step
with the srt sandbox policy (~/.config/srt/base.json `denyRead`), which is why
the list is embedded here rather than read at runtime: static deny rules can't
read files anyway, and embedded constants keep the guard pure and fail-closed.

Matching is textual and deliberately conservative in what it exempts: any
token (or `=`-glued value) that resolves - via `~`, `$HOME`, an absolute home
path, or a bare relative path - to a component-wise prefix of a secret path is
flagged. `ssh -i ~/.ssh/key.pem` is denied by design; `~/.ssherfoo` is not.
Obfuscated access (`python -c 'open(...)'`, constructed paths, `..` hops)
evades a textual guard - the srt/native OS sandbox remains the backstop
(two-layer model, see ~/.config/srt/AGENTS.md).

Escape hatch: prefix the command with `SECRETS_OK=1` (precedent: NPM_OK=1 in
prefer-pnpm) for a deliberate, model-usable opt-out.

Tests: uv run --with pytest pytest ~/.claude/hooks/test_secretpaths.py -v
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import _shellparse

# Home-relative secret paths - mirror of srt denyRead in ~/.config/srt/base.json.
# The secret-path-parity hk step asserts this covers that list exactly.
SECRET_PATHS = (
    ".ssh",
    ".config/gh-gate",
    ".config/gh",
    ".aws",
    ".config/gcloud",
    ".netrc",
    ".config/fnox",
    ".fnox",
    "Library/Keychains",
    ".zshrc.local",
    ".docker/config.json",
    ".gnupg",
    ".cloudflared",
    ".gemini",
    ".config/op",
    ".kube",
    ".password-store",
)

# Env marker for a deliberate opt-out (no human confirmation needed).
BYPASS_VAR = "SECRETS_OK"
_BYPASS_FALSEY = frozenset({"", "0", "false", "False", "no"})

_SECRET_COMPONENTS = tuple(p.split("/") for p in SECRET_PATHS)

# Conservative fallback when the command can't be tokenised: only explicitly
# home-anchored forms, so a parse failure never silently misses the obvious.
_FALLBACK_RE = re.compile(
    r"(?:~|\$HOME|\$\{HOME\})/("
    + "|".join(re.escape(p) for p in SECRET_PATHS)
    + r")(?:/|$|[\s'\";|&)])"
)
_FALLBACK_BYPASS_RE = re.compile(rf"\b{BYPASS_VAR}=(\S*)")


def _home_relative_components(candidate: str) -> list[str] | None:
    """Normalise a path-like string to home-relative components.

    Returns None when the string is anchored outside home (absolute paths not
    under $HOME can never be a secret path - the list is home-relative).
    Bare relative paths are treated as home-relative: agents here commonly run
    from $HOME, and `cat .ssh/id_rsa` must match.
    """
    if candidate.startswith("~/"):
        rel = candidate[2:]
    elif candidate == "~":
        rel = ""
    elif candidate.startswith("$HOME/") or candidate == "$HOME":
        rel = candidate[6:].lstrip("/")
    elif candidate.startswith("${HOME}/") or candidate == "${HOME}":
        rel = candidate[8:].lstrip("/")
    elif candidate.startswith("~"):
        # ~user or a non-path word like ~foo - not home-anchored for us.
        return None
    elif candidate.startswith("/"):
        home = str(Path.home())
        if candidate == home:
            rel = ""
        elif candidate.startswith(home + "/"):
            rel = candidate[len(home) + 1 :]
        else:
            return None
    else:
        rel = candidate
    return [c for c in rel.split("/") if c not in ("", ".")]


def _matched_secret(candidate: str) -> str | None:
    """Secret path the candidate falls under (component-wise), or None."""
    components = _home_relative_components(candidate)
    if not components:
        return None
    for secret, secret_components in zip(SECRET_PATHS, _SECRET_COMPONENTS, strict=True):
        if components[: len(secret_components)] == secret_components:
            return secret
    return None


def _segment_secret(segment: list[str]) -> str | None:
    """First secret path any token in the segment touches, or None."""
    for tok in segment:
        # Check the whole token and any =-glued pieces (--flag=~/.ssh/x,
        # VAR=~/.ssh/x), so glued forms don't slip past.
        for piece in (tok, *tok.split("=")[1:]):
            secret = _matched_secret(piece)
            if secret:
                return secret
    return None


def secret_access_reason(command: str) -> str | None:
    """Return why a command touches a protected secret path, or None.

    Commit commands are skipped so a message *mentioning* a path never trips
    the guard. A segment carrying a non-falsey SECRETS_OK= prefix is exempt.
    """
    if _shellparse.NOT_COMMIT_RE.search(command):
        return None

    tokens = _shellparse.tokenise(command)
    if tokens is None:
        bypass = _FALLBACK_BYPASS_RE.search(command)
        if bypass and bypass.group(1) not in _BYPASS_FALSEY:
            return None
        match = _FALLBACK_RE.search(command)
        if match:
            return f"touches the protected secret path ~/{match.group(1)}"
        return None

    for segment in _shellparse.command_segments(tokens):
        bypass = _shellparse.env_assignments(segment).get(BYPASS_VAR)
        if bypass is not None and bypass not in _BYPASS_FALSEY:
            continue
        secret = _segment_secret(segment)
        if secret:
            return f"touches the protected secret path ~/{secret}"
    return None
