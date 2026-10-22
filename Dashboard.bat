@echo off
setlocal
cd /d "%~dp0"
title HRSystem Dashboard
rem Starts the dashboard on this PC only and opens it. Close this window to stop it.
start "" "http://127.0.0.1:3500"
node server.mjs
pause
