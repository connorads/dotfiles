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

@test "hyphenated-key prefixes are not accepted as top-level keys" {
	local skill="$BATS_TEST_TMPDIR/prefix-key"
	make_skill "$skill" "prefix-key"
	sed -i.bak '/^description:/a\
tools: Bash
' "$skill/SKILL.md"

	run "$SCRIPT" "$skill"

	[ "$status" -eq 1 ]
	[[ "$output" == *"ERROR:"*"unknown top-level frontmatter key 'tools'"* ]]

	local allowed_skill="$BATS_TEST_TMPDIR/allowed-prefix"
	make_skill "$allowed_skill" "allowed-prefix"
	sed -i.bak '/^description:/a\
allowed: yes
' "$allowed_skill/SKILL.md"

	run "$SCRIPT" "$allowed_skill"

	[ "$status" -eq 1 ]
	[[ "$output" == *"ERROR:"*"unknown top-level frontmatter key 'allowed'"* ]]
}

@test "underscore keys are extracted and rejected" {
	local skill="$BATS_TEST_TMPDIR/underscore-key"
	make_skill "$skill" "underscore-key"
	sed -i.bak '/^description:/a\
when_to_use: whenever
' "$skill/SKILL.md"

	run "$SCRIPT" "$skill"

	[ "$status" -eq 1 ]
	[[ "$output" == *"ERROR:"*"unknown top-level frontmatter key 'when_to_use'"* ]]
}

@test "backticked doc-rot phrasing in prose does not warn" {
	local skill="$BATS_TEST_TMPDIR/backticked-docrot"
	make_skill "$skill" "backticked-docrot"
	cat >>"$skill/SKILL.md" <<'EOF'

Avoid snapshot phrasing like `recent changes` in standing prose.
EOF

	run "$SCRIPT" "$skill"

	[ "$status" -eq 0 ]
	[[ "$output" == *"0 error(s), 0 warning(s)"* ]]
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

@test "undated verification banner warns but does not fail" {
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
	[[ "$output" == *"warning: undated verification banner (date it or point at a live source): references/tool.md:3:Verified against Tool v1.2."* ]]
	[[ "$output" == *"0 error(s), 1 warning(s)"* ]]
}

@test "dated as-of caveat is sanctioned standing prose and does not warn" {
	local skill="$BATS_TEST_TMPDIR/dated-caveat"
	make_skill "$skill" "dated-caveat"
	mkdir -p "$skill/references"
	printf '\nSee references/tool.md.\n' >>"$skill/SKILL.md"
	cat >"$skill/references/tool.md" <<'EOF'
# Tool Reference

Verified as of 2026-07 against Tool v1.2.
The registry lists 142 linters as of 2026.
Last verified 2026-06-30 against the upstream schema.
EOF

	run "$SCRIPT" "$skill"

	[ "$status" -eq 0 ]
	[[ "$output" == *"0 error(s), 0 warning(s)"* ]]
}

@test "instructive checked-against prose does not warn" {
	local skill="$BATS_TEST_TMPDIR/instructive-check"
	make_skill "$skill" "instructive-check"
	cat >>"$skill/SKILL.md" <<'EOF'

Executable claims are spot-checked against the live tool before shipping.
Keep the repository checked out locally while testing.
EOF

	run "$SCRIPT" "$skill"

	[ "$status" -eq 0 ]
	[[ "$output" == *"0 error(s), 0 warning(s)"* ]]
}

@test "dated caveat wrapped onto the next line does not warn" {
	local skill="$BATS_TEST_TMPDIR/wrapped-caveat"
	make_skill "$skill" "wrapped-caveat"
	cat >>"$skill/SKILL.md" <<'EOF'

Not the blessed path because (as of
mid-2026, v0.93) the rewrite is still in flight.
EOF

	run "$SCRIPT" "$skill"

	[ "$status" -eq 0 ]
	[[ "$output" == *"0 error(s), 0 warning(s)"* ]]
}

@test "banner exclusion tests content, not grep's line-number prefix" {
	local skill="$BATS_TEST_TMPDIR/deep-line-banner"
	make_skill "$skill" "deep-line-banner"
	{
		for i in $(seq 1 2025); do
			printf '\n'
		done
		printf 'Verified against Tool v1.2.\n'
	} >>"$skill/SKILL.md"

	run "$SCRIPT" "$skill"

	[ "$status" -eq 0 ]
	[[ "$output" == *"warning: undated verification banner (date it or point at a live source): SKILL.md:"* ]]
}

@test "at the time of writing warns even alongside a date" {
	local skill="$BATS_TEST_TMPDIR/time-of-writing"
	make_skill "$skill" "time-of-writing"
	cat >>"$skill/SKILL.md" <<'EOF'

At the time of writing (2026) the API exposes three endpoints.
EOF

	run "$SCRIPT" "$skill"

	[ "$status" -eq 0 ]
	[[ "$output" == *"warning: possible doc-rot phrasing: SKILL.md:"* ]]
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
