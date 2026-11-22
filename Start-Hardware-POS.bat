@echo off
setlocal

cd /d "%~dp0"

echo ========================================
echo   Hardware Shop POS - Starting...
echo ========================================
echo.
echo Please wait. This window must stay open.
echo.

start "" "http://localhost:3000"
npm run local:start

if errorlevel 1 (
  echo.
  echo Startup failed. Please call support.
  echo.
  pause
)
