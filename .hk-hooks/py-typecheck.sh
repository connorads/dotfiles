#!/usr/bin/env bash
# py-typecheck: typecheck one first-party Python dir with the global pyrefly.
# Skips gracefully (warn, exit 0) when pyrefly is not on PATH, so fresh/offline
# machines aren't blocked; `mise install` / `mise run py-checks` provisions it.
set -euo pipefail
root="$1"
cd "$HOME/$root" 2>/dev/null || {
	echo "py-typecheck: $root missing, skipping" >&2
	exit 0
}
if ! command -v pyrefly >/dev/null 2>&1; then
	echo "py-typecheck: skipping $root (pyrefly absent; run 'mise install')" >&2
	exit 0
fi
exec pyrefly check
