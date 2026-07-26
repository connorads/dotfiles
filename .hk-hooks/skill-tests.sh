#!/usr/bin/env bash
# skill-tests: run colocated tests (tests/*.py via pytest, tests/*.bats via
# bats) for authored skills. Two modes:
#   skill-tests.sh <staged-file>...   only skills touched by those files (hk)
#   skill-tests.sh --all              every authored skill with a tests/ dir
# Missing runners (uv, bats) warn and skip - the gate never bricks a commit
# it can't evaluate (same posture as ts-typecheck.sh).
set -euo pipefail

cd "$HOME"

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
		if command -v uv >/dev/null 2>&1; then
			echo "skill-tests: pytest $root"
			(cd "$root" && uv run --quiet --with pytest -- pytest tests/ -q) || fail=1
		else
			echo "skill-tests: uv absent; skipping pytest in $root" >&2
		fi
	fi

	if compgen -G "$tests_dir/*.bats" >/dev/null; then
		if command -v bats >/dev/null 2>&1; then
			echo "skill-tests: bats $root"
			bats "$tests_dir" || fail=1
		else
			echo "skill-tests: bats absent; skipping bats in $root" >&2
		fi
	fi
done
exit $fail
