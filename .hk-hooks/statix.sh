#!/usr/bin/env bash
# statix: nix anti-pattern lint, one staged file at a time.
#
# statix takes a single TARGET, not a file list, so `statix check {{files}}`
# fails with "unexpected argument" the moment two nix files are staged. The
# alternative - pointing it at a directory - would decouple the step's glob from
# what it actually scans, so a .nix file added outside that directory would be
# globbed in and then never looked at. Targeting the whole work-tree is not an
# option either: statix respects .gitignore, and ~/.gitignore denies /* before
# un-ignoring tracked paths, so a repo-root scan from $HOME walks into nothing.
#
# Usage: statix.sh check|fix <file>...
#
# Relative paths on purpose: hk runs steps from the work-tree root, which is
# $HOME locally but the checkout dir in CI.
set -euo pipefail

# Whether a tool can actually RUN, not merely resolve. `command -v` is not
# enough: mise plants a shim on PATH for every tool in its registry, so the name
# resolves on a machine where no version is set - and the shim then exits 1
# ("No version is set for shim"), turning this warn-and-skip into a hard failure.
# statix is nix-installed rather than mise-managed, but the posture is the same:
# never brick a commit over a checker this host cannot run.
runs() { command -v "$1" >/dev/null 2>&1 && "$@" >/dev/null 2>&1; }

mode=$1
shift

# `statix list`, not `--version`: statix has no --version flag at all (it exits
# 2 on "unexpected argument"), and a probe that always fails would make this a
# permanent silent skip - the exact fail-open this gate exists to avoid.
if ! runs statix list; then
	echo "statix: absent; skipping (nix-installed via .config/nix/modules/packages.nix)" >&2
	exit 0
fi

fail=0
for f in "$@"; do
	[ -f "$f" ] || continue # deleted paths can still be in the staged list
	statix "$mode" --config .hk-hooks/statix.toml "$f" || fail=1
done
exit $fail
