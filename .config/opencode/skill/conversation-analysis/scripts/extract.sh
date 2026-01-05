#!/bin/bash
# Extract user messages from OpenCode main sessions into chunks for analysis
#
# Usage: ./extract.sh
# Output: /tmp/opencode-analysis/chunk_*.jsonl
#
# Each chunk is ~320k characters (~80k tokens) of user messages in JSONL format.
# Messages < 10 chars are filtered out. Subagent sessions are excluded.

set -e

STORAGE=~/.local/share/opencode/storage
OUTPUT_DIR=/tmp/opencode-analysis
CHUNK_SIZE=320000  # ~80k tokens (chars/4)

mkdir -p "$OUTPUT_DIR"

# Get all main session IDs with timestamps, sorted by time
echo "Extracting main sessions..." >&2
find "$STORAGE/session" -name '*.json' -exec cat {} + 2>/dev/null | \
  jq -r 'select(.parentID == null) | "\(.time.created)\t\(.id)\t\(.title // "untitled")"' | \
  sort -n > "$OUTPUT_DIR/sessions.tsv"

session_count=$(wc -l < "$OUTPUT_DIR/sessions.tsv" | tr -d ' ')
echo "Found $session_count main sessions" >&2

# Extract all user messages with metadata
echo "Extracting user messages..." >&2
> "$OUTPUT_DIR/all_messages.jsonl"

while IFS=$'\t' read -r timestamp session_id session_title; do
  msg_dir="$STORAGE/message/$session_id"
  [ -d "$msg_dir" ] || continue
  
  for msg_file in "$msg_dir"/*.json; do
    [ -f "$msg_file" ] || continue
    role=$(jq -r '.role' "$msg_file" 2>/dev/null)
    [ "$role" = "user" ] || continue
    
    msg_id=$(jq -r '.id' "$msg_file" 2>/dev/null)
    msg_time=$(jq -r '.time.created' "$msg_file" 2>/dev/null)
    part_dir="$STORAGE/part/$msg_id"
    [ -d "$part_dir" ] || continue
    
    # Get text from parts
    text=$(cat "$part_dir"/*.json 2>/dev/null | jq -rs '[.[] | select(.type == "text") | .text // ""] | join("\n")')
    
    # Filter out short messages (< 10 chars)
    if [ ${#text} -ge 10 ]; then
      jq -nc \
        --arg sid "$session_id" \
        --arg stitle "$session_title" \
        --argjson ts "$msg_time" \
        --arg text "$text" \
        '{session_id: $sid, session_title: $stitle, timestamp: $ts, text: $text}' >> "$OUTPUT_DIR/all_messages.jsonl"
    fi
  done
done < "$OUTPUT_DIR/sessions.tsv"

total=$(wc -l < "$OUTPUT_DIR/all_messages.jsonl" | tr -d ' ')
echo "Extracted $total messages (after filtering)" >&2

# Sort by timestamp
sort -t'"' -k8 -n "$OUTPUT_DIR/all_messages.jsonl" > "$OUTPUT_DIR/sorted_messages.jsonl"
mv "$OUTPUT_DIR/sorted_messages.jsonl" "$OUTPUT_DIR/all_messages.jsonl"

# Remove old chunks
rm -f "$OUTPUT_DIR"/chunk_*.jsonl

# Chunk into files
echo "Chunking messages..." >&2
chunk_index=0
current_size=0
current_file="$OUTPUT_DIR/chunk_${chunk_index}.jsonl"
> "$current_file"

while read -r line; do
  text_len=$(echo "$line" | jq -r '.text | length')
  
  if [ $((current_size + text_len)) -gt $CHUNK_SIZE ] && [ $current_size -gt 0 ]; then
    chunk_index=$((chunk_index + 1))
    current_file="$OUTPUT_DIR/chunk_${chunk_index}.jsonl"
    > "$current_file"
    current_size=0
  fi
  
  echo "$line" >> "$current_file"
  current_size=$((current_size + text_len))
done < "$OUTPUT_DIR/all_messages.jsonl"

echo "" >&2
echo "=== Summary ===" >&2
echo "Created $((chunk_index + 1)) chunks in $OUTPUT_DIR/" >&2
echo "" >&2

# Summary table
printf "%-20s %10s %12s\n" "File" "Messages" "Chars"
printf "%-20s %10s %12s\n" "----" "--------" "-----"
for f in "$OUTPUT_DIR"/chunk_*.jsonl; do
  [ -f "$f" ] || continue
  count=$(wc -l < "$f" | tr -d ' ')
  chars=$(jq -r '.text' "$f" | wc -c | tr -d ' ')
  printf "%-20s %10s %12s\n" "$(basename "$f")" "$count" "$chars"
done
