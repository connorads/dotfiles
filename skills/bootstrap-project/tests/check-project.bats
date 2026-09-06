#!/usr/bin/env bats

setup() {
	ROOT="$BATS_TEST_TMPDIR/project"
	SCRIPT="$BATS_TEST_DIRNAME/../scripts/check-project.sh"
	mkdir -p "$ROOT/.agents/skills/verify" "$ROOT/.hk-hooks" "$ROOT/src"
	printf '[tools]\nnode = "24"\npnpm = "11.25"\n' >"$ROOT/mise.toml"
	printf '{"name":"fixture","packageManager":"pnpm@11.25.0"}\n' >"$ROOT/package.json"
	: >"$ROOT/pnpm-lock.yaml"
	printf 'packages: []\n' >"$ROOT/pnpm-workspace.yaml"
	printf 'schema = "https://raw.githubusercontent.com/jdx/hk/main/schema.json"\n# pnpm-build-scripts-check.mjs\n' >"$ROOT/hk.pkl"
	printf '#!/bin/sh\nexit 0\n' >"$ROOT/.hk-hooks/pre-commit"
	chmod +x "$ROOT/.hk-hooks/pre-commit"
	printf '// pnpm-build-scripts-check: fixture\n' >"$ROOT/.hk-hooks/pnpm-build-scripts-check.mjs"
	printf '# Fixture\n' >"$ROOT/AGENTS.md"
	ln -s AGENTS.md "$ROOT/CLAUDE.md"
	printf '%s\n' '---' 'name: verify' 'description: Verify this project.' '---' '# Verify' >"$ROOT/.agents/skills/verify/SKILL.md"
	printf 'export const value = 1;\n' >"$ROOT/src/index.ts"
	git -C "$ROOT" init -q
	git -C "$ROOT" config core.hooksPath .hk-hooks
	mkdir -p "$BATS_TEST_TMPDIR/bin"
	cat >"$BATS_TEST_TMPDIR/bin/hk" <<'EOF'
#!/bin/sh
exit 0
EOF
	chmod +x "$BATS_TEST_TMPDIR/bin/hk"
	export PATH="$BATS_TEST_TMPDIR/bin:$PATH"
}

@test "accepts a conforming TypeScript library" {
	run "$SCRIPT" --root "$ROOT" --recipe typescript-library
	[ "$status" -eq 0 ]
	[[ "$output" == *"PASS typescript-library"* ]]
}

@test "rejects floating mise selectors" {
	printf '[tools]\nnode = "latest"\npnpm = "11"\n' >"$ROOT/mise.toml"
	run "$SCRIPT" --root "$ROOT" --recipe typescript-library
	[ "$status" -eq 1 ]
	[[ "$output" == *"numeric major or major-minor"* ]]
}

@test "rejects a CLAUDE regular file" {
	rm "$ROOT/CLAUDE.md"
	printf 'AGENTS.md\n' >"$ROOT/CLAUDE.md"
	run "$SCRIPT" --root "$ROOT" --recipe typescript-library
	[ "$status" -eq 1 ]
	[[ "$output" == *"CLAUDE.md must be a symlink"* ]]
}

@test "rejects an unrecorded pnpm checker" {
	rm "$ROOT/.hk-hooks/pnpm-build-scripts-check.mjs"
	run "$SCRIPT" --root "$ROOT" --recipe typescript-library
	[ "$status" -eq 1 ]
	[[ "$output" == *"pnpm build-script decision checker"* ]]
}

@test "uses exit 2 for invalid recipes" {
	run "$SCRIPT" --root "$ROOT" --recipe imaginary-stack
	[ "$status" -eq 2 ]
	[[ "$output" == *"unknown recipe"* ]]
}

@test "Python recipes do not require Node" {
	rm "$ROOT/package.json" "$ROOT/pnpm-lock.yaml" "$ROOT/pnpm-workspace.yaml" "$ROOT/.hk-hooks/pnpm-build-scripts-check.mjs"
	printf '[tools]\npython = "3.13"\nuv = "0.12"\n' >"$ROOT/mise.toml"
	printf '[project]\nname = "fixture"\nversion = "0.1.0"\n' >"$ROOT/pyproject.toml"
	: >"$ROOT/uv.lock"
	mkdir -p "$ROOT/src/fixture"
	run env PATH="$BATS_TEST_TMPDIR/bin:/usr/bin:/bin" "$SCRIPT" --root "$ROOT" --recipe python-library
	[ "$status" -eq 0 ]
}
