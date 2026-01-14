#!/usr/bin/env bash
set -euo pipefail

DAYS="${1:-7}"

# Calculate cutoff date (macOS and GNU date compatible)
if date -v -"${DAYS}"d +%Y-%m-%dT%H:%M:%S >/dev/null 2>&1; then
  CUTOFF=$(date -v -"${DAYS}"d +%Y-%m-%dT%H:%M:%S)
else
  CUTOFF=$(date -d "-${DAYS} days" +%Y-%m-%dT%H:%M:%S)
fi

# Load allowed command prefixes from settings.json
ALLOW_PREFIXES=()
while IFS= read -r prefix; do
  [ -n "$prefix" ] && ALLOW_PREFIXES+=("$prefix")
done < <(jq -r '.permissions.allow[]? | select(startswith("Bash(")) | sub("^Bash\\("; "") | sub("\\)$"; "") | sub(":.*$"; "")' "$HOME/.claude/settings.json" 2>/dev/null)

# Find all session JSONL files, extract Bash commands, filter by time and allowed list
find "$HOME/.claude/projects" -name "*.jsonl" -type f 2>/dev/null \
| xargs grep -h '"name":"Bash"' 2>/dev/null \
| jq -r --arg cutoff "$CUTOFF" '
    select(.timestamp >= $cutoff) |
    .message.content[]? |
    select(.type == "tool_use" and .name == "Bash") |
    .input.command |
    split("\n")[0]
  ' 2>/dev/null \
| sort -u \
| while IFS= read -r cmd; do
    [ -z "$cmd" ] && continue
    # Skip very long commands (likely heredocs or multi-line scripts)
    [ ${#cmd} -gt 200 ] && continue
    # Skip comments
    [[ "$cmd" =~ ^[[:space:]]*# ]] && continue
    # Skip this script
    [[ "$cmd" == *"allow-cmd-recent"* ]] && continue

    allowed=false
    for prefix in "${ALLOW_PREFIXES[@]}"; do
      if [[ "$cmd" == "$prefix"* ]]; then
        allowed=true
        break
      fi
    done

    if [ "$allowed" = false ]; then
      echo "$cmd"
    fi
  done 2>/dev/null
