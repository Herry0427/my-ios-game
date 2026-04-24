@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [1/2] sync_football_baidu.py ...
python tools\sync_football_baidu.py
if errorlevel 1 goto SYNC_FAIL
echo.
echo [2/2] tests ...
python tools\sync_football_baidu.py --test
python tools\test_football_pipeline.py
echo Done. Deploy Worker: serverless deploy_worker.bat then set parent config.js
pause
exit /b 0

:SYNC_FAIL
echo Python failed.
pause
exit /b 1
