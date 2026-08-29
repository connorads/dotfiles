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

# Whether a tool can actually RUN, not merely resolve. `command -v` is not
# enough: mise plants a shim on PATH for every tool in its registry, so the name
# resolves on a machine where no version is set - and the shim then exits 1
# ("No version is set for shim"), turning this warn-and-skip into a hard failure.
runs() { command -v "$1" >/dev/null 2>&1 && "$@" >/dev/null 2>&1; }

if ! runs bats --version; then
	echo "bats-tests: bats absent; skipping (run 'mise run zsh-tests')" >&2
	exit 0
fi

if [[ ${1:-} == "--all" ]]; then
	# Delegate so the -j / rush wiring stays defined in one place.
	if ! runs mise --version; then
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
		# The Connorads Vale style's only proof of life: two of its three rules
		# have zero corpus hits, so a clean `vale` run says nothing about
		# whether they load. Staging a rule runs the fixtures that do.
		.config/vale/*)
			echo "$TESTS_DIR/vale-style.bats"
			;;
		# pin-audit's implementation is TypeScript under ~/src; the bats suite
		# is still its CLI contract, so staged sources have to run it.
		src/pin-audit/*)
			echo "$TESTS_DIR/pin-audit.bats"
			;;
		# .zshenv sits under no functions/** root, so the stem rule cannot
		# reach it; name its suite explicitly.
		.zshenv)
			echo "$TESTS_DIR/zshenv.bats"
			;;
		# Same as .zshenv: no functions/** root reaches it, so the stem rule
		# cannot. Its suite guards what may write to stdout at the first
		# prompt, which is exactly what editing .zshrc puts at risk.
		.zshrc)
			echo "$TESTS_DIR/zshrc.bats"
			;;
		# skl's fzf picker is a shell script whose contract is a bats suite -
		# it drives the real bin/pick through fzf on a throwaway tmux socket.
		# Only bin/ maps here; the TS half is covered by ts-tests-scoped.
		src/skl/bin/*)
			echo "$TESTS_DIR/skl-pick.bats"
			;;
		# annotate's implementation is TypeScript under ~/src; the bats suite is
		# still its CLI contract and covers the copy-mode capture key, so staged
		# sources have to run it.
		src/annotate/*)
			echo "$TESTS_DIR/annotate.bats"
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
