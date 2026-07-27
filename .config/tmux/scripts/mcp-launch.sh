#!/usr/bin/env bash
# mcp-launch.sh: pick a Claude account + an mcpz bundle, then launch claude in a
# new window via `ccp <account> --mcp <bundle>` (prefix + Alt+c). Runs inside a
# display-popup, so it owns a real TTY for the two fzf pickers.
#
# Account isolation: a fresh tmux window can't inherit the origin pane's
# CLAUDE_CONFIG_DIR, so the account is chosen here explicitly and ccp relocates
# the profile. codex/opencode have no ccp-style profiles - use the bare `mcpz`
# picker for those.
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

set -euo pipefail

# ccp and mcpz are dual-mode zsh functions exposed via ~/.local/bin; the tmux
# server's PATH may not carry that dir.
export PATH="$HOME/.local/bin:$PATH"

cwd="${1:-$PWD}"

command -v fzf >/dev/null 2>&1 || {
	printf 'mcp-launch: fzf required\n' >&2
	exit 0
}

# default + discovered profiles, same shape ccp's own picker uses.
root="$HOME/.claude-profiles/code"
list_accounts() {
	printf 'default\n'
	[ -d "$root" ] || return 0
	for dir in "$root"/*/; do
		[ -d "$dir" ] || continue
		dir=${dir%/}
		printf '%s\n' "${dir##*/}"
	done
}
account=$(list_accounts | fzf --reverse --prompt='account> ') || exit 0
[ -n "$account" ] || exit 0

# Empty/registry-missing -> mcpz errors, fzf shows nothing, cancel exits 0.
bundle=$(mcpz list | fzf --reverse --prompt='bundle> ' \
	--preview 'mcpz show {}' --preview-window=right:60%) || exit 0
[ -n "$bundle" ] || exit 0

tmux new-window -c "$cwd" "ccp $account --mcp $bundle"
