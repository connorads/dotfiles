#!/usr/bin/env bash
# Usage: build.sh <new source directory> <new install directory>
set -euo pipefail

scripts=$(cd "$(dirname "$0")" && pwd)
work=${1:?Pass a new source directory}
install=${2:?Pass a new install directory}
if [ -e "$install" ]; then
	echo "Install directory exists: $install" >&2
	exit 1
fi

"$scripts/prepare.sh" "$work"
cd "$work"
export TURBO_TELEMETRY_DISABLED=1
pnpm install --frozen-lockfile
pnpm run prepare
pnpm exec turbo run build --filter=bb-app --output-logs=errors-only
pnpm --filter bb-app deploy --prod "$install"
{
	git rev-parse HEAD
	(cd "$scripts/../patches" && shasum -a 256 ./*.patch)
} >"$install/.bb-source-revision"
