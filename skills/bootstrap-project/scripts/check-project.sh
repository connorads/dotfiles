#!/bin/sh
# check-project: read-only conformance check for bootstrap-project recipes.

set -u

usage() {
	printf '%s\n' 'usage: check-project.sh --root DIR --recipe ID' >&2
}

root=
recipe=
while [ "$#" -gt 0 ]; do
	case "$1" in
	--root)
		[ "$#" -ge 2 ] || {
			usage
			exit 2
		}
		root=$2
		shift 2
		;;
	--recipe)
		[ "$#" -ge 2 ] || {
			usage
			exit 2
		}
		recipe=$2
		shift 2
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		printf 'ERROR unknown argument: %s\n' "$1" >&2
		usage
		exit 2
		;;
	esac
done

[ -n "$root" ] && [ -n "$recipe" ] || {
	usage
	exit 2
}
[ -d "$root" ] || {
	printf 'ERROR project root is not a directory: %s\n' "$root" >&2
	exit 2
}

case "$recipe" in
cloudflare-tanstack-start | cloudflare-astro-static | cloudflare-foldkit-alchemy | vite-react-ts | python-app | python-library | rust-cli | rust-library | typescript-cli | typescript-library) ;;
*)
	printf 'ERROR unknown recipe: %s\n' "$recipe" >&2
	exit 2
	;;
esac

failures=0
fail() {
	printf 'FAIL %s\n' "$1"
	failures=$((failures + 1))
}
need_file() { [ -f "$root/$1" ] || fail "missing $1 - $2"; }
need_dir() { [ -d "$root/$1" ] || fail "missing $1/ - $2"; }

need_file mise.toml 'record numeric tool selectors in repository-local mise.toml'
if [ -f "$root/mise.toml" ]; then
	if grep -Eiq '= *"(latest|lts)([^\"]*)"' "$root/mise.toml" ||
		! awk '
			/^\[tools\]/ { tools=1; next }
			/^\[/ { tools=0 }
			tools && /^[[:space:]]*[A-Za-z0-9_.-]+[[:space:]]*=/ {
				line=$0
				sub(/^[^=]*=[[:space:]]*"/, "", line)
				sub(/".*/, "", line)
				if (line !~ /^[0-9]+(\.[0-9]+)?$/) bad=1
			}
			END { exit bad }
		' "$root/mise.toml"; then
		fail 'mise tool selectors must be a numeric major or major-minor, never latest or lts'
	fi
fi

need_file AGENTS.md 'seed project orientation and verified commands'
need_file .agents/skills/verify/SKILL.md 'seed the project-specific verification skill'
if [ ! -L "$root/CLAUDE.md" ]; then
	fail 'CLAUDE.md must be a symlink to AGENTS.md, not a regular file'
elif [ "$(readlink "$root/CLAUDE.md")" != 'AGENTS.md' ]; then
	fail 'CLAUDE.md symlink must target AGENTS.md'
fi

need_file hk.pkl 'declare repository checks'
if [ ! -x "$root/.hk-hooks/pre-commit" ]; then
	fail '.hk-hooks/pre-commit must exist and be executable'
fi
if [ -d "$root/.git" ]; then
	hooks_path=$(git -C "$root" config --local core.hooksPath 2>/dev/null || true)
	[ "$hooks_path" = '.hk-hooks' ] || fail 'git core.hooksPath must be .hk-hooks'
fi
if command -v hk >/dev/null 2>&1 && [ -f "$root/hk.pkl" ]; then
	(cd "$root" && hk validate --json >/dev/null 2>&1) || fail 'hk validate --json failed'
	(cd "$root" && hk run pre-commit --plan --json >/dev/null 2>&1) || fail 'hk pre-commit plan is invalid'
else
	fail 'hk is required to validate hook configuration'
fi

case "$recipe" in
python-*)
	need_file pyproject.toml 'uv projects use pyproject.toml'
	need_file uv.lock 'commit the Python dependency lockfile'
	case "$recipe" in python-library) need_dir src 'use a src layout for the library' ;; esac
	;;
rust-*)
	need_file Cargo.toml 'Cargo projects use Cargo.toml'
	need_file Cargo.lock 'commit the Rust dependency lockfile for reproducible development and CI'
	case "$recipe" in rust-cli) need_file src/main.rs 'expose the CLI entry point' ;; rust-library) need_file src/lib.rs 'expose the library entry point' ;; esac
	;;
*)
	need_file package.json 'JavaScript and TypeScript recipes use package.json'
	need_file pnpm-lock.yaml 'commit the pnpm lockfile'
	need_file pnpm-workspace.yaml 'record dependency build-script decisions'
	if [ -f "$root/package.json" ]; then
		command -v node >/dev/null 2>&1 || {
			printf 'ERROR node is required for pnpm recipe checks\n' >&2
			exit 2
		}
		node -e '
				const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
				if(!/^pnpm@[0-9]+\.[0-9]+\.[0-9]+(?:[-+].*)?$/.test(p.packageManager||"")) process.exit(1)
			' "$root/package.json" || fail 'package.json packageManager must pin an exact pnpm version'
	fi
	need_file .hk-hooks/pnpm-build-scripts-check.mjs 'copy the canonical pnpm build-script decision checker from the hk skill'
	grep -q 'pnpm-build-scripts-check.mjs' "$root/hk.pkl" 2>/dev/null || fail 'hk.pkl must invoke the pnpm build-script decision checker'
	;;
esac

case "$recipe" in
cloudflare-tanstack-start)
	need_file wrangler.jsonc 'retain the generated Workers configuration'
	need_dir src/routes 'retain TanStack file routes'
	;;
cloudflare-astro-static)
	need_file astro.config.mjs 'retain Astro configuration'
	need_file wrangler.jsonc 'configure static Workers assets'
	;;
cloudflare-foldkit-alchemy)
	need_file alchemy.run.ts 'declare the platform graph'
	need_dir frontend 'keep the Foldkit frontend'
	need_dir backend 'keep the Effect Worker'
	need_dir protocol 'share the health protocol'
	;;
vite-react-ts)
	need_file vite.config.ts 'retain Vite configuration'
	need_file src/main.tsx 'retain the React TypeScript entry point'
	;;
typescript-cli) need_file src/cli.ts 'expose the TypeScript CLI entry point' ;;
typescript-library) need_file src/index.ts 'expose the TypeScript library entry point' ;;
esac

if [ "$failures" -gt 0 ]; then
	printf 'SUMMARY %s violation(s) for %s\n' "$failures" "$recipe"
	exit 1
fi
printf 'PASS %s\n' "$recipe"
