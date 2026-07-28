#!/usr/bin/env bash
# vox-popup.sh — prefix + Alt+Shift+V recording library. fzf over `vox ls`,
# previewing each recording's transcript, so the thing you actually want (the
# text) is one keypress from wherever you are. Each row carries whether anyone
# else was on the call: `solo` or `2-way`, derived from the system track rather
# than stored.
#
#   enter    copy the transcript to the clipboard (tmux buffer + OSC52)
#   ctrl-y   paste the recording's path into the pane you opened this from
#   ctrl-e   open the transcript in $EDITOR
#   ctrl-r   rename, keeping the timestamp prefix
#   ctrl-o   reveal the recording in Finder
#   ctrl-p   play it (both tracks mixed, when there are two)
#   ctrl-d   delete the selection outright (confirmed)
#   ctrl-x   reclaim the selection's audio, keeping its transcripts (confirmed)
#   tab      add to the selection; ctrl-d/ctrl-x act on all of it
#   ctrl-/   toggle the preview
#
# Actions run *after* fzf exits (--expect), not inside --bind execute(), so each
# one owns the popup's real tty — which $EDITOR, the rename prompt and both
# confirmations need.
#
# Deleting is `rm -rf`, but reclaiming defers to `vox prune <path>...` rather
# than removing audio here: one implementation of "which files are the audio,
# and what survives" is the reason the CLI grew explicit paths.
#
#   vox-popup.sh preview <dir>   # internal: the --preview command
# --- bash5 re-exec preamble: keep 3.2-parseable, keep above `set -u` ---
# macOS ships bash 3.2 at /bin/bash and tmux hands it to run-shell. Re-exec under
# the nix bash 5 that is already installed but ordered behind /bin in PATH.
if [ "${BASH_VERSINFO[0]:-0}" -lt 5 ]; then
	if [ -n "${TMUX_BASH5_REEXEC:-}" ]; then
		printf '%s: re-exec did not yield bash >= 5 (got %s)\n' "${0##*/}" "${BASH_VERSION:-?}" >&2
		exit 127
	fi
	for _b5 in "/etc/profiles/per-user/${USER:-$LOGNAME}/bin/bash" \
		/run/current-system/sw/bin/bash "$HOME/.nix-profile/bin/bash" \
		/nix/var/nix/profiles/default/bin/bash /opt/homebrew/bin/bash; do
		if [ -x "$_b5" ]; then
			TMUX_BASH5_REEXEC=1
			export TMUX_BASH5_REEXEC
			exec "$_b5" "$0" ${1+"$@"}
		fi
	done
	printf '%s: requires bash >= 5, found %s\n' "${0##*/}" "${BASH_VERSION:-?}" >&2
	exit 127
fi
# Never inherited: each script guards itself, so a bash-5 parent must not
# suppress a 3.2 child's own re-exec.
unset TMUX_BASH5_REEXEC _b5
# --- end bash5 preamble ---

set -uo pipefail

# shellcheck disable=SC1007  # `CDPATH= cd` is the env-prefix idiom
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# The tmux server's PATH does not carry ~/.local/bin, so resolve the command
# rather than assuming the popup shell inherited it.
VOX_BIN=${VOX_BIN:-$HOME/.local/bin/vox}
OSC52="$SELF_DIR/osc52-copy-to-client.sh"
# shellcheck source=/dev/null
. "$SELF_DIR/vox-lib.sh"

# preview DIR — the transcript, or an honest note about what is there instead.
preview() {
	local dir=${1:-}
	[ -d "$dir" ] || return 0
	if [ -s "$dir/transcript.md" ]; then
		cat "$dir/transcript.md"
	else
		printf 'No transcript yet.\n\n'
		ls -lh "$dir"
	fi
}

if [ "${1:-}" = preview ]; then
	preview "${2:-}"
	exit 0
fi

# The pane this popup was summoned from. A popup is a client overlay and does
# NOT change which pane is active, so querying here returns the origin pane —
# and unlike passing #{pane_id} from the keybind, it actually expands (a
# display-popup -E command string reaches the shell verbatim).
pane=$(tmux display-message -p '#{pane_id}' 2>/dev/null || true)

# Opening the library IS looking: it clears the READY pill, whether or not you
# then pick anything. One write, no record of what was read.
vox_touch_seen

rows=""
while IFS= read -r dir; do
	[ -n "$dir" ] || continue
	rows+="$dir"$'\t'"${dir##*/}"$'\t'"$(vox_session_kind "$dir")"$'\t'"$(du -sh "$dir" 2>/dev/null | cut -f1)"$'\n'
done < <("$VOX_BIN" ls 2>/dev/null)

if [ -z "$rows" ]; then
	printf 'No recordings yet - run "vox" to start one.\n'
	sleep 1.2
	exit 0
fi

