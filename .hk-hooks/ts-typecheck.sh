#!/usr/bin/env bash
# ts-typecheck: typecheck one first-party TS project with the global tsgo.
# Skips gracefully (warn, exit 0) when devDeps are declared but node_modules is
# absent, so fresh/offline machines aren't blocked; `mise run ts-checks` installs.
set -euo pipefail
root="$1"
cd "$HOME/$root" 2>/dev/null || {
	echo "ts-typecheck: $root missing, skipping" >&2
	exit 0
}
if [ -f package.json ] && grep -q '"devDependencies"' package.json && [ ! -d node_modules ]; then
	echo "ts-typecheck: skipping $root (node_modules absent; run 'mise run ts-checks')" >&2
	exit 0
fi
exec tsgo -p tsconfig.json
