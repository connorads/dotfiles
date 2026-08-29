#!/usr/bin/env bats

# Behavioural tests for scripts/video.sh. Test the public CLI contract:
# arguments, exit status, emitted messages, and files produced.
# Run: bats tests/   (from the skill root)

bats_require_minimum_version 1.5.0

setup() {
	SCRIPT="$BATS_TEST_DIRNAME/../scripts/video.sh"
	FIXTURE="$BATS_TEST_TMPDIR/clip.webm"
}

# Real ffmpeg work is skipped rather than failed where ffmpeg is absent - the
# same never-brick posture the repo's other gates use.
need_ffmpeg() {
	command -v ffmpeg >/dev/null 2>&1 || skip "ffmpeg not installed"
	command -v ffprobe >/dev/null 2>&1 || skip "ffprobe not installed"
}

# A 4-second 320x240 test pattern. Cheap enough to build per test that needs it.
make_clip() {
	ffmpeg -v error -y -f lavfi -i testsrc=size=320x240:rate=10 -t 4 \
		-c:v libvpx -b:v 200k "$FIXTURE"
}

@test "no arguments prints usage and exits 2" {
	run "$SCRIPT"

	[ "$status" -eq 2 ]
	[[ "$output" == *"usage: video.sh"* ]]
}

@test "unknown command prints usage and exits 2" {
	run "$SCRIPT" frobnicate

	[ "$status" -eq 2 ]
	[[ "$output" == *"usage: video.sh"* ]]
}

@test "--help prints usage and exits 0" {
	run "$SCRIPT" --help

	[ "$status" -eq 0 ]
	[[ "$output" == *"sheet <video>"* ]]
	[[ "$output" == *"mp4 <in.webm>"* ]]
	[[ "$output" == *"probe <video>"* ]]
}

@test "sheet on a missing file fails with the path named" {
	run "$SCRIPT" sheet "$BATS_TEST_TMPDIR/nope.webm"

	[ "$status" -ne 0 ]
	[[ "$output" == *"no such file"* ]]
	[[ "$output" == *"nope.webm"* ]]
}

@test "mp4 on a missing file fails with the path named" {
	run "$SCRIPT" mp4 "$BATS_TEST_TMPDIR/nope.webm"

	[ "$status" -ne 0 ]
	[[ "$output" == *"no such file"* ]]
}

@test "probe on a missing file fails with the path named" {
	run "$SCRIPT" probe "$BATS_TEST_TMPDIR/nope.webm"

	[ "$status" -ne 0 ]
	[[ "$output" == *"no such file"* ]]
}

@test "sheet rejects a non-positive frame count" {
	touch "$FIXTURE"

	run "$SCRIPT" sheet "$FIXTURE" -n 0

	[ "$status" -eq 2 ]
	[[ "$output" == *"-n must be a positive integer"* ]]
}

@test "sheet rejects an unknown option" {
	touch "$FIXTURE"

	run "$SCRIPT" sheet "$FIXTURE" --bogus

	[ "$status" -eq 2 ]
	[[ "$output" == *"unknown option: --bogus"* ]]
}

@test "sheet rejects --window without --around" {
	touch "$FIXTURE"

	run "$SCRIPT" sheet "$FIXTURE" --window 3

	[ "$status" -eq 2 ]
	[[ "$output" == *"--window needs --around"* ]]
}

@test "missing ffmpeg is a named, actionable failure" {
	touch "$FIXTURE"

	run env PATH="/usr/bin:/bin" "$SCRIPT" probe "$FIXTURE"

	[ "$status" -ne 0 ]
	[[ "$output" == *"ffmpeg not found on PATH"* ]]
}

@test "probe reports duration, dimensions and codec" {
	need_ffmpeg
	make_clip

	run "$SCRIPT" probe "$FIXTURE"

	[ "$status" -eq 0 ]
	[[ "$output" == *"duration: 4.0"* ]]
	[[ "$output" == *"320x240"* ]]
	[[ "$output" == *"vp8"* ]]
}

@test "sheet writes a contact sheet next to the video and lists the timestamps" {
	need_ffmpeg
	make_clip

	run "$SCRIPT" sheet "$FIXTURE"

	[ "$status" -eq 0 ]
	[ -f "$BATS_TEST_TMPDIR/clip-sheet.png" ]
	[[ "$output" == *"grid: 3x2"* ]]
	[[ "$output" == *"cell 6:"* ]]
	[[ "$output" != *"cell 7:"* ]]
}

@test "sheet honours -o, -n and --cols" {
	need_ffmpeg
	make_clip
	local out="$BATS_TEST_TMPDIR/custom.png"

	run "$SCRIPT" sheet "$FIXTURE" -o "$out" -n 4 --cols 2

	[ "$status" -eq 0 ]
	[ -f "$out" ]
	[[ "$output" == *"grid: 2x2"* ]]
	[[ "$output" == *"cell 4:"* ]]
	[[ "$output" != *"cell 5:"* ]]
}

@test "sheet --around samples inside the requested window only" {
	need_ffmpeg
	make_clip

	run "$SCRIPT" sheet "$FIXTURE" -n 2 --around 2 --window 1

	[ "$status" -eq 0 ]
	[[ "$output" == *"cell 1: 1.750s"* ]]
	[[ "$output" == *"cell 2: 2.250s"* ]]
}

@test "sheet leaves no temp directory behind" {
	need_ffmpeg
	make_clip
	local before after
	before=$(find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'tmp.*' 2>/dev/null | wc -l)

	run "$SCRIPT" sheet "$FIXTURE"
	after=$(find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'tmp.*' 2>/dev/null | wc -l)

	[ "$status" -eq 0 ]
	[ "$before" -eq "$after" ]
}

@test "mp4 re-encodes to H.264 and prints the output path" {
	need_ffmpeg
	make_clip
	local out="$BATS_TEST_TMPDIR/clip.mp4"

	run "$SCRIPT" mp4 "$FIXTURE" "$out"

	[ "$status" -eq 0 ]
	[ "$output" = "$out" ]
	[ -s "$out" ]
	run ffprobe -v error -select_streams v:0 -show_entries stream=codec_name \
		-of default=nw=1:nk=1 "$out"
	[[ "$output" == *"h264"* ]]
}

@test "mp4 defaults its output to the input path with an mp4 extension" {
	need_ffmpeg
	make_clip

	run "$SCRIPT" mp4 "$FIXTURE"

	[ "$status" -eq 0 ]
	[ "$output" = "$BATS_TEST_TMPDIR/clip.mp4" ]
	[ -s "$BATS_TEST_TMPDIR/clip.mp4" ]
}
