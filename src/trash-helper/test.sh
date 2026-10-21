#!/bin/bash
set -euo pipefail
launch_app() {
	local app=$1 result_dir
	shift
	result_dir=$(mktemp -d /tmp/trash-helper-test.XXXXXXXX)
	/usr/bin/open -n -g -W -o "$result_dir/result" --stderr "$result_dir/error" \
		"$app" --args "$@"
	cat "$result_dir/result"
}
for command in '' 'empty /tmp' 'check extra' 'authorise extra' 'empty extra' 'run'; do
	read -r -a arguments <<<"$command"
	output=$(launch_app "$PWD/build/TrashHelper.app" "${arguments[@]}")
	[[ $output == $'64\nUsage: empty-trash check|authorise|empty' ]]
done
for command in '' 'empty /tmp' 'check extra' 'authorise extra' 'empty extra' 'run'; do
	read -r -a arguments <<<"$command"
	set +e
	output=$(bash empty-trash "${arguments[@]}" 2>&1)
	status=$?
	set -e
	[[ $status == 64 && $output == 'Usage: empty-trash check|authorise|empty' ]]
done
codesign --verify --strict build/TrashHelper.app
python3 - <<'PY'
import plistlib
import subprocess
signature = subprocess.run(
    ['codesign', '-d', '--entitlements', ':-', 'build/TrashHelper.app'],
    capture_output=True, check=True,
)
entitlements = plistlib.loads(signature.stdout)
assert entitlements == {
    'com.apple.security.app-sandbox': True,
    'com.apple.security.automation.apple-events': True,
    'com.apple.security.scripting-targets': {
        'com.apple.finder': ['com.apple.finder.trash'],
    },
}, entitlements
signature = subprocess.run(
    ['codesign', '-d', '--verbose=4', 'build/TrashHelper.app'],
    capture_output=True, check=True, text=True,
)
assert 'runtime' in signature.stderr
PY
probe=build/SandboxProbe.app
mkdir -p "$probe/Contents/MacOS"
xcrun clang -Wall -Wextra -Werror -framework Foundation sandbox-probe.m \
	-o "$probe/Contents/MacOS/trash-helper"
python3 - <<'PYINFO'
import plistlib
from pathlib import Path
info = plistlib.loads(Path('Info.plist').read_bytes())
info['CFBundleIdentifier'] = 'uk.connorads.trash-helper.sandbox-probe'
Path('build/SandboxProbe.app/Contents/Info.plist').write_bytes(plistlib.dumps(info))
PYINFO
codesign --force --sign - --options runtime --entitlements entitlements.plist "$probe"
output=$(launch_app "$PWD/$probe" "$PWD/README.md")
[[ $output == 'read-outside-container-denied=1 network-denied=1' ]]
printf '%s\n' 'PASS: invalid inputs rejected; signature, hardened runtime and narrow entitlements verified.'
