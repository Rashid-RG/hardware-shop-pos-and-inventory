@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop-local.ps1
if errorlevel 1 (
  echo Shutdown check did not pass. No process or database was stopped.
  pause
  exit /b 1
)
pause
