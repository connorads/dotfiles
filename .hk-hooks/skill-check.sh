#!/usr/bin/env bash
# skill-check: run writing-skills' check.sh on each authored skill touched by
# the staged files. Spec errors exit 1 and block the commit; hygiene warnings
# print but pass (same quiet-on-success split as the other hooks).
set -euo pipefail

CHECK="$HOME/skills/writing-skills/scripts/check.sh"
if [[ ! -x $CHECK ]]; then
	echo "skill-check: $CHECK missing or not executable; skipping" >&2
	exit 0
fi

# Map staged paths to their skill root: skills/<name>/... and
# .config/skills/personal/<name>/... . Files directly under skills/
# (e.g. skills/README.md) have no skill root and are skipped.
roots=$(for f in "$@"; do
	case $f in
	skills/*/*) echo "$f" | cut -d/ -f1-2 ;;
	.config/skills/personal/*/*) echo "$f" | cut -d/ -f1-4 ;;
	esac
done | sort -u)

fail=0
for root in $roots; do
	# A deleted skill leaves staged paths but no directory - nothing to check.
	[[ -d $root ]] || continue
	if ! bash "$CHECK" "$root"; then
		echo "skill-check: $root failed (spec errors above)" >&2
		fail=1
	fi
done
exit $fail
