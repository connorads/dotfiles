"""Shared core for the email-egress guard.

Claude Code puts the signed-in account's address in the model's context, and
the model has sent it out as a client's contact details (a User-Agent naming
the address, anthropics/claude-code#107757). This core flags a tool call that
holds one of the user's Claude account addresses and can reach the network.

The addresses are read at run time from each Claude config's
`oauthAccount.emailAddress`, so no list of them is stored anywhere else.

The test is word matching, not parsing: an address plus a network word
(curl, https, gh, ...) anywhere in a shell call, or an address anywhere in a
web tool call. Known misses: an address computed at run time, a script file
run by name, MCP tools.
"""

from __future__ import annotations

import json
import re
import urllib.parse
from collections.abc import Iterator
from pathlib import Path

BYPASS_VAR = "EMAIL_OK"
_BYPASS_RE = re.compile(rf"(?:^|[\s;&|(]){BYPASS_VAR}=1(?=\s)")

WEB_TOOLS = frozenset({"WebFetch", "WebSearch"})

_NETWORK_RE = re.compile(
    r"\b(?:curl|curlie|wget2?|https?|httpie|xh|nc|ncat|socat|telnet|ssh|scp"
    r"|sftp|rsync|ftp|lftp|rclone|gh|iwr|irm|invoke-webrequest"
    r"|invoke-restmethod|requests|urllib|httpx|aiohttp|axios|fetch"
    r"|sendmail|mail|smtplib)\b",
    re.IGNORECASE,
)

_QUOTING_RE = re.compile(r"[\"'`\\]")


def account_emails(home: Path) -> frozenset[str]:
    """Lowercased account addresses from the default and profile Claude configs."""
    configs = [home / ".claude.json", *home.glob(".claude-profiles/*/*/.claude.json")]
    emails: set[str] = set()
    for config in configs:
        try:
            data: object = json.loads(config.read_text())
        except (OSError, ValueError):
            continue
        account = data.get("oauthAccount") if isinstance(data, dict) else None
        email = account.get("emailAddress") if isinstance(account, dict) else None
        if isinstance(email, str) and "@" in email:
            emails.add(email.strip().lower())
    return frozenset(emails)


def _strings(value: object) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def _readings(text: str) -> list[str]:
    """The text as written and with quotes removed, each also %-decoded."""
    plain = [text, _QUOTING_RE.sub("", text)]
    return [r.lower() for t in plain for r in (t, urllib.parse.unquote(t))]


def egress_reason(
    tool_name: str, tool_input: dict[str, object], emails: frozenset[str]
) -> str | None:
    """Why this call is refused, or None when it may run."""
    text = "\n".join(_strings(tool_input))
    readings = _readings(text)
    held = [e for e in emails if any(e in r for r in readings)]
    if not held:
        return None

    if tool_name not in WEB_TOOLS:
        if _BYPASS_RE.search(text):
            return None
        rest = readings
        for email in held:
            rest = [r.replace(email, " ") for r in rest]
        if not any(_NETWORK_RE.search(r) for r in rest):
            return None

    return (
        "This call holds one of the user's Claude account email addresses and "
        "may send it off this machine. If nobody asked to send it, run the "
        "call again without the address, using a generic client name. If the "
        "user explicitly asked to send it, use a Bash call with an "
        f"`{BYPASS_VAR}=1` prefix."
    )
