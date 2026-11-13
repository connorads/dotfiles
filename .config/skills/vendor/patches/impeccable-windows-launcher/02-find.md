:download
rem Last resort: fetch this version's binary from the release channel into
rem the version-pinned user cache, verify it, then run it. Never inside
rem another launcher's probe: fail fast and quiet instead.
if defined IMPECCABLE_LAUNCHER_PROBE exit /b 127
if not defined version goto fail
call :read_expected
if not defined expected if not defined expected_x64 goto no_checksum
where curl.exe >nul 2>nul
if errorlevel 1 goto curl_missing
if not defined IMPECCABLE_DOWNLOAD_BASE set "IMPECCABLE_DOWNLOAD_BASE=https://github.com/pbakaus/impeccable/releases/download"
if exist "%IMPECCABLE_HOME%\bin\%version%\" goto cache_ready
mkdir "%IMPECCABLE_HOME%\bin\%version%" >nul 2>nul
if errorlevel 1 goto cache_directory_failed
:cache_ready
rem Stage the download in a directory only this run owns, as the sh launcher
rem does with .impeccable.part.$$: concurrent first runs (parallel hooks, two
rem agents) must never write, hash or move each other's files. mkdir fails
rem when the name exists, so it claims the name atomically. RANDOM alone is
rem not enough because cmd seeds it from the clock in whole seconds; the
rem timestamp and the retry on collision keep same-second runs apart. A cache
rem directory that refuses every mkdir is reported as unwritable.
set "attempt=0"
:claim_staging
set /a attempt+=1
if %attempt% GTR 20 goto cache_write_failed
set "stamp=%TIME: =0%"
set "stamp=%stamp::=%"
set "stamp=%stamp:.=%"
set "stamp=%stamp:,=%"
set "staging=%IMPECCABLE_HOME%\bin\%version%\.impeccable.part.%stamp%-%RANDOM%%RANDOM%"
mkdir "%staging%" >nul 2>nul
if errorlevel 1 goto claim_staging
set "part=%staging%\impeccable.exe"
rem Redirection failures do not reliably update ERRORLEVEL in cmd.exe;
rem branch on the command's failure directly.
(type nul >"%part%") 2>nul || goto staging_write_failed
set "url=%IMPECCABLE_DOWNLOAD_BASE%/engine-v%version%/%asset%"
if not defined expected goto fetch_x64
curl.exe -fsSL -o "%part%" "%url%" >nul 2>nul
if not errorlevel 1 goto verify
:fetch_x64
if not defined expected_x64 goto download_failed
set "asset=impeccable-windows-x64.exe"
set "expected=%expected_x64%"
set "url=%IMPECCABLE_DOWNLOAD_BASE%/engine-v%version%/%asset%"
curl.exe -fsSL -o "%part%" "%url%" >nul 2>nul
if errorlevel 1 goto download_failed

:verify
call :check_download
if errorlevel 1 exit /b 127
rem Mirrors the sh launcher and fails closed: a freshly downloaded binary
rem runs only after its hash matches the digest read from engine-checksums.txt.
rem An empty certutil result refuses the download instead of running an
rem unverified binary.
call :sha256 "%part%" "%staging%\hash.txt"
call :check_download
if errorlevel 1 exit /b 127
if not defined actual goto verify_refuse
if /I "%actual%"=="%expected%" goto place
call :discard_staging
echo impeccable: checksum mismatch downloading %url% 1>&2
exit /b 127

:verify_refuse
call :check_download
if errorlevel 1 exit /b 127
call :discard_staging
echo impeccable: cannot verify %url% (certutil could not hash it); refusing the unverified download 1>&2
exit /b 127
