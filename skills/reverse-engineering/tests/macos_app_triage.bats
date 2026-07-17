#!/usr/bin/env bats

setup() {
	if [[ "$(uname -s)" != "Darwin" ]]; then
		skip "macOS integration test"
	fi

	export TEST_ROOT
	TEST_ROOT="$(mktemp -d)"
	export APP="$TEST_ROOT/Sentinel.app"
	export DMG="$TEST_ROOT/Sentinel.dmg"
	export MARKER="$TEST_ROOT/target-executed"
	export SCRIPT="$BATS_TEST_DIRNAME/../scripts/macos_app_triage.py"

	mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
	printf '%s\n' \
		'<?xml version="1.0" encoding="UTF-8"?>' \
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
		'<plist version="1.0"><dict>' \
		'<key>CFBundleExecutable</key><string>Sentinel</string>' \
		'<key>CFBundleIdentifier</key><string>test.reverse-engineering.sentinel</string>' \
		'<key>CFBundleName</key><string>Sentinel</string>' \
		'<key>CFBundlePackageType</key><string>APPL</string>' \
		'<key>CFBundleShortVersionString</key><string>1.0</string>' \
		'</dict></plist>' >"$APP/Contents/Info.plist"
	printf '#!/bin/sh\ntouch %q\n' "$MARKER" >"$APP/Contents/MacOS/Sentinel"
	chmod +x "$APP/Contents/MacOS/Sentinel"
	printf 'static fixture\n' >"$APP/Contents/Resources/readme.txt"
}

teardown() {
	device="$(
		hdiutil info |
			awk -v image="$DMG" '
        index($0, image) { found = 1 }
        found && $1 ~ /^\/dev\/disk/ { print $1; exit }
      '
	)"
	[[ -n "$device" ]] && hdiutil detach "$device" >/dev/null 2>&1 || true
	rm -rf "$TEST_ROOT"
}

assert_dmg_is_detached() {
	run hdiutil info
	[ "$status" -eq 0 ]
	[[ "$output" != *"$DMG"* ]]
}

@test "inspects an app without executing its main binary" {
	run python3 "$SCRIPT" "$APP" --out "$TEST_ROOT/app-report"

	[ "$status" -eq 0 ]
	[ ! -e "$MARKER" ]
	[ -f "$TEST_ROOT/app-report/app-info-plist.txt" ]
	[ -f "$TEST_ROOT/app-report/main-binary-file.txt" ]
	grep -F 'test.reverse-engineering.sentinel' "$TEST_ROOT/app-report/app-info-plist.txt"
	grep -F '"target_executed": false' "$TEST_ROOT/app-report/triage-metadata.json"
}

@test "refuses to write analysis artefacts inside the target app" {
	run python3 "$SCRIPT" "$APP" --out "$APP/report"

	[ "$status" -eq 2 ]
	[ ! -e "$APP/report" ]
	[ ! -e "$MARKER" ]
}

@test "refuses a bundle symlink that escapes the app" {
	ln -s "$TEST_ROOT" "$APP/Contents/Resources/outside"

	run python3 "$SCRIPT" "$APP" --out "$TEST_ROOT/symlink-report"

	[ "$status" -eq 1 ]
	[ ! -e "$MARKER" ]
	grep -F 'bundle symlink escapes the app' "$TEST_ROOT/symlink-report/triage-metadata.json"
}

@test "does not mount a DMG without explicit permission" {
	hdiutil create -quiet -format UDBZ -srcfolder "$APP" "$DMG"

	run python3 "$SCRIPT" "$DMG" --out "$TEST_ROOT/dmg-report"

	[ "$status" -eq 0 ]
	[ ! -e "$MARKER" ]
	[ -f "$TEST_ROOT/dmg-report/dmg-imageinfo.plist" ]
	grep -F '"mount_requested": false' "$TEST_ROOT/dmg-report/triage-metadata.json"
	assert_dmg_is_detached
}

@test "read-only mount inspects the app and always detaches" {
	hdiutil create -quiet -format UDBZ -srcfolder "$APP" "$DMG"

	run python3 "$SCRIPT" "$DMG" --allow-mount --out "$TEST_ROOT/mounted-report"

	[ "$status" -eq 0 ]
	[ ! -e "$MARKER" ]
	[ -f "$TEST_ROOT/mounted-report/app-info-plist.txt" ]
	grep -F '"mount_requested": true' "$TEST_ROOT/mounted-report/triage-metadata.json"
	grep -F '"detached": true' "$TEST_ROOT/mounted-report/triage-metadata.json"
	assert_dmg_is_detached
}
