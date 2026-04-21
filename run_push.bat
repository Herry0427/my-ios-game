@echo off
setlocal
cd /d "%~dp0"

echo Running one-click pull + push...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\push_once.ps1"

if errorlevel 1 (
  echo.
  echo FAILED. Please check the terminal output above.
  pause
  exit /b 1
)

echo.
echo DONE.
pause
