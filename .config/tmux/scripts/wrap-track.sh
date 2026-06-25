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
	note=$(printf '%s' "$line" | sed 's/^[^[:space:]]*[[:space:]]*//')
	name=$(printf '%s' "$note" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')
	printf '%s\t%s\t%s\n' "$key" "$name" "$note"
	escaped_key=$(printf '%s' "$key" | sed 's/[\\"%]/\\&/g')
	[ "$escaped_key" = "$key" ] || printf '%s\t%s\t%s\n' "$escaped_key" "$name" "$note"
done >"$NOTEFILE"

quote_tmux_double() {
	printf '%s' "$1" | sed 's/[\\"]/\\&/g'
}

# Parse each prefix binding. tmux pads list-keys output for alignment, so match
# whitespace flexibly and keep the command tail opaque.
tmux list-keys -T prefix | awk '
  {
    line = $0
    repeat = "n"
    if (sub(/^bind-key[[:space:]]+-r[[:space:]]+-T[[:space:]]+prefix[[:space:]]+/, "", line)) {
      repeat = "r"
    } else if (!sub(/^bind-key[[:space:]]+-T[[:space:]]+prefix[[:space:]]+/, "", line)) {
      next
    }

    key = line
    sub(/[[:space:]].*$/, "", key)
    cmd = line
    sub(/^[^[:space:]]+/, "", cmd)
    sub(/^[[:space:]]+/, "", cmd)

    if (cmd ~ /track-bind\.sh/) {
      original = cmd
      sub(/^run-shell[[:space:]]+-b[[:space:]]+"[^"]*track-bind\.sh[^"]*"[[:space:]]+\\;[[:space:]]*/, "", original)
      if (original == cmd) next
      cmd = original
    }

    if (key == "" || cmd == "" || cmd == key || key == "\\;") next
    printf "%s\t%s\t%s\n", repeat, key, cmd
  }
' | while IFS="$(printf '\t')" read -r repeat key cmd; do
	rflag=""
	[ "$repeat" = "r" ] && rflag="-r "

	# Look up friendly name (exact key match). list-keys escapes some key tokens
	# (for example \\ in command form, but \ in -N output), so retry with one
	# backslash layer removed before falling back to the raw key.
	name=$(awk -F'\t' -v k="$key" '$1 == k {print $2; exit}' "$NOTEFILE")
	note=$(awk -F'\t' -v k="$key" '$1 == k {print $3; exit}' "$NOTEFILE")
	if [ -z "$name" ] && [ -z "$note" ]; then
		note_key=$(printf '%s' "$key" | sed 's/\\\(.\)/\1/g')
		name=$(awk -F'\t' -v k="$note_key" '$1 == k {print $2; exit}' "$NOTEFILE")
		note=$(awk -F'\t' -v k="$note_key" '$1 == k {print $3; exit}' "$NOTEFILE")
	fi
	[ -z "$name" ] && name=$(printf '%s' "$key" | tr -cd 'a-zA-Z0-9-')
	[ -z "$name" ] && name="special"

	# Sanitise key for shell arg
	safe_key=$(printf '%s' "$key" | tr -cd 'a-zA-Z0-9-')
	[ -z "$safe_key" ] && safe_key="special"

	# Build -N flag if annotation exists
	nflag=""
	if [ -n "$note" ]; then
		nflag="-N \"$(quote_tmux_double "$note")\" "
	fi

	printf 'bind-key %s%s-T prefix %s run-shell -b "sh %s %s %s #{q:session_name} #{window_index} #{pane_index} #{q:pane_current_path} #{q:host_short}" \\; %s\n' \
		"$nflag" "$rflag" "$key" "$TRACKER" "$safe_key" "$name" "$cmd" >>"$TMPFILE"
done

# Apply all wrapped bindings at once
[ -s "$TMPFILE" ] && tmux source-file "$TMPFILE" || true
