:download
rem Last resort: fetch this version's binary from the release channel into
rem the version-pinned user cache, verify it, then run it. Never inside
rem another launcher's probe: fail fast and quiet instead.
if defined IMPECCABLE_LAUNCHER_PROBE exit /b 127
if not defined version goto fail
where curl.exe >nul 2>nul
if errorlevel 1 goto curl_missing
if not defined IMPECCABLE_DOWNLOAD_BASE set "IMPECCABLE_DOWNLOAD_BASE=https://github.com/pbakaus/impeccable/releases/download"
if exist "%IMPECCABLE_HOME%\bin\%version%\" goto cache_ready
mkdir "%IMPECCABLE_HOME%\bin\%version%" >nul 2>nul
if errorlevel 1 goto cache_directory_failed
:cache_ready
rem Check the staging file too: an existing directory may be read-only.
rem Redirection failures do not reliably update ERRORLEVEL in cmd.exe;
rem branch on the command's failure directly. Never treat a directory as a
rem staging file (later del cleanup would prompt to delete its contents).
if exist "%cached%.part\" goto cache_write_failed
(type nul >"%cached%.part") 2>nul || goto cache_write_failed
set "asset=impeccable-windows-%arch%.exe"
set "url=%IMPECCABLE_DOWNLOAD_BASE%/engine-v%version%/%asset%"
curl.exe -fsSL -o "%cached%.part" "%url%" >nul 2>nul
if not errorlevel 1 goto verify
if not "%arch%"=="arm64" goto download_failed
set "asset=impeccable-windows-x64.exe"
set "url=%IMPECCABLE_DOWNLOAD_BASE%/engine-v%version%/%asset%"
curl.exe -fsSL -o "%cached%.part" "%url%" >nul 2>nul
if errorlevel 1 goto download_failed

:verify
call :check_download
if errorlevel 1 exit /b 127
rem Mirrors the sh launcher and fails closed: a freshly downloaded binary
rem runs only after verifying against its .sha256 sidecar. A sidecar that
rem cannot be fetched, or an empty certutil result, refuses the download
rem instead of running an unverified binary.
curl.exe -fsSL -o "%cached%.sha256" "%url%.sha256" >nul 2>nul
if errorlevel 1 goto verify_refuse
set "expected="
set /p expected=<"%cached%.sha256"
for /f "tokens=1" %%h in ("%expected%") do set "expected=%%h"
call :check_download
if errorlevel 1 exit /b 127
set "actual="
rem Reuse the sidecar staging file after reading expected. Check certutil's
rem status before parsing: its error text on stdout is not a digest.
certutil -hashfile "%cached%.part" SHA256 >"%cached%.sha256" 2>nul
if errorlevel 1 goto verify_refuse
call :check_download
if errorlevel 1 exit /b 127
for /f "usebackq skip=1 delims=" %%h in ("%cached%.sha256") do if not defined actual set "actual=%%h"
del "%cached%.sha256" >nul 2>nul
if not defined expected goto verify_refuse
if not defined actual goto verify_refuse
set "actual=%actual: =%"
if /I "%actual%"=="%expected%" goto place
del "%cached%.part" >nul 2>nul
echo impeccable: checksum mismatch downloading %url% 1>&2
exit /b 127

:verify_refuse
call :check_download
if errorlevel 1 exit /b 127
del "%cached%.part" >nul 2>nul
del "%cached%.sha256" >nul 2>nul
echo impeccable: cannot verify %url% against %url%.sha256; refusing the unverified download 1>&2
exit /b 127

:check_download
set "download_file=%~1"
if not defined download_file set "download_file=%cached%.part"
if not exist "%download_file%" goto download_missing
for %%f in ("%download_file%") do if %%~zf==0 goto download_empty
exit /b 0

:download_missing
del "%cached%.sha256" >nul 2>nul
echo impeccable: download completed but the file was removed before execution: %url%; check your antivirus quarantine or logs. Refusing to continue; do not disable protection. 1>&2
exit /b 127

:download_empty
del "%download_file%" >nul 2>nul
del "%cached%.sha256" >nul 2>nul
echo impeccable: downloaded file is empty: %url%; refusing the unverified download 1>&2
exit /b 127

:place
call :check_download
if errorlevel 1 exit /b 127
move /y "%cached%.part" "%cached%" >nul 2>nul
if errorlevel 1 goto place_failed
call :check_download "%cached%"
if errorlevel 1 exit /b 127
set "run=%cached%"
goto run

:place_failed
call :check_download
if errorlevel 1 exit /b 127
del "%cached%.part" >nul 2>nul
echo impeccable: could not cache the verified download: %url% 1>&2
exit /b 127

