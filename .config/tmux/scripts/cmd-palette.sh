#!/usr/bin/env sh
# cmd-palette: fzf palette over prefix-table key bindings; replay the chosen key.
#
# One row per binding, labelled by its -N description, so the track-bind usage
# wrapper never shows in the list. The preview renders the description plus the
# real command with the tracking wrapper stripped. Selecting a row replays the
# key via `send-keys -K`, so the binding runs exactly as if pressed (tracking
# included).
#
# Bound in tmux.conf, e.g.:
#   bind -N "Command palette" M-/ run-shell 'sh ~/.config/tmux/scripts/cmd-palette.sh'
#
# Invoked two ways:
#   (no args)        interactive picker -> replay selected key
#   --preview <key>  render markdown preview for one key (called by fzf)

set -eu

TABLE=prefix
SELF=$0

# Drop a leading `run-shell -b "sh …/track-bind.sh …" \; ` usage wrapper.
strip_track() {
	sed -E 's|^run-shell -b "sh [^"]*track-bind\.sh[^"]*" \\; ||'
}

# Escape a key for tmux argv: a bare `;` is tmux's command separator, so the
# literal semicolon binding must be passed as `\;`.
tmux_key() {
	if [ "$1" = ";" ]; then printf '\\;'; else printf '%s' "$1"; fi
}

note_rows() {
	if tmux list-keys -N -P '' -T "$TABLE" 2>/dev/null; then
		return
	fi

	prefix_key=$(tmux show-options -gv prefix 2>/dev/null || true)
	tmux list-keys -NT "$TABLE" 2>/dev/null | while IFS= read -r line; do
		case "$line" in
		"$prefix_key "*) line=${line#"$prefix_key" } ;;
		esac
		printf '%s\n' "$line"
	done
}

note_for_key() {
	note_rows | awk -v k="$1" '
		$1 == k {
			$1 = ""
			sub(/^[[:space:]]+/, "")
			print
			exit
		}
	'
}

command_for_key() {
	lk=$(tmux_key "$1")
	tmux list-keys -T "$TABLE" 2>/dev/null | awk -v table="$TABLE" -v key="$lk" '
		{
			line = $0
			if (sub(/^bind-key[[:space:]]+-r[[:space:]]+-T[[:space:]]+/, "", line)) {
			} else if (!sub(/^bind-key[[:space:]]+-T[[:space:]]+/, "", line)) {
				next
			}

			listed_table = line
			sub(/[[:space:]].*$/, "", listed_table)
			if (listed_table != table) next

			rest = line
			sub(/^[^[:space:]]+[[:space:]]+/, "", rest)
			listed_key = rest
			sub(/[[:space:]].*$/, "", listed_key)
			if (listed_key != key) next

			sub(/^[^[:space:]]+[[:space:]]+/, "", rest)
			print rest
			exit
		}
	'
}

# Render markdown to the preview. Wrap to the pane width (fzf exports it as
# FZF_PREVIEW_COLUMNS) so glow's lines fit and fzf never re-wraps them with its
# own `↳` continuation marker.
render() {
	width=${FZF_PREVIEW_COLUMNS:-${COLUMNS:-80}}
	if command -v glow >/dev/null 2>&1; then
		glow -s dark -w "$width" -
	else
		fold -s -w "$width"
	fi
}

preview() {
	key=$1
	note=$(note_for_key "$key")
	cmd=$(command_for_key "$key" | strip_track)

	{
		printf '# %s\n\n' "$key"
		[ -n "$note" ] && printf '> %s\n\n' "$note"
		printf '~~~tmux\n%s\n~~~\n' "$cmd"
	} | render
}

pick() {
	line=$(note_rows | fzf --tmux 80% --reverse \
		--header "$TABLE · enter runs the binding" \
		--preview "sh '$SELF' --preview {1}" \
		--preview-window 'right,55%,wrap') || exit 0
	[ -n "$line" ] || exit 0

	key=$(printf '%s\n' "$line" | awk '{print $1}')
	[ -n "$key" ] || exit 0

	tmux switch-client -T "$TABLE"
	tmux send-keys -K "$(tmux_key "$key")"
}

if [ "${1:-}" = "--preview" ]; then
	preview "${2:-}"
else
	pick
fi
