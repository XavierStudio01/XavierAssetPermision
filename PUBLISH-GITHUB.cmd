@echo off
cd /d "%~dp0"
where gh.exe >nul 2>&1
if errorlevel 1 ( echo [ERROR] GitHub CLI is required: winget install --id GitHub.cli -e & exit /b 1 )
where git.exe >nul 2>&1
if errorlevel 1 ( echo [ERROR] Git is required: winget install --id Git.Git -e & exit /b 1 )
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-github.ps1"
exit /b %errorlevel%
