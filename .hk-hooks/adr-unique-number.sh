#!/usr/bin/env bash
# adr-unique-number: ADR numbers are never reused, so two `NNNN-` files in one
# ADR dir are a merge or authoring slip. Links cite the number, so a repeat
# makes "ADR 0011" ambiguous.
#
# Takes staged ADR files and checks every file in each one's dir, because the
# clash is usually with a record that is already committed.
set -euo pipefail

[[ $# -eq 0 ]] && exit 0

status=0
while IFS= read -r dir; do
	dupes=$(find "$dir" -maxdepth 1 -name '[0-9][0-9][0-9][0-9]-*.md' -exec basename {} \; |
		cut -c1-4 | sort | uniq -d)
	for n in $dupes; do
		echo "adr-unique-number: $dir has more than one $n-*.md:" >&2
		find "$dir" -maxdepth 1 -name "$n-*.md" >&2
		status=1
	done
done < <(dirname -- "$@" | sort -u)
exit "$status"
