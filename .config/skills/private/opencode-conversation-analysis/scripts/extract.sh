#!/usr/bin/env bash
# Extract user messages from OpenCode main sessions into chunks for analysis.
#
# Usage: ./extract.sh
# Output: /tmp/opencode-analysis/chunk_*.jsonl
#
# Current OpenCode versions use SQLite at ~/.local/share/opencode/opencode.db.
# Older versions used JSON files under ~/.local/share/opencode/storage.
# This script supports both (SQLite first, JSON fallback).

set -euo pipefail

DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/opencode"
DB_PATH="$DATA_DIR/opencode.db"
STORAGE_DIR="$DATA_DIR/storage"
OUTPUT_DIR=/tmp/opencode-analysis
ALL_MESSAGES_FILE="$OUTPUT_DIR/all_messages.jsonl"
CHUNK_SIZE=320000 # ~80k tokens (chars/4)
MIN_TEXT_LEN=10

mkdir -p "$OUTPUT_DIR"

echo "Extracting user messages..." >&2
python3 - "$DB_PATH" "$STORAGE_DIR" "$ALL_MESSAGES_FILE" "$MIN_TEXT_LEN" <<'PY'
import glob
import json
import os
import sqlite3
import sys

db_path, storage_dir, out_file, min_text_len_str = sys.argv[1:5]
min_text_len = int(min_text_len_str)


def flush_record(records, session_id, session_title, timestamp, text_parts):
    if session_id is None:
        return
    text = "\n".join(part for part in text_parts if part)
    if len(text) < min_text_len:
        return
    records.append(
        {
            "session_id": session_id,
            "session_title": session_title,
            "timestamp": int(timestamp or 0),
            "text": text,
        }
    )


def extract_from_sqlite(path):
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row

    table_names = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    required = {"session", "message", "part"}
    missing = required - table_names
    if missing:
        missing_list = ", ".join(sorted(missing))
        raise RuntimeError(f"SQLite schema missing required tables: {missing_list}")

    session_count = conn.execute(
        "SELECT COUNT(*) FROM session WHERE parent_id IS NULL"
    ).fetchone()[0]
    print(f"Detected SQLite storage: {path}", file=sys.stderr)
    print(f"Found {session_count} main sessions", file=sys.stderr)

    rows = conn.execute(
        """
        SELECT
          s.id AS session_id,
          COALESCE(s.title, 'untitled') AS session_title,
          m.id AS message_id,
          m.time_created AS message_time,
          json_extract(p.data, '$.text') AS part_text
        FROM session s
        JOIN message m ON m.session_id = s.id
        JOIN part p ON p.message_id = m.id
        WHERE s.parent_id IS NULL
          AND json_extract(m.data, '$.role') = 'user'
          AND json_extract(p.data, '$.type') = 'text'
        ORDER BY m.time_created, p.time_created
        """
    )

    records = []
    current_message_id = None
    current_session_id = None
    current_session_title = "untitled"
    current_message_time = 0
    current_parts = []

    for row in rows:
        message_id = row["message_id"]
        if current_message_id is not None and message_id != current_message_id:
            flush_record(
                records,
                current_session_id,
                current_session_title,
                current_message_time,
                current_parts,
            )
            current_parts = []

        if message_id != current_message_id:
            current_message_id = message_id
            current_session_id = row["session_id"]
            current_session_title = row["session_title"]
            current_message_time = row["message_time"]

        part_text = row["part_text"]
        if isinstance(part_text, str):
            current_parts.append(part_text)

    flush_record(
        records,
        current_session_id,
        current_session_title,
        current_message_time,
        current_parts,
    )

    return session_count, records


