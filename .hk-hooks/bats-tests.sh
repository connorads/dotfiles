#!/usr/bin/env bash
# bats-tests: run the zsh bats suites (.config/zsh/tests). Two modes:
#   bats-tests.sh <staged-file>...   only the suites those files touch (hk)
#   bats-tests.sh --all              the whole suite, via `mise run zsh-tests`
# A missing runner warns and exits 0 - the gate never bricks a commit it can't
# evaluate (same posture as ts-typecheck.sh / skill-tests.sh).
set -euo pipefail

cd "$HOME"

# The dhk and pre-commit wrappers export GIT_DIR/GIT_WORK_TREE for the bare-repo
# layout and hk passes them to every step. Test suites must not inherit them: a
# bare `git` in a suite would target the real dotfiles repo instead of its own
# fixture, and GIT_DIR beats cwd discovery, so a suite's `cd` into a temp repo is
# no defence.
unset GIT_DIR GIT_WORK_TREE

TESTS_DIR=.config/zsh/tests

if ! command -v bats >/dev/null 2>&1; then
	echo "bats-tests: bats absent; skipping (run 'mise run zsh-tests')" >&2
	exit 0
fi

if [[ ${1:-} == "--all" ]]; then
	# Delegate so the -j / rush wiring stays defined in one place.
	if ! command -v mise >/dev/null 2>&1; then
		echo "bats-tests: mise absent; skipping full suite" >&2
		exit 0
	fi
	exec mise run zsh-tests
fi

# A staged suite runs itself. A staged script runs the suite named after it,
# plus any suite that names it - `-w` so a short stem like `rl` matches
# `rl-kill` but not `curl`.
suites=$(
	for f in "$@"; do
		case $f in
		"$TESTS_DIR"/*.bats)
			echo "$f"
			;;
		.config/zsh/functions/* | .config/tmux/scripts/*)
			stem=$(basename "$f")
			stem=${stem%.sh}
			if [[ -f $TESTS_DIR/$stem.bats ]]; then
				echo "$TESTS_DIR/$stem.bats"
			fi
			grep -rlw --include='*.bats' -- "$stem" "$TESTS_DIR" 2>/dev/null || true
			;;
		# pin-audit's implementation is TypeScript under ~/src; the bats suite
		# is still its CLI contract, so staged sources have to run it.
		src/pin-audit/*)
			echo "$TESTS_DIR/pin-audit.bats"
			;;
		esac
	done | sort -u
)

if [[ -z $suites ]]; then
	exit 0
fi

echo "bats-tests: $(echo "$suites" | wc -l | tr -d ' ') suite(s)"
# shellcheck disable=SC2086  # newline-separated paths, none contain spaces
exec bats $suites
