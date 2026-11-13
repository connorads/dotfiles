@echo off
rem LOCAL PATCH: catalogue launcher.
setlocal EnableExtensions
rem LOCAL PATCH: installation and updates belong to catalogue maintenance.
set "IMPECCABLE_NO_UPDATE_CHECK=1"
set "IMPECCABLE_NO_TELEMETRY=1"
if /I "%~1"=="install" goto catalogue_maintenance
if /I "%~1"=="link" goto catalogue_maintenance
if /I "%~1"=="update" goto catalogue_maintenance
rem Impeccable launcher (Windows). Uses an existing engine from the explicit
rem override, sibling binary, user installation, version cache or PATH.
rem Unversioned user and PATH engines must pass the engine-probe handshake.
rem The sibling binary must report the pinned VERSION, and the version cache
rem must match engine-checksums.txt.
rem Linear goto flow preserves argument characters without delayed expansion.
if not defined IMPECCABLE_SKILL_DIR set "IMPECCABLE_SKILL_DIR=%~dp0.."
if not defined IMPECCABLE_SELF set "IMPECCABLE_SELF=%~f0"
set "arch=x64"
if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "arch=arm64"

if not defined IMPECCABLE_BIN goto no_env_bin
if not exist "%IMPECCABLE_BIN%" goto no_env_bin
set "run=%IMPECCABLE_BIN%"
goto run
:no_env_bin

set "version="
if exist "%~dp0VERSION" set /p version=<"%~dp0VERSION"
set "bin=%~dp0bin\windows-%arch%\impeccable.exe"
if not exist "%bin%" goto no_sibling
if defined IMPECCABLE_LAUNCHER_PROBE goto sibling_ok
if not defined version goto sibling_ok
call :probe "%bin%"
if "%probe_version%"=="%version%" goto sibling_ok
if not defined probe_version set "probe_version=unknown"
echo impeccable: skipping "%bin%": it reports engine %probe_version% but this skill pins %version%; delete it to stop this warning 1>&2
goto no_sibling
:sibling_ok
set "run=%bin%"
goto run
:no_sibling

set "home_bin=%USERPROFILE%\.impeccable\bin\impeccable.exe"
if not exist "%home_bin%" goto no_home_bin
if defined IMPECCABLE_LAUNCHER_PROBE goto no_home_bin
call :probe "%home_bin%"
if not "%probe_ok%"=="1" goto no_home_bin
set "run=%home_bin%"
goto run
:no_home_bin

if not defined IMPECCABLE_HOME set "IMPECCABLE_HOME=%USERPROFILE%\.impeccable"
set "cached=%IMPECCABLE_HOME%\bin\%version%\impeccable.exe"
set "asset=impeccable-windows-%arch%.exe"
set "manifest=%~dp0engine-checksums.txt"
if not defined version goto no_cache
if not exist "%cached%" goto no_cache
call :read_expected
for %%f in ("%cached%") do set "size=%%~zf"
set "stamp="
if exist "%cached%.verified" for /f "usebackq tokens=1,2" %%s in ("%cached%.verified") do set "stamp=%%s"& set "stamp_size=%%t"
if not defined stamp goto cache_hash
if not "%stamp_size%"=="%size%" goto cache_hash
if /I "%stamp%"=="%expected%" goto cache_stamp_matches
if /I "%stamp%"=="%expected_x64%" goto cache_stamp_matches
goto cache_hash
:cache_stamp_matches
rem Newest first: the stamp must be listed before the binary it vouches for.
set "newest="
for /f "delims=" %%f in ('dir /b /a:-d /o:-d "%cached%*" 2^>nul') do if not defined newest set "newest=%%f"
if /I "%newest%"=="impeccable.exe.verified" goto cache_trusted
:cache_hash
call :sha256 "%cached%" "%TEMP%\impeccable-hash-%RANDOM%%RANDOM%.txt"
if not defined actual goto cache_unverified
if /I "%actual%"=="%expected%" goto cache_verified
if /I "%actual%"=="%expected_x64%" goto cache_verified
:cache_unverified
echo impeccable: cannot verify the cached engine "%cached%" against "%manifest%"; not using it 1>&2
goto no_cache
:cache_verified
(>"%cached%.verified" echo %actual% %size%) 2>nul
:cache_trusted
set "run=%cached%"
goto run
:no_cache

if defined IMPECCABLE_LAUNCHER_PROBE goto download
where impeccable >nul 2>nul
if errorlevel 1 goto download
call :probe impeccable
if not "%probe_ok%"=="1" goto download
impeccable %*
exit /b %errorlevel%

:download
rem LOCAL PATCH: never download an engine during a design task.
echo impeccable: no installed engine found; use project files and design references directly. Engine setup is a separate task. 1>&2
exit /b 127

:catalogue_maintenance
echo impeccable: use the reviewed catalogue maintenance workflow for installation and updates 1>&2
exit /b 2

:read_expected
rem Sets expected (and, on ARM64, expected_x64: Windows on ARM runs x64
rem binaries) from engine-checksums.txt.
call :manifest_digest "%asset%" expected
set "expected_x64="
if "%arch%"=="arm64" call :manifest_digest impeccable-windows-x64.exe expected_x64
exit /b 0

:manifest_digest
rem Sets the variable named %2 to the digest the first engine-checksums.txt
rem line for this version and asset %1 records, empty when there is none.
set "%~2="
if not exist "%manifest%" exit /b 0
for /f "usebackq tokens=1-3" %%a in ("%manifest%") do if "%%a"=="%version%" if /I "%%b"=="%~1" if not defined %~2 set "%~2=%%c"
exit /b 0

:sha256
rem Sets actual to the sha256 of %~1, empty when certutil fails. %~2 is the
rem scratch file for its output. Check certutil's status before parsing: its
rem error text on stdout is not a digest.
set "actual="
certutil -hashfile "%~1" SHA256 >"%~2" 2>nul
if errorlevel 1 goto sha256_done
for /f "usebackq skip=1 delims=" %%h in ("%~2") do if not defined actual set "actual=%%h"
if not defined actual goto sha256_done
set "actual=%actual: =%"
:sha256_done
del "%~2" >nul 2>nul
exit /b 0

rem LOCAL PATCH: no download staging or placement.

:run
"%run%" %*
exit /b %errorlevel%

:probe
rem Sets probe_ok=1 when %1 answers the engine handshake: prints
rem "impeccable-engine <version>" and exits 0, and probe_version to that
rem version. The 3.x npm CLI answers any unknown verb with "Unknown command",
rem exit 1, so it never passes.
set "probe_ok="
set "probe_version="
set "probe_tmp=%TEMP%\impeccable-probe-%RANDOM%%RANDOM%.txt"
set "IMPECCABLE_LAUNCHER_PROBE=1"
"%~1" engine-probe >"%probe_tmp%" 2>nul
set "probe_err=%ERRORLEVEL%"
set "IMPECCABLE_LAUNCHER_PROBE="
if not "%probe_err%"=="0" goto probe_done
findstr /b /c:"impeccable-engine" "%probe_tmp%" >nul 2>nul
if errorlevel 1 goto probe_done
set "probe_ok=1"
for /f "usebackq tokens=2" %%v in ("%probe_tmp%") do if not defined probe_version set "probe_version=%%v"
:probe_done
del "%probe_tmp%" >nul 2>nul
exit /b 0

rem LOCAL PATCH: engine installation is managed separately.
