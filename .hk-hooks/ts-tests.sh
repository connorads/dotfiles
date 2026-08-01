#!/usr/bin/env bash
# ts-tests: run first-party TypeScript project test suites. Two modes:
#   ts-tests.sh <staged-file>...   only the projects those files touch (hk)
#   ts-tests.sh --all              every discovered project declaring scripts.test
# A missing runner, jq, or node_modules warns and exits 0 - the gate never
# bricks a commit it can't evaluate (same posture as ts-typecheck.sh /
# bats-tests.sh). A failing suite exits 1: that is the point of the gate.
#
# One discovering step rather than one step per project, so a project added
# tomorrow is gated the day it exists - the enumeration trap that left
# .pi/agent/extensions/agent-guard ungated is exactly what this avoids.
set -euo pipefail

cd "$HOME"

# The dhk and pre-commit wrappers export GIT_DIR/GIT_WORK_TREE for the bare-repo
# layout and hk passes them to every step. Test suites must not inherit them: a
# bare `git` in a suite would target the real dotfiles repo instead of its own
# fixture, and GIT_DIR beats cwd discovery, so a suite's `cd` into a temp repo is
# no defence.
unset GIT_DIR GIT_WORK_TREE

# Invariant: these roots are duplicated in hk.pkl's `ts-tests-scoped` glob.
# Keep the two in step - a root here that hk doesn't glob is never reached at
# commit time, and a root hk globs but this misses is a silent skip.
ROOTS=".config/skl src/pin-audit .pi/agent/extensions"

if ! command -v jq >/dev/null 2>&1; then
	echo "ts-tests: jq absent; skipping (run 'mise run ts-checks')" >&2
	exit 0
fi

# The project a file belongs to: the nearest ancestor directory holding a
# package.json. So agent-guard/guard.ts resolves to agent-guard, while
# web-search/core.mjs (no package.json of its own) resolves to the extensions
# dir above it. Walking stops at the work-tree root - there is no ~/package.json.
project_of() {
	local dir=${1#"$HOME"/}
	dir=$(dirname "$dir")
	while [ "$dir" != "." ] && [ "$dir" != "/" ]; do
		if [ -f "$dir/package.json" ]; then
			printf '%s\n' "$dir"
			return 0
		fi
		dir=$(dirname "$dir")
	done
	return 0
}

# The package manager, read off the lockfile rather than hardcoded, walking up
# for a project that shares its parent's lockfile. Always `run test`, never a
# runner directly, so the project's own scripts.test stays the single source of
# truth - that is what keeps node --test, vitest run and bun test all working
# through one dispatch.
runner_of() {
	local dir=$1
	while :; do
		if [ -f "$dir/bun.lock" ]; then
			printf 'bun\n'
			return 0
		fi
		if [ -f "$dir/pnpm-lock.yaml" ]; then
			printf 'pnpm\n'
			return 0
		fi
		[ "$dir" != "." ] || return 1
		dir=$(dirname "$dir")
	done
}

if [ "${1:-}" = "--all" ]; then
	roots_present=""
	for root in $ROOTS; do
		if [ -d "$root" ]; then roots_present="${roots_present:+$roots_present }$root"; fi
	done
	if [ -z "$roots_present" ]; then exit 0; fi
	# shellcheck disable=SC2086  # deliberate split: a fixed, space-free root list
	projects=$(find $roots_present -name package.json -not -path '*/node_modules/*' |
		sed 's#/package\.json$##' | sort -u)
else
	projects=$(for f in "$@"; do project_of "$f"; done | sort -u)
fi

fail=0
for project in $projects; do
	[ -f "$project/package.json" ] || continue

	# A project with no test script is skipped silently: agent-state and the
	# typecheck-only tooling packages are legitimately test-free.
	if [ -z "$(jq -r '.scripts.test // empty' "$project/package.json" 2>/dev/null)" ]; then
		continue
	fi

	if ! runner=$(runner_of "$project"); then
		echo "ts-tests: no lockfile for $project; skipping" >&2
		continue
	fi

	if ! command -v "$runner" >/dev/null 2>&1; then
		echo "ts-tests: $runner absent; skipping $project (run 'mise run ts-checks')" >&2
		continue
	fi

	if [ ! -d "$project/node_modules" ]; then
		echo "ts-tests: skipping $project (node_modules absent; run 'mise run ts-checks')" >&2
		continue
	fi

	echo "ts-tests: $runner run test ($project)"
	# Failures accumulate rather than exiting early, so one broken project
	# cannot mask another.
	(cd "$project" && "$runner" run test) || fail=1
done

exit $fail
