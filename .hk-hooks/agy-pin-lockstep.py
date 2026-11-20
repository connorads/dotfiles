"""Pre-commit guard: mise's agy pin equals the release verified for isolated profiles.

The agy-profile launcher refuses any agy release other than verifiedAgyVersion,
because account isolation relies on undocumented agy storage behaviour. A pin
moved alone breaks every isolated account at launch; this moves the failure to
commit time. Bump both values together, after checking isolation by hand.

Exit codes: 0 = values agree, 1 = they differ or either is missing.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

PIN = (".config/mise/config.toml", r'^agy\s*=\s*"([^"]+)"')
VERIFIED = (
    "src/bb-plugins/claude-profiles/src/accounts/antigravity-profile.ts",
    r"^export const verifiedAgyVersion = '([^']+)';",
)


def _read(rel: str, pattern: str) -> str | None:
    """Prefer the cwd-relative path (pre-commit runs from $HOME), else $HOME."""
    path = Path(rel) if Path(rel).exists() else Path.home() / rel
    try:
        match = re.search(pattern, path.read_text(), re.MULTILINE)
    except OSError:
        return None
    return match.group(1) if match else None


def main() -> int:
    pinned = _read(*PIN)
    verified = _read(*VERIFIED)
    if pinned is None or verified is None:
        missing = PIN[0] if pinned is None else VERIFIED[0]
        print(f"agy-pin-lockstep: agy version not found in {missing}", file=sys.stderr)
        return 1
    if pinned != verified:
        print(
            f"agy-pin-lockstep: mise pins agy {pinned} but isolated profiles are verified"
            f" on {verified}. Check isolation on {pinned}, then set verifiedAgyVersion"
            " to match.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
