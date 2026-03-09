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

# Parse each prefix binding using awk to preserve backslash-escaped keys
tmux list-keys -T prefix | awk '
  {
    # Skip already wrapped (idempotent)
    if (index($0, "track-bind.sh")) next

    # Find key and command: fields after "-T prefix"
    for (i = 1; i <= NF; i++) {
      if ($i == "-T" && $(i+1) == "prefix") {
        key = $(i+2)
        cmd = ""
        for (j = i+3; j <= NF; j++) cmd = cmd (j > i+3 ? " " : "") $j
        break
      }
    }
    if (key == "" || cmd == "") next

    # Skip \; key — ambiguous with \; command separator
    if (key == "\\;") next

    print key "\t" cmd
  }
' | while IFS=$(printf '\t') read -r key cmd; do
  [ -z "$key" ] && continue
  [ -z "$cmd" ] && continue

  # Look up friendly name from notes, fall back to sanitised key
  name=$(grep -F "$key" "$NOTEFILE" | head -1 | cut -f2)
  [ -z "$name" ] && name=$(printf '%s' "$key" | tr -cd 'a-zA-Z0-9-')
  [ -z "$name" ] && name="special"

  # Sanitise key for shell arg: keep only alphanumeric + hyphen
  safe_key=$(printf '%s' "$key" | tr -cd 'a-zA-Z0-9-')
  [ -z "$safe_key" ] && safe_key="special"

  # Key is used as-is from list-keys (already in tmux-config format)
  printf 'bind-key -T prefix %s run-shell -b "sh %s %s %s #{session_name} #{window_index} #{pane_index} #{pane_current_path} #{host_short}" \\; %s\n' \
    "$key" "$TRACKER" "$safe_key" "$name" "$cmd" >> "$TMPFILE"
done

# Apply all wrapped bindings at once (no-op if everything already wrapped)
[ -s "$TMPFILE" ] && tmux source-file "$TMPFILE" || true
