#!/usr/bin/env python3
"""Pure reset-time parser for claude-watch.

Reads a (already ANSI-stripped, but we strip again defensively) rate-limit
banner on stdin and prints the epoch of the *next* reset (+margin) to stdout.
Exits non-zero on anything it can't parse or an unknown timezone, so the shell
watcher falls back to its fixed wait.

Mirrors cheapestinference/claude-auto-retry's patterns.js + time-parser.js, but
in stdlib-only Python (datetime + zoneinfo) so it's DST-safe and portable with
no pip deps. The clock time and the timezone are captured by *separate* regexes
(Claude prints "reset at 3pm (America/Santiago)" — hour/ampm in one place, the
IANA/offset zone in parens).

Usage: reset-time.py [--now EPOCH] [--margin SECONDS]   (banner on stdin)
"""

import argparse
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# --- ANSI strip (defensive; watcher already strips) ---
_ANSI = re.compile(r"\x1b\[[\x20-\x3f]*[\x40-\x7e]|\x1b\][\s\S]*?(?:\x07|\x1b\\)")

# Clock time: "resets 3pm" / "reset at 3:00 PM" / "resets at 11" (NB: no zone here)
_RESET_CLOCK = re.compile(
    r"resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", re.IGNORECASE
)
# Absolute calendar date: "resets Oct 6, 1pm" (the weekly/Opus multi-day form).
# No year in the banner -> we pick the next future occurrence of that date.
_RESET_DATE = re.compile(
    r"resets?\s+(?:on\s+)?"
    r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+"
    r"(\d{1,2})(?:st|nd|rd|th)?,?\s+(?:at\s+)?"
    r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?",
    re.IGNORECASE,
)
_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
# Relative: "try again in 5 hours" / "resets in 45 minutes" / "wait 2 h"
_RELATIVE = re.compile(
    r"(?:try again|wait|resets?\s+in)[:\s]\s*(?:for\s+)?(?:in\s+)?"
    r"(\d+)\s*(hours?|minutes?|mins?|h|m)\b",
    re.IGNORECASE,
)
# Timezone, extracted independently. IANA path allows digits/+/- so zones like
# "Etc/GMT+5" survive (the reference's stricter [A-Za-z_] would drop the "+5").
_TZ_IANA = re.compile(r"\(([A-Za-z][A-Za-z0-9_+-]*(?:/[A-Za-z0-9_+-]+){1,2})\)")
_TZ_OFFSET = re.compile(r"\((?:UTC|GMT)([+-]\d{1,2})(?::(\d{2}))?\)", re.IGNORECASE)
_TZ_BARE = re.compile(r"\((UTC|GMT)\)", re.IGNORECASE)


def strip_ansi(text):
    return _ANSI.sub("", text)


def resolve_tz(banner):
    """Return a tzinfo from the banner, or None if none present/parseable.

    Raises LookupError-style via caller when an IANA name is present but
    unknown (so the watcher uses its fixed fallback rather than guessing).
    """
    m = _TZ_IANA.search(banner)
    if m:
        return ZoneInfo(m.group(1))  # may raise ZoneInfoNotFoundError
    m = _TZ_OFFSET.search(banner)
    if m:
        hours = int(m.group(1))
        mins = int(m.group(2)) if m.group(2) else 0
        sign = 1 if hours >= 0 else -1
        return timezone(timedelta(hours=hours, minutes=sign * mins))
    if _TZ_BARE.search(banner):
        return ZoneInfo("UTC")
    return None


def adjust_hour(hour, ampm):
    if ampm == "pm" and hour != 12:
        hour += 12
    if ampm == "am" and hour == 12:
        hour = 0
    return hour


def next_occurrence(hour, minute, tz, now_dt):
    """Soonest datetime strictly after now_dt with the given wall-clock h:m in tz."""
    local_now = now_dt.astimezone(tz)
    d = local_now.date()
    cand = datetime(d.year, d.month, d.day, hour, minute, tzinfo=tz)
    if cand <= local_now:
        d2 = d + timedelta(days=1)
        cand = datetime(d2.year, d2.month, d2.day, hour, minute, tzinfo=tz)
    return cand


def compute(banner, now_epoch, margin):
    banner = strip_ansi(banner)
    now_dt = datetime.fromtimestamp(now_epoch, tz=timezone.utc)

    # Calendar date first (weekly/Opus "resets Oct 6, 1pm") — most specific, and
    # days-away so it trips the watcher's wait ceiling rather than a 5h fallback.
    cal = _RESET_DATE.search(banner)
    if cal:
        month = _MONTHS[cal.group(1).lower()[:3]]
        day = int(cal.group(2))
        hour = adjust_hour(int(cal.group(3)), cal.group(5).lower() if cal.group(5) else None)
        minute = int(cal.group(4)) if cal.group(4) else 0
        if hour > 23 or minute > 59 or day > 31:
            return None
        tz = resolve_tz(banner) or datetime.now().astimezone().tzinfo
        local_now = now_dt.astimezone(tz)
        year = local_now.year
        target = datetime(year, month, day, hour, minute, tzinfo=tz)
        if target <= local_now:
            target = datetime(year + 1, month, day, hour, minute, tzinfo=tz)
        return int(target.timestamp()) + margin

    # Absolute clock today/tomorrow ("reset at 3pm"); absolute wins over relative.
    clock = _RESET_CLOCK.search(banner)
    if clock:
        minute = int(clock.group(2)) if clock.group(2) else 0
        ampm = clock.group(3).lower() if clock.group(3) else None
        hour = adjust_hour(int(clock.group(1)), ampm)
        if hour > 23 or minute > 59:
            return None

        tz = resolve_tz(banner)  # may raise on unknown IANA name
        if tz is None:
            # No zone in banner — fall back to system local time (untested,
            # mirrors the reference; Claude always prints a zone in practice).
            tz = datetime.now().astimezone().tzinfo

        ambiguous = ampm is None and 1 <= hour <= 12
        cands = [next_occurrence(hour, minute, tz, now_dt)]
        if ambiguous and hour + 12 < 24:
            cands.append(next_occurrence(hour + 12, minute, tz, now_dt))
        target = min(cands, key=lambda c: c.timestamp())
        return int(target.timestamp()) + margin

    rel = _RELATIVE.search(banner)
    if rel:
        amount = int(rel.group(1))
        unit = rel.group(2).lower()
        secs = amount * (60 if unit.startswith("m") else 3600)
        return now_epoch + secs + margin

    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--now", type=int, default=None, help="epoch seconds (default: real now)")
    ap.add_argument("--margin", type=int, default=60, help="seconds added to the reset time")
    args = ap.parse_args()

    now_epoch = args.now if args.now is not None else int(time.time())
    banner = sys.stdin.read()

    try:
        result = compute(banner, now_epoch, args.margin)
    except (ZoneInfoNotFoundError, ValueError, OverflowError, OSError):
        return 1

    if result is None:
        return 1
    print(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
