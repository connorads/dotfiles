#!/usr/bin/env sh
# Detection + classification tests over real ANSI banner fixtures.
# Drives watcher.sh's __detect / __classify entrypoints — no tmux needed.
set -u

# shellcheck disable=SC1007
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WATCHER="$DIR/../watcher.sh"
FIX="$DIR/fixtures"
fails=0

# Fixed "now" so calendar maths is deterministic: 2026-05-31 13:00 in Santiago.
# 3pm is 2h away (< 6h ceiling -> five-hour); Oct 6 is months away (-> over-ceiling).
NOW=$(python3 -c "from datetime import datetime; from zoneinfo import ZoneInfo; print(int(datetime(2026,5,31,13,0,tzinfo=ZoneInfo('America/Santiago')).timestamp()))")

expect_detect() {  # $1 fixture, $2 = yes|no
  if sh "$WATCHER" __detect < "$FIX/$1" >/dev/null 2>&1; then got=yes; else got=no; fi
  want=$2
  if [ "$got" != "$want" ]; then
    echo "  - detect $1: want $want, got $got"; fails=$((fails + 1))
  fi
}

expect_class() {  # $1 fixture, $2 = none|five-hour|over-ceiling
  got=$(sh "$WATCHER" __classify --now "$NOW" < "$FIX/$1" 2>/dev/null)
  if [ "$got" != "$2" ]; then
    echo "  - classify $1: want $2, got '$got'"; fails=$((fails + 1))
  fi
}

# Positive: the two banner forms + the wrapped (within-6-lines) render.
expect_detect 5h-banner.txt yes
expect_detect weekly-opus.txt yes
expect_detect wrapped-banner.txt yes
# Negative: ordinary output with limit-ish words but no reset line.
expect_detect normal-output.txt no
expect_detect mid-stream.txt no

# Classification routes the wait decision.
expect_class 5h-banner.txt five-hour
expect_class wrapped-banner.txt five-hour
expect_class weekly-opus.txt over-ceiling
expect_class normal-output.txt none
expect_class mid-stream.txt none

if [ "$fails" -ne 0 ]; then
  echo "FAIL: $fails detection assertion(s) failed"
  exit 1
fi
echo "ok - watcher.sh detection/classification: all fixtures passed"
