@echo off
cd /d "%~dp0"
call "%~dp0install.cmd"
if errorlevel 1 ( echo. & echo Installation failed. & pause & exit /b 1 )
echo.
echo Installed. Run XavierAssetPermision in a new PowerShell window.
pause
