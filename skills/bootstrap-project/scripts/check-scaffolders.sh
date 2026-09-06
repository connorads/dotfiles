#!/bin/sh
# check-scaffolders: opt-in network freshness check for bootstrap recipes.

set -u

recipes='cloudflare-tanstack-start cloudflare-astro-static cloudflare-foldkit-alchemy vite-react-ts python-app python-library rust-cli rust-library typescript-cli typescript-library'
selected=
output=

usage() {
	printf '%s\n' 'usage: check-scaffolders.sh [--recipe ID] [--output DIR]'
}

while [ "$#" -gt 0 ]; do
	case "$1" in
	--recipe)
		[ "$#" -ge 2 ] || {
			usage >&2
			exit 2
		}
		selected=$2
		shift 2
		;;
	--output)
		[ "$#" -ge 2 ] || {
			usage >&2
			exit 2
		}
		output=$2
		shift 2
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		printf 'ERROR unknown argument: %s\n' "$1" >&2
		usage >&2
		exit 2
		;;
	esac
done

if [ -n "$selected" ]; then
	case " $recipes " in *" $selected "*) recipes=$selected ;; *)
		printf 'ERROR unknown recipe: %s\n' "$selected" >&2
		exit 2
		;;
	esac
fi

if [ -z "$output" ]; then
	output=$(mktemp -d "${TMPDIR:-/tmp}/bootstrap-scaffolders.XXXXXX") || exit 2
else
	mkdir -p "$output" || exit 2
	output=$(cd "$output" && pwd)
fi

printf 'NOTICE uses the network and executes third-party scaffolder package code\n'
printf 'OUTPUT %s\n' "$output"

failures=0
run_recipe() {
	id=$1
	dest="$output/$id"
	log="$output/$id.log"
	case "$id" in
	cloudflare-tanstack-start)
		command -v pnpm >/dev/null 2>&1 || return 2
		pnpm create cloudflare@latest "$dest" --framework=tanstack-start --platform=workers --no-deploy --no-git --no-open >"$log" 2>&1
		;;
	cloudflare-astro-static)
		command -v pnpm >/dev/null 2>&1 || return 2
		pnpm create astro@latest "$dest" --template minimal --no-install --no-git --no-ai --yes --skip-houston >"$log" 2>&1
		;;
	cloudflare-foldkit-alchemy)
		command -v pnpm >/dev/null 2>&1 || return 2
		pnpm dlx create-foldkit-app "$dest" >"$log" 2>&1
		;;
	vite-react-ts)
		command -v pnpm >/dev/null 2>&1 || return 2
		pnpm create vite@latest "$dest" --template react-ts --no-interactive --no-immediate >"$log" 2>&1
		;;
	python-app)
		command -v uv >/dev/null 2>&1 || return 2
		uv init --app --python 3.13 --vcs none --author-from none --no-workspace "$dest" >"$log" 2>&1
		;;
	python-library)
		command -v uv >/dev/null 2>&1 || return 2
		uv init --lib --python 3.13 --vcs none --author-from none --no-workspace "$dest" >"$log" 2>&1
		;;
	rust-cli)
		command -v cargo >/dev/null 2>&1 || return 2
		cargo new --bin --edition 2024 --vcs none "$dest" >"$log" 2>&1
		;;
	rust-library)
		command -v cargo >/dev/null 2>&1 || return 2
		cargo new --lib --edition 2024 --vcs none "$dest" >"$log" 2>&1
		;;
	typescript-cli | typescript-library)
		command -v pnpm >/dev/null 2>&1 || return 2
		mkdir -p "$dest" || return 1
		(cd "$dest" && pnpm init --bare) >"$log" 2>&1
		;;
	esac
	status=$?
	[ "$status" -eq 0 ] || return "$status"
	[ -d "$dest" ] || return 1
	case "$id" in
	python-*) [ -f "$dest/pyproject.toml" ] ;;
	rust-*) [ -f "$dest/Cargo.toml" ] ;;
	*) [ -f "$dest/package.json" ] ;;
	esac
}

for id in $recipes; do
	if run_recipe "$id"; then
		printf 'PASS %s\n' "$id"
	else
		status=$?
		if [ "$status" -eq 2 ]; then
			printf 'ERROR %s missing required scaffolder command\n' "$id" >&2
			exit 2
		fi
		printf 'FAIL %s - inspect %s/%s.log\n' "$id" "$output" "$id"
		failures=$((failures + 1))
	fi
done

[ "$failures" -eq 0 ] || exit 1
