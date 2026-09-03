#!/usr/bin/env bash
# typescript-publish-gates.sh - the pre-publish gate for a TypeScript library: build, pack
# once, then point publint, attw and a clean-directory smoke test at that one tarball.
# Verified 2026-09-03 against publint 0.3.24, @arethetypeswrong/cli 0.18.5, typescript 7.0.2,
# Verified 2026-09-03 with the versions recorded in typescript-publishing.md.
#
# Wire it: save as scripts/publish-gates.sh, `chmod +x`, and run it in the release job
# immediately before `pnpm publish`. A lifecycle hook is not a substitute - `prepack` and
# `prepublishOnly` do not run under `ignore-scripts`. Order is load-bearing: a failed build
# must not reach publint, and attw exits 0 on a package that ships no types at all, so it
# runs last of the two static gates and behind an explicit types assertion.
#
#   pnpm add -D publint@0.3.24 @arethetypeswrong/cli@0.18.5
#   pnpm run publish-gates      # "publish-gates": "bash scripts/publish-gates.sh"
#
# INSTALL THE SCOPED NAME. The bare `attw` on npm is a dependency-confusion placeholder that
# always exits 0, ignores every argument and prints its banner to stdout only, so a CI step
# calling it is green forever. `pnpm add -D attw` succeeds and no release-age or trust policy
# fires, because the placeholder is old and has one version.
#
# Traps this script exists to avoid, each verified on the fixture:
# - `bash scripts/publish-gates.sh` from a plain shell exits 127, `publint: command not
#   found`: node_modules/.bin is not on PATH outside `pnpm exec`. Hence the PATH line below.
# - publint accepts an unknown flag in silence. `--stricct` reprints the finding under
#   `Warnings:` and exits 0, so the exit code alone cannot tell a clean package from a
#   misspelt gate. This script also asserts the literal `All good!` in publint's output.
# - `tsc` never cleans outDir, so a renamed or deleted source file leaves its stale build
#   artefact in the tarball and every gate stays green. `rm -rf dist` is the fix; a `prepack`
#   script cannot be, because `ignore-scripts` stops it running.
# - attw's `--pack` hard-codes `npm pack` with no package-manager detection, which in a
#   workspace produces a tarball still carrying `workspace:*` specifiers that both static
#   gates pass and no consumer can install. `pnpm pack` rewrites them, so pack once here and
#   hand both tools the path.
# - Linting the tarball path is the strict view of `files:`. publint's own auto packer is
#   `pnpm pack`, which force-includes `main`/`exports` targets; `--pack npm` is the stricter
#   equivalent, and a real tarball is stricter still, because an unpublished file is simply
#   absent. `--pack false` keeps FILE_DOES_NOT_EXIST and silently drops FILE_NOT_PUBLISHED.
# - Running attw's JSON output before its human-readable run makes every failure invisible:
#   under `set -e` the JSON invocation is the one that exits non-zero, so the readable
#   diagnostic never prints. Readable first, rc captured, JSON second.
# - The smoke test must run from a directory outside the repo. From the project root Node's
#   package self-reference resolves `exports` against the source tree and a broken tarball
#   imports fine.
#
# Severity tables, the profile choice and what each tool cannot see:
# references/typescript-publishing.md, "Publishing gates".

set -euo pipefail

# node_modules/.bin is not on PATH under a plain `bash script.sh`.
PATH="$PWD/node_modules/.bin:$PATH"

PROFILE="${ATTW_PROFILE:-esm-only}" # esm-only | node16 | strict - pick it from what the
# package actually ships. On one clean ESM-only build `strict` and `node16` both exit 1 and
# only `esm-only` exits 0, so the wrong profile reddens everything and hides real signal.

PKG=$(jq -r '.name' package.json)
[ -n "$PKG" ] && [ "$PKG" != "null" ] || {
	echo "gate: package.json has no name" >&2
	exit 1
}

# ---- 1. build from clean -------------------------------------------------------------
rm -rf dist .pack
tsc -p tsconfig.build.json || {
	echo "gate: build failed" >&2
	exit 1
}

# ---- 2. pack once --------------------------------------------------------------------
# `.filename` is an absolute path. pnpm pack, not npm pack: it rewrites `workspace:*`.
TGZ=$(pnpm pack --pack-destination .pack --json | jq -r '.filename')
[ -f "$TGZ" ] || {
	echo "gate: pack produced no tarball" >&2
	exit 1
}
echo "gate: packed $TGZ"

# ---- 3. publint: the manifest against the packed file list ---------------------------
PUBLINT_OUT=$(publint run "$TGZ" --strict 2>&1) || {
	echo "$PUBLINT_OUT"
	exit 1
}
echo "$PUBLINT_OUT"
# Belt and braces for the silently-accepted typo: a real clean run says exactly this.
case "$PUBLINT_OUT" in
*"All good!"*) ;;
*)
	echo "gate: publint did not report 'All good!' - check the flags are spelt right" >&2
	exit 1
	;;
esac

# ---- 4. attw: does the type graph resolve in every mode the package claims? -----------
ATTW_RC=0
attw "$TGZ" --profile "$PROFILE" || ATTW_RC=$?
attw "$TGZ" --profile "$PROFILE" -f json >.pack/attw.json 2>/dev/null || true
[ "$ATTW_RC" -eq 0 ] || {
	echo "gate: attw exit $ATTW_RC (1 = type problems, 3 = unreadable tarball)" >&2
	exit 1
}

# attw's getExitCode opens `if (!analysis.types) return 0`, so a build that stops emitting
# declarations passes on all three profiles. `.analysis.types` is then the boolean `false`,
# which is why the guard cannot index it: `jq -e '.analysis.types.kind == "included"'`
# crashes at exit 5 instead of evaluating. This form prints `false` and exits 1.
jq -e '(.analysis.types | if type == "object" then .kind else null end) == "included"' \
	.pack/attw.json >/dev/null ||
	{
		echo "gate: the tarball ships no types - attw cannot check what is not there" >&2
		exit 1
	}

# ---- 5. clean-directory smoke: the artefact as a consumer sees it --------------------
# Two halves, catching different classes. Runtime: a `.js` missing while its `.d.ts` ships,
# invisible to publint and attw because both walk the type graph. Type: a devDependency
# leaked into the public `.d.ts`, which surfaces as TS2307 ONLY because skipLibCheck is left
# at its default false here. Do not copy a real app's consumer tsconfig into this step.
SMOKE=$(mktemp -d)
trap 'rm -rf "$SMOKE"' EXIT
cp "$TGZ" "$SMOKE/pkg.tgz"
# `set -e` is SUSPENDED inside a compound command on the left of `||`, so a bare subshell
# here reports only its LAST command's status: a failing `node -e` followed by a passing
# `tsc` exits 0 and the gate goes green over ERR_MODULE_NOT_FOUND. Every step says `|| exit 1`.
(
	cd "$SMOKE" || exit 1
	printf '{"name":"smoke","private":true,"version":"0.0.0","type":"module"}\n' >package.json || exit 1
	pnpm add -D "file:$SMOKE/pkg.tgz" typescript@7 >/dev/null || exit 1
	node -e "import('$PKG').then(m => console.log('smoke: imported', Object.keys(m).length, 'exports'))" || exit 1
	printf 'import * as lib from "%s";\nexport const keys = Object.keys(lib);\n' "$PKG" >consumer.ts || exit 1
	./node_modules/.bin/tsc --noEmit --strict --module nodenext --target es2024 consumer.ts || exit 1
) || {
	echo "gate: clean-directory smoke failed" >&2
	exit 1
}

echo "gate: all publish gates passed for $PKG"
