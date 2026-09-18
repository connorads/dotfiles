@echo off
rem LOCAL PATCH: catalogue launcher.
setlocal EnableExtensions
rem LOCAL PATCH: installation and updates belong to catalogue maintenance.
set "IMPECCABLE_NO_UPDATE_CHECK=1"
set "IMPECCABLE_NO_TELEMETRY=1"
if /I "%~1"=="install" goto catalogue_maintenance
if /I "%~1"=="link" goto catalogue_maintenance
if /I "%~1"=="update" goto catalogue_maintenance
