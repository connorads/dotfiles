#!/usr/bin/env bash
set -euo pipefail

DAYS="${1:-7}"

python3 - "$DAYS" "$HOME/.config/opencode/opencode.json" "$HOME/.local/share/opencode/opencode.db" "$HOME/.local/share/opencode/storage" <<'PY'
import datetime as dt
import fnmatch
import glob
import json
import os
import sqlite3
import sys

days = int(sys.argv[1])
config_path = sys.argv[2]
db_path = sys.argv[3]
storage_dir = sys.argv[4]

cutoff_ms = int((dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).timestamp() * 1000)

with open(config_path, "r", encoding="utf-8") as handle:
    config = json.load(handle)

allow_patterns = [
    key
    for key, value in (config.get("permission", {}).get("bash", {}) or {}).items()
    if value == "allow"
]


def filter_allowed(commands):
    for command in sorted(set(commands)):
        if not command:
            continue
        if "allow-cmd-recent.sh" in command:
            continue
        if any(fnmatch.fnmatchcase(command, pattern) for pattern in allow_patterns):
            continue
        print(command)


def from_sqlite(path):
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row

    session_count = conn.execute(
        "SELECT COUNT(*) FROM session WHERE time_updated >= ?", (cutoff_ms,)
    ).fetchone()[0]
    if session_count == 0:
        print(f"No sessions found in last {days} days.")
        return

    rows = conn.execute(
        """
        SELECT DISTINCT REPLACE(json_extract(p.data, '$.state.input.command'), char(10), '\\n') AS command
        FROM part p
        JOIN session s ON s.id = p.session_id
        WHERE s.time_updated >= ?
          AND json_extract(p.data, '$.type') = 'tool'
          AND json_extract(p.data, '$.tool') = 'bash'
          AND json_type(p.data, '$.state.input.command') = 'text'
        ORDER BY command
        """,
        (cutoff_ms,),
    )
    commands = [row["command"] for row in rows if row["command"]]
    filter_allowed(commands)


def read_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def from_legacy(path):
    session_ids = set()
    for file_path in glob.glob(os.path.join(path, "session", "**", "*.json"), recursive=True):
        try:
            data = read_json(file_path)
        except Exception:
            continue
        updated = (data.get("time") or {}).get("updated")
        if isinstance(updated, int) and updated >= cutoff_ms:
            session_id = data.get("id")
            if session_id:
                session_ids.add(session_id)

    if not session_ids:
        print(f"No sessions found in last {days} days.")
        return

    commands = []
    for file_path in glob.glob(os.path.join(path, "part", "**", "*.json"), recursive=True):
        try:
            data = read_json(file_path)
        except Exception:
            continue
        if data.get("tool") != "bash":
            continue
        if data.get("sessionID") not in session_ids:
            continue

        command = (((data.get("state") or {}).get("input") or {}).get("command"))
        if isinstance(command, str):
            commands.append(command.replace("\n", "\\n"))

    filter_allowed(commands)


if os.path.isfile(db_path):
    try:
        from_sqlite(db_path)
    except Exception:
        if os.path.isdir(storage_dir):
            from_legacy(storage_dir)
        else:
            raise
elif os.path.isdir(storage_dir):
    from_legacy(storage_dir)
else:
    print(f"No sessions found in last {days} days.")
PY
