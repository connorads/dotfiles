#!/usr/bin/env bash
# resurrect-strip-nix-paths.sh: post-save hook for tmux-resurrect
# Strip /nix/store/<hash>/bin/ prefixes from saved process names so that
# session restore works after nix-collect-garbage or flake updates.
# Without this, tmux-resurrect can't find executables whose store paths changed.
# ref: https://discourse.nixos.org/t/30819
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

SAVE_FILE="$1"
[[ -f "$SAVE_FILE" ]] || exit 0

# macOS (BSD) sed requires '' for -i; GNU sed doesn't
if [[ "$(uname)" == "Darwin" ]]; then
	sed -i '' 's|/nix/store/[^/]*/bin/||g' "$SAVE_FILE"
else
	sed -i 's|/nix/store/[^/]*/bin/||g' "$SAVE_FILE"
fi
