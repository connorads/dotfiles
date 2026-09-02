#!/usr/bin/env bash
# py-typecheck: typecheck one first-party Python dir with the global pyrefly.
# Skips gracefully (warn, exit 0) when pyrefly is not on PATH, so fresh/offline
# machines aren't blocked; `mise install` / `mise run py-checks` provisions it.
set -euo pipefail

# Whether a tool can actually RUN, not merely resolve. `command -v` is not
# enough: mise plants a shim on PATH for every tool in its registry, so the name
# resolves on a machine where no version is set - and the shim then exits 1
# ("No version is set for shim"), turning this warn-and-skip into a hard failure.
runs() { command -v "$1" >/dev/null 2>&1 && "$@" >/dev/null 2>&1; }

root="$1"
cd "$HOME/$root" 2>/dev/null || {
	echo "py-typecheck: $root missing, skipping" >&2
	exit 0
}
if ! runs pyrefly --version; then
	echo "py-typecheck: skipping $root (pyrefly absent; run 'mise install')" >&2
	exit 0
fi
# -c is load-bearing: with no config found pyrefly falls back to the `basic`
# preset, which reports 0 errors on real type errors and exits 0. A missing or
# renamed pyrefly.toml must be a fatal configuration error, not a green gate.
exec pyrefly check -c pyrefly.toml
