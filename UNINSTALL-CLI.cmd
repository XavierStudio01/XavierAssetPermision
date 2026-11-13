@echo off
call npm.cmd uninstall --global xavier-asset-permision
if errorlevel 1 (echo [ERROR] Uninstall failed. & exit /b 1)
echo [OK] CLI removed.
