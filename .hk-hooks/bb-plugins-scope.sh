#!/usr/bin/env bash
# bb-plugins-scope: the src/bb-plugins packages a set of staged files can break,
# one dir per line, for the bb-plugins typecheck and test gates.
#
# A package is a top-level dir with a package.json (pnpm-workspace.yaml's
# `packages: ['*']`), so spikes/ and docs/ are never selected. A staged file
# selects its package plus every package that depends on it through a
# `workspace:` range, transitively: a chip/ change breaks the plugins that
# import @bb-plugins/chip, not chip alone. A staged workspace root file
# (pnpm-workspace.yaml, pnpm-lock.yaml, package.json) selects every package,
# because the catalog pins the SDK and shared deps for all of them.
#
# Paths are relative to cwd, which is the work-tree root. Without jq the
# dependants cannot be read, so it warns and prints the staged packages only.
set -euo pipefail

ws=src/bb-plugins
all=false
changed=()
for f in "$@"; do
	case $f in
	*"$ws"/*) ;;
	*) continue ;;
	esac
	r=${f#*"$ws"/}
	case $r in
	pnpm-workspace.yaml | pnpm-lock.yaml | package.json) all=true ;;
	*/*)
		d=$ws/${r%%/*}
		if [ -f "$d/package.json" ]; then changed+=("$d"); fi
		;;
	esac
done

packages=()
for p in "$ws"/*/package.json; do
	if [ -f "$p" ]; then packages+=("${p%/package.json}"); fi
done

if $all; then
	printf '%s\n' "${packages[@]}" | sort -u
	exit 0
fi
if [ ${#changed[@]} -eq 0 ]; then exit 0; fi

if ! command -v jq >/dev/null 2>&1 || ! jq --version >/dev/null 2>&1; then
	echo "bb-plugins-scope: jq absent; checking staged packages without their dependants" >&2
	printf '%s\n' "${changed[@]}" | sort -u
	exit 0
fi

# One line per package: dir, name, then the names it takes from the workspace.
graph=$(for d in "${packages[@]}"; do
	jq -r --arg d "$d" '[$d, .name] + [(.dependencies, .devDependencies, .peerDependencies, .optionalDependencies)
		| objects | to_entries[] | select(.value | tostring | startswith("workspace:")) | .key] | join(" ")' "$d/package.json"
done)

selected=" ${changed[*]} "
names=" "
for d in "${changed[@]}"; do
	names="$names$(printf '%s\n' "$graph" | awk -v d="$d" '$1 == d { print $2 }') "
done

# Fixed point: add any package that depends on a selected name until none is left.
grew=true
while $grew; do
	grew=false
	while read -r d name deps; do
		case $selected in *" $d "*) continue ;; esac
		for dep in $deps; do
			case $names in
			*" $dep "*)
				selected="$selected$d "
				names="$names$name "
				grew=true
				break
				;;
			esac
		done
	done <<<"$graph"
done

read -ra out <<<"$selected"
printf '%s\n' "${out[@]}" | sort -u
