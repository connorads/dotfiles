#!/usr/bin/env bash
# py-tests: run first-party Python project gates. Two modes:
#   py-tests.sh <staged-file>...   only the projects those files touch (hk)
#   py-tests.sh --all              every discovered project under ROOTS
# A project is the nearest ancestor directory holding a pyproject.toml. In each
# one, inside its own uv environment (`uv run --group dev`, so the plugins the
# project's pytest config requires are the ones that load):
#   - pytest -c pyproject.toml          the suite, with the project's strict config
#   - lint-imports --no-cache           if pyproject declares [tool.importlinter]
#   - deptry <src dir>                  if pyproject declares [tool.deptry]
# Missing uv warns and exits 0 - the gate never bricks a commit it can't
# evaluate (same posture as ts-tests.sh / py-typecheck.sh). A failing gate
# exits 1: that is the point.
#
# One discovering step rather than one step per project, so a project added
# tomorrow is gated the day it exists; gate-coverage.py asserts every
# pyproject.toml root is reachable through hk's glob and this ROOTS list.
set -euo pipefail

cd "$HOME"

# Test suites must not inherit the bare-repo GIT_DIR/GIT_WORK_TREE the hook
# wrappers export: a bare `git` in a suite would target the dotfiles repo.
unset GIT_DIR GIT_WORK_TREE

# Invariant: these roots are duplicated in hk.pkl's `py-tests-scoped` glob;
# gate-coverage.py asserts the two agree.
ROOTS="src/handoff"

# Whether a tool can actually RUN, not merely resolve - a mise shim resolves on
# a machine with no version set and then exits 1.
runs() { command -v "$1" >/dev/null 2>&1 && "$@" >/dev/null 2>&1; }

if ! runs uv --version; then
	echo "py-tests: uv absent; skipping (run 'mise install')" >&2
	exit 0
fi

project_of() {
	local dir=${1#"$HOME"/}
	dir=$(dirname "$dir")
	while [ "$dir" != "." ] && [ "$dir" != "/" ]; do
		if [ -f "$dir/pyproject.toml" ]; then
			printf '%s\n' "$dir"
			return 0
		fi
		dir=$(dirname "$dir")
	done
	return 0
}

if [ "${1:-}" = "--all" ]; then
	roots_present=""
	for root in $ROOTS; do
		if [ -d "$root" ]; then roots_present="${roots_present:+$roots_present }$root"; fi
	done
	if [ -z "$roots_present" ]; then exit 0; fi
	# shellcheck disable=SC2086  # deliberate split: a fixed, space-free root list
	projects=$(find $roots_present -name pyproject.toml -not -path '*/.venv/*' |
		sed 's#/pyproject\.toml$##' | sort -u)
else
	projects=$(for f in "$@"; do project_of "$f"; done | sort -u)
fi

fail=0
for project in $projects; do
	[ -f "$project/pyproject.toml" ] || continue
	echo "py-tests: pytest ($project)"
	# `-c pyproject.toml` pins the config source: a stray tests/pytest.ini would
	# otherwise become rootdir config and silently drop every strict_* key.
	# Failures accumulate so one broken project cannot mask another.
	(cd "$project" && uv run --group dev pytest -c pyproject.toml) || fail=1
	if grep -q '^\[tool\.importlinter\]' "$project/pyproject.toml"; then
		echo "py-tests: lint-imports ($project)"
		# lint-imports takes no filenames and its cache is not concurrency-safe.
		(cd "$project" && uv run --group dev lint-imports --no-cache) || fail=1
	fi
	if grep -q '^\[tool\.deptry\]' "$project/pyproject.toml"; then
		echo "py-tests: deptry ($project)"
		(cd "$project" && uv run --group dev deptry src) || fail=1
	fi
done

exit $fail
