@echo off
setlocal

cd /d "%~dp0"

if not exist backups mkdir backups

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set TIMESTAMP=%%i
set BACKUP_FILE=backups\hardware_pos_backup_%TIMESTAMP%.sql

echo ========================================
echo   Hardware Shop POS - Backing Up...
echo ========================================
echo.
echo Please wait. Do not close this window.
echo.

docker exec hardware-pos-postgres pg_dump -U postgres -d hardware_pos > "%BACKUP_FILE%"
if errorlevel 1 (
  echo.
  echo Backup failed.
  echo.
  pause
  exit /b 1
)

echo.
echo Backup created:
echo %CD%\%BACKUP_FILE%
echo.
pause
