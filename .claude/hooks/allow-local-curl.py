#!/usr/bin/env python3
"""
Claude Code hook to auto-allow curl commands targeting only local hosts.

Curl to localhost/127.0.0.1/::1/0.0.0.0 is auto-allowed without prompting.
Any remote or ambiguous targets fall through to the normal permission flow.

Conservative by design:
  - URLs without a scheme (e.g. `curl localhost:3000`) won't match -> prompts
  - Mixed local + remote targets -> prompts
  - Encoded IPs (hex, octal, decimal) -> prompts

Exit codes:
  0 - Always

Output:
  JSON with permissionDecision "allow" for local-only curl, nothing otherwise.

Tests: uv run --with pytest pytest ~/.claude/hooks/test_allow_local_curl.py -v
"""

from __future__ import annotations

import json
import re
import sys
from urllib.parse import urlparse

# Hostnames considered local
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "0.0.0.0", "::1"})

# Commands where `curl` may appear in quoted args (e.g. commit messages) -- skip these.
NOT_CURL_CMD_RE = re.compile(r"\b(?:git|dotfiles)\b.*\bcommit\b")

# Extract all http(s):// URLs from a command string
URL_RE = re.compile(r"https?://[^\s\"'<>|;)]+", re.IGNORECASE)


def is_local_curl(command: str) -> bool:
    """Return True if command is a curl invocation targeting only local hosts.

    Requires at least one URL with an http(s) scheme, and every URL's host
    must be in LOCAL_HOSTS. Returns False for anything ambiguous.
    """
    if NOT_CURL_CMD_RE.search(command):
        return False

    # curl must be in command position (start of command or after pipe/chain),
    # not just a word inside arguments like echo "curl ..."
    if not re.search(r"(?:^|[|;]|&&|\|\|)\s*curl\b", command):
        return False

    urls = URL_RE.findall(command)
    if not urls:
        return False

    for url in urls:
        try:
            parsed = urlparse(url)
        except Exception:
            return False

        hostname = parsed.hostname
        if hostname is None or hostname not in LOCAL_HOSTS:
            return False

    return True


def main() -> int:
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    tool_input = input_data.get("tool_input", {})
    command = tool_input.get("command", "")

    if not command:
        return 0

    if is_local_curl(command):
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "allow",
            }
        }
        json.dump(output, sys.stdout)

    return 0


if __name__ == "__main__":
    sys.exit(main())
