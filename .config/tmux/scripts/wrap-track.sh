#!/bin/sh
# wrap-track: dynamically wrap all prefix-table bindings with usage tracking
# Run once at config load (after TPM) via run-shell. Idempotent on reload.
set -e
TRACKER="$HOME/.config/tmux/scripts/track-bind.sh"
TMPFILE="$(mktemp)"
NOTEFILE="$(mktemp)"
trap 'rm -f "$TMPFILE" "$NOTEFILE"' EXIT

# Build note lookup: key<TAB>name<TAB>note (from -N annotations)
# list-keys -N -T prefix format: "<key>  <note text>"
tmux list-keys -N -T prefix | while IFS= read -r line; do
  key=$(printf '%s' "$line" | awk '{print $1}')
  note=$(printf '%s' "$line" | sed 's/^[^ ]* *//')
  name=$(printf '%s' "$note" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')
  printf '%s\t%s\t%s\n' "$key" "$name" "$note"
done > "$NOTEFILE"

# Parse each prefix binding; sed prefix-stripping preserves all quoting
tmux list-keys -T prefix | while IFS= read -r line; do
  # Skip already wrapped (idempotent)
  case "$line" in *track-bind.sh*) continue ;; esac

  # Detect -r flag and strip fixed prefix
  case "$line" in
    "bind-key -r -T prefix "*)
      rflag="-r "
      rest="${line#bind-key -r -T prefix }"
      ;;
    "bind-key -T prefix "*)
      rflag=""
      rest="${line#bind-key -T prefix }"
      ;;
    *) continue ;;
  esac

  # Extract key (first token) and command (remainder, opaque)
  key="${rest%% *}"
  cmd="${rest#* }"

  # Skip \; key (ambiguous with command separator)
  [ "$key" = '\;' ] && continue

  # Skip if no command
  [ -z "$cmd" ] || [ "$cmd" = "$key" ] && continue

  # Look up friendly name (exact key match)
  name=$(awk -F'\t' -v k="$key" '$1 == k {print $2; exit}' "$NOTEFILE")
  [ -z "$name" ] && name=$(printf '%s' "$key" | tr -cd 'a-zA-Z0-9-')
  [ -z "$name" ] && name="special"

  # Look up original note text for -N preservation
  note=$(awk -F'\t' -v k="$key" '$1 == k {print $3; exit}' "$NOTEFILE")

  # Sanitise key for shell arg
  safe_key=$(printf '%s' "$key" | tr -cd 'a-zA-Z0-9-')
  [ -z "$safe_key" ] && safe_key="special"

  # Build -N flag if annotation exists
  nflag=""
  [ -n "$note" ] && nflag="-N \"$note\" "

  printf 'bind-key %s%s-T prefix %s run-shell -b "sh %s %s %s #{session_name} #{window_index} #{pane_index} #{pane_current_path} #{host_short}" \\; %s\n' \
    "$nflag" "$rflag" "$key" "$TRACKER" "$safe_key" "$name" "$cmd" >> "$TMPFILE"
done

# Apply all wrapped bindings at once
[ -s "$TMPFILE" ] && tmux source-file "$TMPFILE" || true
