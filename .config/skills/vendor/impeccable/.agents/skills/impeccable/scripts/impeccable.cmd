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

set "bin=%~dp0bin\windows-%arch%\impeccable.exe"
if not exist "%bin%" goto no_sibling
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

set "version="
if exist "%~dp0VERSION" set /p version=<"%~dp0VERSION"
if not defined IMPECCABLE_HOME set "IMPECCABLE_HOME=%USERPROFILE%\.impeccable"
set "cached=%IMPECCABLE_HOME%\bin\%version%\impeccable.exe"
if not defined version goto no_cache
if not exist "%cached%" goto no_cache
set "run=%cached%"
goto run
:no_cache

if defined IMPECCABLE_LAUNCHER_PROBE goto download
where impeccable >nul 2>nul
if errorlevel 1 goto download
call :probe impeccable
if not "%probe_ok%"=="1" goto download
impeccable %*
exit /b

:download
rem LOCAL PATCH: never download an engine during a design task.
echo impeccable: no installed engine found; use project files and design references directly. Engine setup is a separate task. 1>&2
exit /b 127

:catalogue_maintenance
echo impeccable: use the reviewed catalogue maintenance workflow for installation and updates 1>&2
exit /b 2
:run
"%run%" %*
exit /b

:probe
rem Sets probe_ok=1 when %1 answers the engine handshake: prints
rem "impeccable-engine <version>" and exits 0. The 3.x npm CLI answers any
rem unknown verb with "Unknown command", exit 1, so it never passes.
set "probe_ok="
set "probe_tmp=%TEMP%\impeccable-probe-%RANDOM%%RANDOM%.txt"
set "IMPECCABLE_LAUNCHER_PROBE=1"
"%~1" engine-probe >"%probe_tmp%" 2>nul
set "probe_err=%ERRORLEVEL%"
set "IMPECCABLE_LAUNCHER_PROBE="
if not "%probe_err%"=="0" goto probe_done
findstr /b /c:"impeccable-engine" "%probe_tmp%" >nul 2>nul
if not errorlevel 1 set "probe_ok=1"
:probe_done
del "%probe_tmp%" >nul 2>nul
exit /b 0

rem LOCAL PATCH: engine installation is managed separately.
