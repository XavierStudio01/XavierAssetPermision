@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.15+ required. Run INSTALL-CLI.bat or install Node.js from https://nodejs.org/
  pause
  exit /b 1
)
node bin\xavier.js
if errorlevel 1 pause
