@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backup-local-postgres.ps1"
set "backup_status=%errorlevel%"
if not "%backup_status%"=="0" echo Backup failed. Review the message above.
pause
exit /b %backup_status%
