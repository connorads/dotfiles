#!/usr/bin/env python3
"""Deterministic tests for reset-time.py.

Every case pins `--now` to a fixed epoch, so the expected reset epoch is
exact and reproducible (no dependence on the wall clock / CI machine TZ).
Expected epochs are constructed directly from datetime+zoneinfo here, which
exercises a *different* path than the parser's regex + next-occurrence
selection — so a bug in the parser still shows up as a mismatch.

Run: python3 test-reset-time.py   (exits non-zero on any failure)
"""

import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

SCRIPT = Path(__file__).resolve().parent.parent / "reset-time.py"

failures = []


def run(banner, now_epoch, margin=None):
    """Invoke reset-time.py; return (exit_code, stdout_int_or_None)."""
    args = [sys.executable, str(SCRIPT), "--now", str(now_epoch)]
    if margin is not None:
        args += ["--margin", str(margin)]
    p = subprocess.run(args, input=banner, capture_output=True, text=True)
    out = p.stdout.strip()
    val = int(out) if (p.returncode == 0 and out) else None
    return p.returncode, val


def epoch(y, mo, d, h, mi, tz):
    return int(datetime(y, mo, d, h, mi, tzinfo=ZoneInfo(tz)).timestamp())


def check(name, banner, now_epoch, expected_epoch, margin=0):
    code, val = run(banner, now_epoch, margin)
    if code != 0:
        failures.append(f"{name}: expected exit 0, got {code}")
        return
    if val != expected_epoch + margin:
        failures.append(
            f"{name}: expected {expected_epoch + margin} got {val} "
            f"(diff {None if val is None else val - (expected_epoch + margin)}s)"
        )


def check_fail(name, banner, now_epoch):
    code, _ = run(banner, now_epoch)
    if code == 0:
        failures.append(f"{name}: expected non-zero exit (fixed fallback), got 0")


# 1. Absolute time, same day, IANA zone — reset later today.
now = epoch(2026, 5, 31, 12, 0, "America/Santiago")
check(
    "santiago-3pm-today",
    "Claude usage limit reached. Your limit will reset at 3pm (America/Santiago).",
    now,
    epoch(2026, 5, 31, 15, 0, "America/Santiago"),
    margin=60,
)

# 2a. Clock already past today -> rolls to tomorrow.
now = epoch(2026, 5, 31, 9, 0, "Asia/Singapore")
check(
    "singapore-7am-tomorrow",
    "reset at 7am (Asia/Singapore).",
    now,
    epoch(2026, 6, 1, 7, 0, "Asia/Singapore"),
)

# 2b. Etc/GMT+5 quirk (POSIX-style IANA zone, sign inverted) still resolves.
now = epoch(2026, 5, 31, 6, 0, "Etc/GMT+5")
check(
    "etc-gmt-quirk",
    "resets 10am (Etc/GMT+5)",
    now,
    epoch(2026, 5, 31, 10, 0, "Etc/GMT+5"),
)

# 3. DST boundary: London springs forward 2026-03-29 01:00 GMT -> 02:00 BST.
#    A naive fixed-offset calc would land an hour wrong; zoneinfo must be used.
now = epoch(2026, 3, 29, 0, 30, "Europe/London")  # 00:30 GMT, before the jump
check(
    "london-dst-springforward",
    "resets 5am (Europe/London)",
    now,
    epoch(2026, 3, 29, 5, 0, "Europe/London"),  # 05:00 BST == 04:00 UTC
)

# 4. UTC offset form (UTC+8) rather than IANA name.
now = epoch(2026, 5, 31, 12, 0, "UTC")
check(
    "utc-offset-form",
    "Your limit will reset at 9pm (UTC+8).",
    now,
    int(datetime(2026, 5, 31, 21, 0, tzinfo=ZoneInfo("Etc/GMT-8")).timestamp()),
)

# 5. Relative "try again in N hours" -> now + N*3600 (+margin).
now = epoch(2026, 5, 31, 12, 0, "UTC")
check("relative-hours", "try again in 3 hours", now, now + 3 * 3600, margin=60)

# 5b. Relative minutes.
check("relative-minutes", "resets in 45 minutes", now, now + 45 * 60)

# 5c. Calendar date (weekly/Opus "resets Oct 6, 1pm") -> next occurrence of that date.
now = epoch(2026, 5, 31, 12, 0, "America/New_York")
check(
    "weekly-opus-date",
    "Opus weekly limit reached ∙ resets Oct 6, 1pm (America/New_York)",
    now,
    epoch(2026, 10, 6, 13, 0, "America/New_York"),
)

# 6. Garbage -> non-zero (drives the shell's fixed fallback).
check_fail("garbage", "the quick brown fox", now)

# 7. Unknown/bogus zone -> non-zero.
check_fail("bogus-zone", "resets 3pm (Bogus/Zone)", now)

if failures:
    print("FAIL:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("ok - reset-time.py: all cases passed")
