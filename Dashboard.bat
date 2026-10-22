@echo off
setlocal
cd /d "%~dp0"
title HRSystem Dashboard
rem Installed (the folder above holds current.txt): use the installation's own launcher, which starts the dashboard when it is off and opens its fixed address.
if exist "%~dp0..\current.txt" if exist "%~dp0..\Dashboard.bat" (
  call "%~dp0..\Dashboard.bat"
  exit /b 0
)
rem Development copy (not installed): starts the dashboard on this PC only and opens it. Close this window to stop it.
start "" "http://127.0.0.1:3700"
node server.mjs
pause