def read_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def extract_from_legacy_storage(path):
    session_files = sorted(
        glob.glob(os.path.join(path, "session", "**", "*.json"), recursive=True)
    )
    sessions = {}
    for file_path in session_files:
        try:
            data = read_json(file_path)
        except Exception:
            continue
        if data.get("parentID") is not None:
            continue
        session_id = data.get("id")
        if not session_id:
            continue
        sessions[session_id] = data.get("title") or "untitled"

    print(f"Detected legacy JSON storage: {path}", file=sys.stderr)
    print(f"Found {len(sessions)} main sessions", file=sys.stderr)

    records = []
    for session_id, session_title in sessions.items():
        message_dir = os.path.join(path, "message", session_id)
        if not os.path.isdir(message_dir):
            continue

        for message_file in sorted(glob.glob(os.path.join(message_dir, "*.json"))):
            try:
                message = read_json(message_file)
            except Exception:
                continue

            if message.get("role") != "user":
                continue

            message_id = message.get("id")
            if not message_id:
                continue

            message_time = (
                (message.get("time") or {}).get("created")
                if isinstance(message.get("time"), dict)
                else 0
            )
            part_dir = os.path.join(path, "part", message_id)
            if not os.path.isdir(part_dir):
                continue

            text_parts = []
            for part_file in sorted(glob.glob(os.path.join(part_dir, "*.json"))):
                try:
                    part = read_json(part_file)
                except Exception:
                    continue
                if part.get("type") != "text":
                    continue
                text = part.get("text")
                if isinstance(text, str):
                    text_parts.append(text)

            flush_record(records, session_id, session_title, message_time, text_parts)

    return len(sessions), records


session_count = 0
records = []

if os.path.isfile(db_path):
    try:
        session_count, records = extract_from_sqlite(db_path)
    except Exception as exc:
        if os.path.isdir(storage_dir):
            print(
                f"SQLite extraction failed ({exc}); falling back to legacy JSON storage.",
                file=sys.stderr,
            )
            session_count, records = extract_from_legacy_storage(storage_dir)
        else:
            raise
elif os.path.isdir(storage_dir):
    session_count, records = extract_from_legacy_storage(storage_dir)
else:
    raise SystemExit(
        "No OpenCode storage found. Expected either opencode.db or storage/ directory."
    )

records.sort(key=lambda row: row["timestamp"])
with open(out_file, "w", encoding="utf-8") as handle:
    for row in records:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")

print(f"Extracted {len(records)} messages (after filtering)", file=sys.stderr)
PY

if [ ! -s "$ALL_MESSAGES_FILE" ]; then
	rm -f "$OUTPUT_DIR"/chunk_*.jsonl
	echo "" >&2
	echo "=== Summary ===" >&2
	echo "Created 0 chunks in $OUTPUT_DIR/" >&2
	echo "" >&2
	printf "%-20s %10s %12s\n" "File" "Messages" "Chars"
	printf "%-20s %10s %12s\n" "----" "--------" "-----"
	exit 0
fi

echo "Chunking messages..." >&2
python3 - "$ALL_MESSAGES_FILE" "$OUTPUT_DIR" "$CHUNK_SIZE" <<'PY'
import glob
import json
import os
import sys

all_messages_file, output_dir, chunk_size_str = sys.argv[1:4]
chunk_size = int(chunk_size_str)

with open(all_messages_file, "r", encoding="utf-8") as handle:
    records = [json.loads(line) for line in handle if line.strip()]

records.sort(key=lambda row: int(row.get("timestamp", 0)))

for old_file in glob.glob(os.path.join(output_dir, "chunk_*.jsonl")):
    os.remove(old_file)

chunks = []
current_chunk = []
current_size = 0

for record in records:
    text_len = len(record.get("text", ""))
    if current_chunk and current_size + text_len > chunk_size:
        chunks.append(current_chunk)
        current_chunk = []
        current_size = 0

    current_chunk.append(record)
    current_size += text_len

if current_chunk:
    chunks.append(current_chunk)

for index, chunk in enumerate(chunks):
    path = os.path.join(output_dir, f"chunk_{index}.jsonl")
    with open(path, "w", encoding="utf-8") as handle:
        for record in chunk:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

print("", file=sys.stderr)
print("=== Summary ===", file=sys.stderr)
print(f"Created {len(chunks)} chunks in {output_dir}/", file=sys.stderr)
print("", file=sys.stderr)

print(f"{'File':<20} {'Messages':>10} {'Chars':>12}")
print(f"{'----':<20} {'--------':>10} {'-----':>12}")
for index, chunk in enumerate(chunks):
    chars = sum(len(item.get("text", "")) for item in chunk)
    print(f"chunk_{index}.jsonl{'':<7} {len(chunk):>10} {chars:>12}")
PY
