:check_download
set "download_file=%~1"
if not defined download_file set "download_file=%part%"
if not exist "%download_file%" goto download_missing
for %%f in ("%download_file%") do if %%~zf==0 goto download_empty
exit /b 0

:download_missing
call :discard_staging
echo impeccable: download completed but the file was removed before execution: %url%; check your antivirus quarantine or logs. Refusing to continue; do not disable protection. 1>&2
exit /b 127

:download_empty
del "%download_file%" >nul 2>nul
call :discard_staging
echo impeccable: downloaded file is empty: %url%; refusing the unverified download 1>&2
exit /b 127

:discard_staging
rem Removes this run's staging directory and whatever is left in it. Never
rem touches another run's staging directory or the cached binary.
if defined staging rd /s /q "%staging%" >nul 2>nul
exit /b 0

:place
call :check_download
if errorlevel 1 exit /b 127
move /y "%part%" "%cached%" >nul 2>nul
if errorlevel 1 goto place_failed
call :discard_staging
call :check_download "%cached%"
if errorlevel 1 exit /b 127
for %%f in ("%cached%") do set "size=%%~zf"
(>"%cached%.verified" echo %actual% %size%) 2>nul
set "run=%cached%"
goto run

:place_failed
call :check_download
if errorlevel 1 exit /b 127
call :discard_staging
echo impeccable: could not cache the verified download: %url% 1>&2
exit /b 127
