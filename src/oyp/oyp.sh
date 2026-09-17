#!/usr/bin/env bash
# oyp: open the current GitHub PR in Oyo, or the local review when no PR exists
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

main() {
	command -v oy >/dev/null || {
		printf 'oyo: oy is not installed. Run mise install github:ahkohd/oyo.\n' >&2
		return 127
	}
	if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
		if [[ $PWD == "$HOME" && -d $HOME/git/dotfiles ]]; then
			export GIT_DIR="$HOME/git/dotfiles" GIT_WORK_TREE="$HOME"
		else
			oy
			return $?
		fi
	fi

	local pr number state url repo remote remote_url candidate revision pulled
	local -a matches=()
	git symbolic-ref --quiet HEAD >/dev/null || {
		oy
		return $?
	}
	local tool
	for tool in gh jq; do
		command -v "$tool" >/dev/null || {
			printf 'oyo: %s is not installed.\n' "$tool" >&2
			return 127
		}
	done

	if ! pr=$(gh pr view --json number,state,url 2>&1); then
		# gh uses exit 1 for both missing PRs and transport/authentication errors.
		if [[ $pr == 'no pull requests found' || $pr == 'no pull requests found for branch "'*'"' ]]; then
			oy
			return $?
		fi
		printf '%s\n' "$pr" >&2
		return 1
	fi
	state=$(jq -er '.state | select(. == "OPEN" or . == "CLOSED" or . == "MERGED")' <<<"$pr") || return 1
	if [[ $state != OPEN ]]; then
		oy
		return $?
	fi
	number=$(jq -er '.number | numbers' <<<"$pr") || return 1
	url=$(jq -er '.url | strings' <<<"$pr") || return 1
	repo=${url#https://}
	repo=${repo%/pull/*}

	while IFS= read -r remote; do
		remote_url=$(git remote get-url "$remote") || return 1
		case $remote_url in
		https://*) candidate=${remote_url#https://} ;;
		ssh://git@*) candidate=${remote_url#ssh://git@} ;;
		git@*:*)
			candidate=${remote_url#git@}
			candidate=${candidate/:/\/}
			;;
		*) continue ;;
		esac
		candidate=${candidate%/}
		candidate=${candidate%.git}
		if [[ ${candidate,,} == "${repo,,}" ]]; then
			matches+=("$remote")
		fi
	done < <(git remote)
	case ${#matches[@]} in
	0)
		printf 'oyo: No remote matches %s. Add the PR base repository as a remote.\n' "$repo" >&2
		return 1
		;;
	1) remote=${matches[0]} ;;
	*)
		printf 'oyo: Multiple remotes match %s. Use oy review pull with an explicit remote.\n' "$repo" >&2
		return 1
		;;
	esac
	pulled=$(oy review pull "$number" "$remote" --json) || return $?
	revision=$(jq -er '.revision | strings | select(length > 0)' <<<"$pulled") || {
		printf 'oyo: Review pull returned no revision.\n' >&2
		return 1
	}
	oy --range "$revision"
}

main
