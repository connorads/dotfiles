:cache_directory_failed
echo impeccable: engine %version% is not installed; cannot create cache directory: "%IMPECCABLE_HOME%\bin\%version%" 1>&2
goto setup_failed

:cache_write_failed
echo impeccable: engine %version% is not installed; cannot write to cache directory: "%IMPECCABLE_HOME%\bin\%version%" 1>&2
goto setup_failed

:curl_missing
echo impeccable: cannot download engine %version%; curl.exe is unavailable. 1>&2
goto setup_failed

:download_failed
del "%cached%.part" >nul 2>nul
echo impeccable: could not download engine %version% from %url%; check network access and the release URL. 1>&2

:setup_failed
echo Engine %version% setup needs network access and write permission to "%IMPECCABLE_HOME%\bin\%version%". 1>&2
echo Run this launcher ("%~f0") with engine-probe in a terminal that has those permissions, then retry the original command. 1>&2
echo Alternatively, set IMPECCABLE_HOME to a writable cache location, or IMPECCABLE_BIN to a preinstalled engine binary. 1>&2
exit /b 127

:fail
del "%cached%.part" >nul 2>nul
echo impeccable: no engine binary found (looked in %bin%, %cached%, PATH). 1>&2
echo Download impeccable-windows-%arch%.exe from https://github.com/pbakaus/impeccable/releases (tag engine-v%version%) and save it as %cached%, or set IMPECCABLE_BIN to a preinstalled engine binary. Docs: https://impeccable.style 1>&2
exit /b 127
