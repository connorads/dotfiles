:download
rem LOCAL PATCH: never download an engine during a design task.
echo impeccable: no installed engine found; use project files and design references directly. Engine setup is a separate task. 1>&2
exit /b 127

:catalogue_maintenance
echo impeccable: use the reviewed catalogue maintenance workflow for installation and updates 1>&2
exit /b 2
