rem Impeccable launcher (Windows). Runs bin\windows-<arch>\impeccable.exe next
rem to this file, else a cached or freshly downloaded engine binary.
rem
rem Structure notes (this file is exercised by dry parsing and string-level
rem tests, not yet on a real Windows machine):
rem - No multi-line parenthesized blocks: cmd expands %var% at block parse
rem   time, which made the old download path read back empty %url%/%cached%.
rem   Linear goto flow keeps every expansion on its own line, and avoids
rem   delayed expansion eating ! characters in user arguments.
rem - The unversioned user binary and the PATH candidate are validated with
rem   the engine-probe handshake (see :probe) so the retired 3.x npm CLI,
rem   whose bin is also named impeccable, is never exec'd. The sibling binary
rem   must also report the version in VERSION: it is not tracked, so a skill
rem   upgrade can leave an old engine in place. IMPECCABLE_BIN stays trusted.
rem - Downloads and the version-pinned cache are verified via certutil
rem   against engine-checksums.txt next to this file, and fail closed; a
rem   .verified stamp lets later runs skip hashing the cache while it holds
rem   the manifest digest and the binary's size and is not older than the
rem   binary. On ARM64 the arm64 asset is tried first and the x64 asset is the
rem   fallback (Windows on ARM runs x64 binaries), each only when the manifest
rem   has a line for it.
