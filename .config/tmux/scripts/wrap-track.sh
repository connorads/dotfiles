#!/bin/sh
# wrap-track: dynamically wrap all prefix-table bindings with usage tracking
# Run once at config load (after TPM) via run-shell. Idempotent on reload.
set -e
TRACKER="$HOME/.config/tmux/scripts/track-bind.sh"
TMPFILE="$(mktemp)"
NOTEFILE="$(mktemp)"
trap 'rm -f "$TMPFILE" "$NOTEFILE"' EXIT

# Build note lookup: key → name (from -N annotations)
tmux list-keys -N -T prefix | while IFS= read -r line; do
  key=$(echo "$line" | awk '{print $1}')
  note=$(echo "$line" | sed 's/^[^ ]* *//')
  name=$(echo "$note" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')
  printf '%s\t%s\n' "$key" "$name"
done > "$NOTEFILE"

tmux list-keys -T prefix | while IFS= read -r line; do
  # Skip if already wrapped (idempotent)
  case "$line" in *track-bind.sh*) continue ;; esac

  # Extract key: field immediately after "-T prefix"
  key=$(echo "$line" | sed -n 's/.*-T prefix  *\([^ ]*\).*/\1/p')
  [ -z "$key" ] && continue

  # Look up friendly name from notes, fall back to key
  name=$(grep -F "$key" "$NOTEFILE" | head -1 | cut -f2)
  # Sanitise key for use as fallback name (strip backslashes, keep alphanumeric + -)
  [ -z "$name" ] && name=$(printf '%s' "$key" | tr -cd 'a-zA-Z0-9-')
  [ -z "$name" ] && name="unknown"

  # Sanitise key for shell arg: strip backslash, replace quotes with safe tokens
  safe_key=$(printf '%s' "$key" | sed "s/\\\\//g; s/'/sq/g; s/\"/dq/g")
  [ -z "$safe_key" ] && safe_key="backslash"

  # Extract the command portion (everything after the key)
  cmd=$(echo "$line" | sed "s/.*-T prefix  *[^ ]* *//")
  [ -z "$cmd" ] && continue

  # Re-escape key for tmux config (backslashes need doubling)
  tmux_key=$(printf '%s' "$key" | sed 's/\\/\\\\/g')

  # Write wrapped bind: track async then run original command
  # Use double quotes for run-shell arg to avoid single-quote issues with keys like \'
  printf 'bind-key -T prefix %s run-shell -b "sh %s %s %s #{session_name} #{window_index} #{pane_index} #{pane_current_path} #{host_short}" \\; %s\n' \
    "$tmux_key" "$TRACKER" "$safe_key" "$name" "$cmd" >> "$TMPFILE"
done

# Apply all wrapped bindings at once (no-op if everything already wrapped)
[ -s "$TMPFILE" ] && tmux source-file "$TMPFILE" || true
