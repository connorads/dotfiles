#!/usr/bin/env bash
# skills-no-local-paths: the authored skill tiers (skills/, personal/) are
# public, so they never name a path on this machine. A worked example that
# lives in a local repo is embedded as a snippet, not pointed at.
#
# Fails on `~/git/<real-name>`, `$HOME/git/<real-name>` and `/Users/<user>/`.
# Placeholders pass: `~/git/<name>` (angle brackets) and the generic users
# `me`, `you`, `alice`, `bob`, `<user>`.
set -euo pipefail

[[ $# -eq 0 ]] && exit 0

# shellcheck disable=SC2016  # the literal $HOME is the text being searched for
pattern='(~|\$HOME)/git/[A-Za-z0-9._-]|/Users/[A-Za-z0-9._-]+'
placeholders='/Users/(me|you|alice|bob|<)'

hits=$(grep -nEH "$pattern" "$@" 2>/dev/null | grep -vE "$placeholders" || true)
[[ -z $hits ]] && exit 0

echo "$hits"
echo "skills-no-local-paths: authored skills are public - embed the example, do not name a local path" >&2
exit 1
