# Last resort: fetch this version's binary for the current platform from the
# public release channel into the user cache. Needs network; sandboxes without
# egress preinstall the binary on PATH instead.
setup_help() {
  echo "Engine $version setup needs network access and write permission to $cache_root/bin/$version." >&2
  echo "Run this launcher ($0) with engine-probe in a terminal that has those permissions, then retry the original command." >&2
  echo "Alternatively, set IMPECCABLE_HOME to a writable cache location, or IMPECCABLE_BIN to a preinstalled engine binary." >&2
}
fetch_url() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 2 -o "$tmp" "$1" 2>/dev/null
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$tmp" "$1" 2>/dev/null
  else
    return 1
  fi
}
check_download() {
  download_file=${1:-$tmp}
  if [ ! -f "$download_file" ]; then
    rm -f "$tmp.sha256"
    echo "impeccable: download completed but the file was removed before execution: $url; check your antivirus quarantine or logs. Refusing to continue; do not disable protection." >&2
    exit 127
  fi
  if [ ! -s "$download_file" ]; then
    rm -f "$download_file" "$tmp.sha256"
    echo "impeccable: downloaded file is empty: $url; refusing the unverified download" >&2
    exit 127
  fi
}
if [ -n "$probing" ]; then
  # Inside another launcher's probe: no download, fail fast and quiet.
  exit 127
fi
if [ -n "$version" ] && [ "$os" != unknown ] && [ "$arch" != unknown ]; then
  base="${IMPECCABLE_DOWNLOAD_BASE:-https://github.com/pbakaus/impeccable/releases/download}"
  asset="impeccable-$os-$arch"
  [ "$os" = windows ] && asset="$asset.exe"
  url="$base/engine-v$version/$asset"
  tmp="$cache_root/bin/$version/.impeccable.part.$$"
  if ! mkdir -p "$cache_root/bin/$version" 2>/dev/null; then
    echo "impeccable: engine $version is not installed; cannot create cache directory: $cache_root/bin/$version" >&2
    setup_help
    exit 127
  fi
  # Check the actual staging file, not just directory existence: a cache from
  # an earlier run can be readable but no longer writable inside a sandbox.
  if ! (umask 077; : > "$tmp") 2>/dev/null; then
    echo "impeccable: engine $version is not installed; cannot write to cache directory: $cache_root/bin/$version" >&2
    setup_help
    exit 127
  fi
  fetched=0
  if fetch_url "$url"; then
    fetched=1
  elif [ "$os" = windows ] && [ "$arch" = arm64 ]; then
    # Windows on ARM runs x64 binaries; fall back when no arm64 asset exists.
    url="$base/engine-v$version/impeccable-windows-x64.exe"
    fetch_url "$url" && fetched=1
  fi
  if [ "$fetched" = 1 ]; then
    check_download
    # Fail closed: a freshly downloaded binary runs only after verifying
    # against its .sha256 sidecar. A sidecar that cannot be fetched, or a
    # machine with no sha256 tool, refuses the download instead of exec'ing
    # an unverified binary. (A binary already on PATH or in the cache that
    # passes engine-probe is unaffected.)
    sidecar_ok=0
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL --retry 2 -o "$tmp.sha256" "$url.sha256" 2>/dev/null && sidecar_ok=1
    elif command -v wget >/dev/null 2>&1; then
      wget -q -O "$tmp.sha256" "$url.sha256" 2>/dev/null && sidecar_ok=1
    fi
    check_download
    expected=""
    [ "$sidecar_ok" = 1 ] && expected=$(cut -d' ' -f1 < "$tmp.sha256")
    actual=""
    if command -v shasum >/dev/null 2>&1; then
      if digest=$(shasum -a 256 "$tmp" 2>/dev/null); then actual=${digest%% *}; fi
    elif command -v sha256sum >/dev/null 2>&1; then
      if digest=$(sha256sum "$tmp" 2>/dev/null); then actual=${digest%% *}; fi
    fi
    check_download
    rm -f "$tmp.sha256"
    if [ -z "$expected" ] || [ -z "$actual" ]; then
      rm -f "$tmp"
      echo "impeccable: cannot verify $url against $url.sha256 (sidecar unavailable or hashing failed); refusing the unverified download" >&2
      exit 127
    fi
    if [ "$actual" != "$expected" ]; then
      rm -f "$tmp"
      echo "impeccable: checksum mismatch downloading $url" >&2
      exit 127
    fi
    check_download
    if ! chmod +x "$tmp" 2>/dev/null; then
      check_download
      rm -f "$tmp"
      echo "impeccable: could not make the verified download executable: $url" >&2
      exit 127
    fi
    check_download
    if ! mv -f "$tmp" "$cached" 2>/dev/null; then
      check_download
      rm -f "$tmp"
      echo "impeccable: could not cache the verified download: $url" >&2
      exit 127
    fi
    check_download "$cached"
    exec "$cached" "$@"
  fi
  rm -f "$tmp" 2>/dev/null
  echo "impeccable: could not download engine $version from $url; check network access, the release URL, and curl or wget availability." >&2
  setup_help
  exit 127
fi

echo "impeccable: no engine binary for $os-$arch found (looked in $bin, $cached, PATH)." >&2
echo "Download impeccable-$os-$arch from https://github.com/pbakaus/impeccable/releases (tag engine-v$version) into $cache_root/bin/$version/impeccable$exe (then chmod +x), or set IMPECCABLE_BIN to a preinstalled engine binary. Docs: https://impeccable.style" >&2
exit 127
