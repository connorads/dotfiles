#!/usr/bin/env bash
# skill-tests: run colocated tests (tests/*.py via pytest, tests/*.bats via
# bats) for authored skills. Two modes:
#   skill-tests.sh <staged-file>...   only skills touched by those files (hk)
#   skill-tests.sh --all              every authored skill with a tests/ dir
# Missing runners (uv, bats) warn and skip - the gate never bricks a commit
# it can't evaluate (same posture as ts-typecheck.sh).
set -euo pipefail

cd "$HOME"

# Whether a tool can actually RUN, not merely resolve. `command -v` is not
# enough: mise plants a shim on PATH for every tool in its registry, so the name
# resolves on a machine where no version is set - and the shim then exits 1
# ("No version is set for shim"), turning these warn-and-skips into hard
# failures.
runs() { command -v "$1" >/dev/null 2>&1 && "$@" >/dev/null 2>&1; }

# The dhk and pre-commit wrappers export GIT_DIR/GIT_WORK_TREE for the bare-repo
# layout and hk passes them to every step. Test suites must not inherit them: a
# bare `git` in a suite would target the real dotfiles repo instead of its own
# fixture, and GIT_DIR beats cwd discovery, so a suite's `cd` into a temp repo is
# no defence.
unset GIT_DIR GIT_WORK_TREE

# The case lives in a function, not inline in $(...): bash 3.2 (macOS
# /bin/bash) cannot parse unbalanced case-pattern parens inside command
# substitution.
skill_root() {
	case $1 in
	skills/*/*) echo "$1" | cut -d/ -f1-2 ;;
	.config/skills/personal/*/*) echo "$1" | cut -d/ -f1-4 ;;
	esac
}

if [[ ${1:-} == "--all" ]]; then
	roots=$(for dir in skills/*/tests .config/skills/personal/*/tests \
		.config/skills/private/*/tests; do
		if [[ -d $dir ]]; then dirname "$dir"; fi
	done | sort -u)
else
	roots=$(for f in "$@"; do skill_root "$f"; done | sort -u)
fi

fail=0
for root in $roots; do
	tests_dir="$root/tests"
	[[ -d $tests_dir ]] || continue

	if compgen -G "$tests_dir/*.py" >/dev/null; then
		if runs uv --version; then
			echo "skill-tests: pytest $root"
			(cd "$root" && uv run --quiet --with pytest -- pytest tests/ -q) || fail=1
		else
			echo "skill-tests: uv absent; skipping pytest in $root" >&2
		fi
	fi

	if compgen -G "$tests_dir/*.bats" >/dev/null; then
		if runs bats --version; then
			echo "skill-tests: bats $root"
			bats "$tests_dir" || fail=1
		else
			echo "skill-tests: bats absent; skipping bats in $root" >&2
		fi
	fi
done
exit $fail
