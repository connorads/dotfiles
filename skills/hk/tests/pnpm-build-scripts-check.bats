#!/usr/bin/env bats

# Behavioural tests for assets/pnpm-build-scripts-check.mjs.
# Run: bats tests/   (from the skill root)
#
# Every tree here is hand-built: the check reads manifests and config, so a
# fixture directory is a faithful stand-in for an installed tree and no test
# ever runs a real install.

bats_require_minimum_version 1.5.0

setup() {
	SCRIPT="$BATS_TEST_DIRNAME/../assets/pnpm-build-scripts-check.mjs"
	[ -f "$SCRIPT" ] || skip "pnpm-build-scripts-check.mjs missing"
	command -v node >/dev/null 2>&1 || skip "node not installed"

	TEST_ROOT="$(mktemp -d)"
	PROJ="$TEST_ROOT/proj"
	mkdir -p "$PROJ"
	printf 'lockfileVersion: 11.0\n' >"$PROJ/pnpm-lock.yaml"
	printf '{ "name": "app", "version": "1.0.0" }\n' >"$PROJ/package.json"
	mkdir -p "$PROJ/node_modules"
}

teardown() {
	rm -rf "$TEST_ROOT"
}

# dep <name> <version> [script-name] - a package in the virtual store, linked
# into the top-level node_modules the way pnpm's isolated linker does it.
dep() {
	local name="$1" version="$2" script="${3:-}"
	local store="$PROJ/node_modules/.pnpm/${name//\//+}@$version/node_modules/$name"
	mkdir -p "$store"
	if [ -n "$script" ]; then
		printf '{ "name": "%s", "version": "%s", "scripts": { "%s": "node install.js" } }\n' \
			"$name" "$version" "$script" >"$store/package.json"
	else
		printf '{ "name": "%s", "version": "%s" }\n' "$name" "$version" >"$store/package.json"
	fi
	mkdir -p "$(dirname "$PROJ/node_modules/$name")"
	ln -s "$store" "$PROJ/node_modules/$name"
}

check() {
	run node "$SCRIPT" --dir "$PROJ" "$@"
}

@test "fails naming the package, its trigger, and the YAML to add" {
	dep esbuild 0.28.2 postinstall

	check
	[ "$status" -eq 1 ]
	[[ "$output" == *"esbuild@0.28.2"* ]]
	[[ "$output" == *"postinstall"* ]]
	[[ "$output" == *"allowBuilds:"* ]]
	[[ "$output" == *"pnpm-workspace.yaml"* ]]
}

@test "passes when the decision is recorded as false" {
	dep esbuild 0.28.2 postinstall
	printf 'allowBuilds:\n  esbuild: false\n' >"$PROJ/pnpm-workspace.yaml"

	check
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}

@test "passes when the decision is recorded as true" {
	dep better-sqlite3 12.4.1 install
	printf 'allowBuilds:\n  better-sqlite3: true\n' >"$PROJ/pnpm-workspace.yaml"

	check
	[ "$status" -eq 0 ]
}

@test "a decision recorded in flow style counts" {
	dep esbuild 0.28.2 postinstall
	printf 'allowBuilds: { esbuild: false }\n' >"$PROJ/pnpm-workspace.yaml"

	check
	[ "$status" -eq 0 ]
}

@test "comments and neighbouring keys do not swallow the decisions" {
	dep esbuild 0.28.2 postinstall
	cat >"$PROJ/pnpm-workspace.yaml" <<-'YAML'
		minimumReleaseAge: 5760
		# esbuild's binary ships in @esbuild/<platform>.
		allowBuilds:
		  esbuild: false # acknowledged, deliberately not run
		trustPolicy: no-downgrade
	YAML

	check
	[ "$status" -eq 0 ]
}

@test "a scoped package name is matched, not its scope" {
	dep "@scope/native" 2.0.0 postinstall
	printf 'allowBuilds:\n  "@scope/native": false\n' >"$PROJ/pnpm-workspace.yaml"

	check
	[ "$status" -eq 0 ]
}

@test "detects binding.gyp with no lifecycle script" {
	dep node-canvas 3.0.0
	touch "$PROJ/node_modules/.pnpm/node-canvas@3.0.0/node_modules/node-canvas/binding.gyp"

	check
	[ "$status" -eq 1 ]
	[[ "$output" == *"node-canvas@3.0.0"* ]]
	[[ "$output" == *"binding.gyp"* ]]
}

@test "ignores the root package's own scripts" {
	printf '{ "name": "app", "version": "1.0.0", "scripts": { "postinstall": "true" } }\n' \
		>"$PROJ/package.json"

	check
	[ "$status" -eq 0 ]
}

@test "ignores a workspace package linked in from outside node_modules" {
	mkdir -p "$PROJ/packages/ui"
	printf '{ "name": "ui", "version": "0.0.0", "scripts": { "postinstall": "true" } }\n' \
		>"$PROJ/packages/ui/package.json"
	ln -s "$PROJ/packages/ui" "$PROJ/node_modules/ui"

	check
	[ "$status" -eq 0 ]
}

@test "warns and passes when node_modules is absent" {
	rmdir "$PROJ/node_modules"

	check
	[ "$status" -eq 0 ]
	[[ "$output" == *"node_modules absent"* ]]
	[[ "$output" == *"pnpm install"* ]]
}

@test "warns and passes outside a pnpm project" {
	rm "$PROJ/pnpm-lock.yaml"
	dep esbuild 0.28.2 postinstall

	check
	[ "$status" -eq 0 ]
	[[ "$output" == *"not a pnpm project"* ]]
}

@test "--json reports the undeclared packages and their triggers" {
	dep esbuild 0.28.2 postinstall
	dep sharp 0.35.3 install
	printf 'allowBuilds:\n  sharp: true\n' >"$PROJ/pnpm-workspace.yaml"

	check --json
	[ "$status" -eq 1 ]
	run node -e '
		const r = JSON.parse(process.argv[1]);
		if (r.status !== "fail") throw new Error("status: " + r.status);
		if (r.buildScriptPackages !== 2) throw new Error("count: " + r.buildScriptPackages);
		if (r.undeclared.length !== 1) throw new Error("undeclared: " + r.undeclared.length);
		const [u] = r.undeclared;
		if (u.name !== "esbuild" || u.version !== "0.28.2") throw new Error("pkg: " + u.name);
		if (u.triggers.join() !== "postinstall") throw new Error("triggers: " + u.triggers);
		if (r.decided.join() !== "sharp") throw new Error("decided: " + r.decided);
	' "$output"
	[ "$status" -eq 0 ]
}

@test "--json reports ok when every package has a decision" {
	dep esbuild 0.28.2 postinstall
	printf 'allowBuilds:\n  esbuild: false\n' >"$PROJ/pnpm-workspace.yaml"

	check --json
	[ "$status" -eq 0 ]
	[[ "$output" == *'"status":"ok"'* ]]
	[[ "$output" == *'"undeclared":[]'* ]]
}

@test "caps the listing and reports the true total" {
	for i in $(seq 1 14); do dep "pkg$i" "1.0.$i" postinstall; done

	check
	[ "$status" -eq 1 ]
	[[ "$output" == *"no recorded decision (14)"* ]]
	[[ "$output" == *"... and 4 more"* ]]
	[ "$(grep -c 'postinstall$' <<<"$output")" -eq 10 ]
}

@test "counts a package once when store and link both resolve to it" {
	dep esbuild 0.28.2 postinstall

	check --json
	[ "$status" -eq 1 ]
	[[ "$output" == *'"buildScriptPackages":1'* ]]
}
