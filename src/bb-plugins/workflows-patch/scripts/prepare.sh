#!/usr/bin/env bash
set -euo pipefail

package_root=$(cd "$(dirname "$0")/.." && pwd)
destination=${1:?Pass a new source directory}
if [ -e "$destination" ]; then
	echo "Source directory exists: $destination" >&2
	exit 1
fi

read -r repository tag revision < <(
	python3 -c 'import json,sys; pin=json.load(open(sys.argv[1])); print(pin["repository"], pin["tag"], pin["commit"])' "$package_root/pins.json"
)
git clone --depth 1 --filter=blob:none --branch "$tag" "$repository" "$destination"
actual=$(git -C "$destination" rev-parse HEAD)
if [ "$actual" != "$revision" ]; then
	echo "Expected BB revision $revision, found $actual" >&2
	exit 1
fi
for patch_file in "$package_root"/patches/*.patch; do
	git -C "$destination" apply --check "$patch_file"
	git -C "$destination" apply "$patch_file"
done
