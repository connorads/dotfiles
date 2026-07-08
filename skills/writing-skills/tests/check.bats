#!/usr/bin/env bats

# Behavioural tests for scripts/check.sh. Test the public CLI contract:
# arguments, exit status, and emitted errors/warnings.
# Run: bats tests/   (from the skill root)

bats_require_minimum_version 1.5.0

setup() {
	SCRIPT="$BATS_TEST_DIRNAME/../scripts/check.sh"
	FAKEBIN="$BATS_TEST_TMPDIR/fakebin"
	mkdir -p "$FAKEBIN"
	cat >"$FAKEBIN/skills-ref" <<'SH'
#!/bin/sh
exit 0
SH
	chmod +x "$FAKEBIN/skills-ref"
	export PATH="$FAKEBIN:$PATH"
}

make_skill() {
	local dir="$1"
	local name="$2"
	mkdir -p "$dir"
	cat >"$dir/SKILL.md" <<EOF
---
name: $name
description: Use when testing the writing-skills checker.
---

# $name

Use this fixture for checker tests.
EOF
}

@test "valid minimal skill exits 0 without warnings" {
	local skill="$BATS_TEST_TMPDIR/minimal-skill"
	make_skill "$skill" "minimal-skill"

	run "$SCRIPT" "$skill"

	[ "$status" -eq 0 ]
	[[ "$output" == *"0 error(s), 0 warning(s)"* ]]
}

@test "unknown frontmatter key is a blocking spec error" {
	local skill="$BATS_TEST_TMPDIR/bad-frontmatter"
	make_skill "$skill" "bad-frontmatter"
	sed -i.bak '/^description:/a\
version: 1
' "$skill/SKILL.md"

	run "$SCRIPT" "$skill"

	[ "$status" -eq 1 ]
	[[ "$output" == *"ERROR:"*"unknown top-level frontmatter key 'version'"* ]]
	[[ "$output" == *"1 error(s)"* ]]
}

@test "long SKILL.md body warns but does not fail" {
	local skill="$BATS_TEST_TMPDIR/long-body"
	mkdir -p "$skill"
	{
		printf '%s\n' "---" "name: long-body" "description: Use when testing long body warnings." "---" "" "# Long Body" ""
		for i in $(seq 1 501); do
			printf 'line %s\n' "$i"
		done
	} >"$skill/SKILL.md"

	run "$SCRIPT" "$skill"

	[ "$status" -eq 0 ]
	[[ "$output" == *"warning: SKILL.md is "*" lines (recommended max 500"* ]]
	[[ "$output" == *"0 error(s), 1 warning(s)"* ]]
}

@test "verification banner phrasing warns but does not fail" {
	local skill="$BATS_TEST_TMPDIR/verified-banner"
	make_skill "$skill" "verified-banner"
	mkdir -p "$skill/references"
	printf '\nSee references/tool.md.\n' >>"$skill/SKILL.md"
	cat >"$skill/references/tool.md" <<'EOF'
# Tool Reference

Verified against Tool v1.2.
EOF

	run "$SCRIPT" "$skill"

	[ "$status" -eq 0 ]
	[[ "$output" == *"warning: possible doc-rot phrasing: references/tool.md:3:Verified against Tool v1.2."* ]]
	[[ "$output" == *"0 error(s), 1 warning(s)"* ]]
}
