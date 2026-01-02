#!/usr/bin/env bash
set -euo pipefail

DAYS="${1:-7}"

if date -v -"${DAYS}"d +%s >/dev/null 2>&1; then
  CUTOFF="$(date -v -"${DAYS}"d +%s)000"
else
  CUTOFF="$(date -d "-${DAYS} days" +%s)000"
fi

SESSION_IDS="$(
  rg --files --hidden -0 -g "ses_*.json" "$HOME/.local/share/opencode/storage/session" \
  | xargs -0 jq -r "select(.time.updated >= ${CUTOFF}) | .id" \
  | sort -u
)"

if [ -z "$SESSION_IDS" ]; then
  echo "No sessions found in last ${DAYS} days."
  exit 0
fi

SESSIONS_JSON="$(printf "%s\n" "$SESSION_IDS" | jq -R -s "split(\"\\n\") | map(select(length>0))")"

ALLOW_PATTERNS=()
while IFS= read -r pattern; do
  [ -n "$pattern" ] && ALLOW_PATTERNS+=("$pattern")
done < <(jq -r '.permission.bash | to_entries[] | select(.value == "allow") | .key' "$HOME/.config/opencode/opencode.json")

rg --files --hidden -0 -g "*.json" "$HOME/.local/share/opencode/storage/part" \
| xargs -0 jq -r --argjson sessions "$SESSIONS_JSON" \
  '($sessions | map({(.): true}) | add) as $set | select(.tool == "bash" and $set[.sessionID]) | (.state.input.command? // empty) | tostring | gsub("\n"; "\\n")' \
| sort -u \
| while IFS= read -r cmd; do
    [ -z "$cmd" ] && continue
    if [[ "$cmd" == *"allow-cmd-recent.sh"* ]]; then
      continue
    fi
    allowed=false
    for pattern in "${ALLOW_PATTERNS[@]}"; do
      if [[ "$cmd" == $pattern ]]; then
        allowed=true
        break
      fi
    done
    if [ "$allowed" = false ]; then
      echo "$cmd"
    fi
  done
