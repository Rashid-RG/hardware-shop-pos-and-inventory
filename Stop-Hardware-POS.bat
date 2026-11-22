@echo off
setlocal

cd /d "%~dp0"

echo ========================================
echo   Hardware Shop POS - Stopping...
echo ========================================
echo.

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /PID %%a /F >nul 2>&1
)

docker compose stop >nul 2>&1

echo POS stopped.
echo.
pause
