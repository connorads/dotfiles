#!/usr/bin/env sh
# Run all claude-watch tests. Non-zero exit on any failure.
set -u
# shellcheck disable=SC1007
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
rc=0
python3 "$DIR/test-reset-time.py" || rc=1
sh "$DIR/test-detect.sh" || rc=1
exit "$rc"