out=$(printf '%s' "$rows" | fzf \
	--reverse --multi --info=hidden \
	--delimiter=$'\t' --with-nth=2.. \
	--prompt='recording › ' \
	--header='enter: copy · ctrl-y: path · ctrl-e: edit · ctrl-r: rename · ctrl-o: reveal · ctrl-p: play · ctrl-d: delete · ctrl-x: reclaim audio · tab: select' \
	--preview "'$0' preview {1}" \
	--preview-window='right,60%,wrap' \
	--bind 'ctrl-/:toggle-preview' \
	--expect 'ctrl-y,ctrl-e,ctrl-r,ctrl-o,ctrl-p,ctrl-d,ctrl-x') || exit 0

# Line 1 is the expected key ("" for enter); every line after it is a selected
# row, one per tab-marked entry.
mapfile -t lines <<<"$out"
key=${lines[0]}
dirs=()
for line in "${lines[@]:1}"; do
	[ -n "$line" ] || continue
	dirs+=("${line%%$'\t'*}")
done
((${#dirs[@]})) || exit 0
dir=${dirs[0]}

# confirm PROMPT — y/N on the popup's own tty. Only the two destructive actions
# ask; everything else is undoable by doing it again.
confirm() {
	local answer
	read -r -p "$1 [y/N] " answer
	case "$answer" in
	y | Y | yes | YES) return 0 ;;
	esac
	printf 'cancelled\n'
	sleep 0.8
	return 1
}

case "$key" in
ctrl-y)
	[ -n "$pane" ] && tmux send-keys -t "$pane" -l "$dir"
	;;
ctrl-e)
	"${EDITOR:-vi}" "$dir/transcript.md"
	;;
ctrl-r)
	printf 'Rename %s\n' "${dir##*/}"
	read -r -p 'new title (empty clears): ' slug
	if new=$("$VOX_BIN" rename "$dir" "$slug"); then
		printf 'renamed to %s\n' "${new##*/}"
	fi
	sleep 1
	;;
ctrl-o)
	# Finder is where the audio is playable, taggable and draggable; the store
	# convention means the directory name is already the title there.
	open -R "$dir" 2>/dev/null || printf 'could not reveal %s\n' "$dir"
	;;
ctrl-p)
	# Both halves of a conversation, or whichever half exists. Mixing needs a
	# temp file because afplay cannot read a pipe.
	tracks=()
	for track in "$dir"/mic.wav "$dir"/sys.wav "$dir"/mic.opus "$dir"/sys.opus; do
		[ -s "$track" ] && tracks+=("$track")
	done
	if ((${#tracks[@]} == 0)); then
		printf 'no audio left in %s (pruned?)\n' "${dir##*/}"
		sleep 1.2
	elif ((${#tracks[@]} == 1)); then
		printf 'playing %s — ctrl-c to stop\n' "${dir##*/}"
		afplay "${tracks[0]}" 2>/dev/null
	else
		scratch=$(mktemp -d)
		mix="$scratch/mix.wav"
		printf 'mixing %s…\n' "${dir##*/}"
		if ffmpeg -hide_banner -loglevel error -y -i "${tracks[0]}" -i "${tracks[1]}" \
			-filter_complex 'amix=inputs=2:duration=longest:normalize=0' "$mix" 2>/dev/null; then
			printf 'playing %s — ctrl-c to stop\n' "${dir##*/}"
			afplay "$mix" 2>/dev/null
		else
			afplay "${tracks[0]}" 2>/dev/null
		fi
		rm -rf "$scratch"
	fi
	;;
ctrl-d)
	printf 'Delete %d recording(s), transcripts included:\n' "${#dirs[@]}"
	printf '  %s\n' "${dirs[@]##*/}"
	if confirm 'DELETE outright?'; then
		rm -rf "${dirs[@]}"
		tmux display-message "vox: deleted ${#dirs[@]} recording(s)" 2>/dev/null || true
	fi
	;;
ctrl-x)
	# The CLI owns which files count as audio and what survives; the picker only
	# says which recordings.
	printf 'Reclaim audio from %d recording(s), keeping transcripts:\n' "${#dirs[@]}"
	printf '  %s\n' "${dirs[@]##*/}"
	if confirm 'DELETE their audio?'; then
		"$VOX_BIN" prune --force "${dirs[@]}" >/dev/null
		sleep 0.8
	fi
	;;
*)
	# Default (enter): the transcript to the clipboard. tmux buffer with -w for
	# terminals that honour set-clipboard, plus OSC52 to the client tty — the
	# reliable path over SSH, same pair as copy-pane-info.sh.
	if [ -s "$dir/transcript.md" ]; then
		tmux load-buffer -w "$dir/transcript.md" 2>/dev/null || true
		[ -x "$OSC52" ] && "$OSC52" <"$dir/transcript.md"
		tmux display-message "copied transcript: ${dir##*/}" 2>/dev/null || true
	else
		tmux display-message "no transcript in ${dir##*/}" 2>/dev/null || true
	fi
	;;
esac
