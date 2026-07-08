#!/usr/bin/env bats

# Behavioural tests for scripts/check.sh. Test the public CLI contract:
# arguments, exit status, and emitted errors/warnings.
# Run: bats tests/   (from the skill root)

bats_require_minimum_version 1.5.0

setup() {
	SKILL_ROOT="$BATS_TEST_DIRNAME/.."
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

@test "skill directory may be passed as current directory" {
	local skill="$BATS_TEST_TMPDIR/current-dir"
	make_skill "$skill" "current-dir"

	run bash -c 'cd "$1" && "$2" .' bash "$skill" "$SCRIPT"

	[ "$status" -eq 0 ]
	[[ "$output" == *"0 error(s), 0 warning(s)"* ]]
}

@test "unclosed frontmatter is a blocking spec error" {
	local skill="$BATS_TEST_TMPDIR/unclosed-frontmatter"
	mkdir -p "$skill"
	cat >"$skill/SKILL.md" <<'EOF'
---
name: unclosed-frontmatter
description: Use when testing unclosed frontmatter.

# Unclosed Frontmatter
EOF

	run "$SCRIPT" "$skill"

	[ "$status" -eq 1 ]
	[[ "$output" == *"ERROR:"*"frontmatter block is unclosed"* ]]
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

@test "portable name and description limits stay enforced" {
	local long_name="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	local skill="$BATS_TEST_TMPDIR/$long_name"
	make_skill "$skill" "$long_name"

	run "$SCRIPT" "$skill"

	[ "$status" -eq 1 ]
	[[ "$output" == *"ERROR:"*"name exceeds 64 characters"* ]]

	local desc_skill="$BATS_TEST_TMPDIR/long-description"
	local long_desc
	printf -v long_desc '%*s' 1025 ''
	long_desc=${long_desc// /x}
	mkdir -p "$desc_skill"
	cat >"$desc_skill/SKILL.md" <<EOF
---
name: long-description
description: $long_desc
---

# Long Description
EOF

	run "$SCRIPT" "$desc_skill"

	[ "$status" -eq 1 ]
	[[ "$output" == *"ERROR:"*"description is 1025 chars (max 1024)"* ]]
}

@test "XML-like tags in name and description are blocking spec errors" {
	local name_skill="$BATS_TEST_TMPDIR/xml-name"
	mkdir -p "$name_skill"
	cat >"$name_skill/SKILL.md" <<'EOF'
---
name: <xml-name>
description: Use when testing XML-like names.
---

# XML Name
EOF

	run "$SCRIPT" "$name_skill"

	[ "$status" -eq 1 ]
	[[ "$output" == *"ERROR:"*"name contains XML-like tag syntax"* ]]

	local desc_skill="$BATS_TEST_TMPDIR/xml-description"
	mkdir -p "$desc_skill"
	cat >"$desc_skill/SKILL.md" <<'EOF'
---
name: xml-description
description: Use when <strong>testing</strong> XML-like descriptions.
---

# XML Description
EOF

	run "$SCRIPT" "$desc_skill"

	[ "$status" -eq 1 ]
	[[ "$output" == *"ERROR:"*"description contains XML-like tag syntax"* ]]
}

@test "XML-like body text does not trip frontmatter tag checks" {
	local skill="$BATS_TEST_TMPDIR/body-tags"
	make_skill "$skill" "body-tags"
	cat >>"$skill/SKILL.md" <<'EOF'

Use <skill-dir> placeholders and <example value="ok"> body examples freely.
EOF

	run "$SCRIPT" "$skill"

	[ "$status" -eq 0 ]
	[[ "$output" == *"0 error(s), 0 warning(s)"* ]]
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

@test "eval fixtures are ignored by outer skill hygiene scans" {
	local skill="$BATS_TEST_TMPDIR/fixture-host"
	make_skill "$skill" "fixture-host"
	mkdir -p "$skill/evals/fixtures/bad-skill/__pycache__"
	touch "$skill/evals/fixtures/bad-skill/__pycache__/ignored.pyc"
	cat >"$skill/evals/fixtures/bad-skill/SKILL.fixture.md" <<'EOF'
# Bad Fixture

Verified against Tool v1.2.
EOF

	run "$SCRIPT" "$skill"

	[ "$status" -eq 0 ]
	[[ "$output" == *"0 error(s), 0 warning(s)"* ]]
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

@test "eval metadata has required keys and fixture templates exist" {
	command -v jq >/dev/null 2>&1 || skip "jq not installed"
	local evals="$SKILL_ROOT/evals/evals.json"

	run jq -e '.skill_name == "writing-skills" and (.evals | type == "array" and length > 0) and all(.evals[]; has("id") and has("name") and has("fixture") and has("prompt") and (.assertions | type == "array" and length > 0))' "$evals"

	[ "$status" -eq 0 ]

	local fixture
	while IFS= read -r fixture; do
		[[ -e "$SKILL_ROOT/$fixture" ]] || {
			echo "missing fixture: $fixture"
			return 1
		}
		[[ ! -e "$SKILL_ROOT/$fixture/SKILL.md" ]] || {
			echo "fixture must not contain live SKILL.md: $fixture"
			return 1
		}
	done < <(jq -r '.evals[].fixture | select(. != "none")' "$evals")
}
