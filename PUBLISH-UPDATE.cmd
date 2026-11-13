@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0" || exit /b 1
set "REPO=XavierStudio01/XavierAssetPermision"
set "VERSION=1.3.2"
echo XAVIER STUDIO ASSET PERMISION - GITHUB UPDATE
where gh.exe >nul 2>&1 || (echo [ERROR] Install GitHub CLI & goto :failure)
where git.exe >nul 2>&1 || (echo [ERROR] Install Git & goto :failure)
set "LOGIN="
for /f "delims=" %%A in ('gh api user --jq .login 2^>nul') do set "LOGIN=%%A"
if /I not "%LOGIN%"=="XavierStudio01" (
 echo [ERROR] Login to XavierStudio01 with gh auth login --web
 goto :failure
)
set "WORK=%TEMP%\xavier-publish-%RANDOM%-%RANDOM%"
mkdir "%WORK%" >nul 2>&1 || goto :failure
echo [1/4] Clone repository...
call gh repo clone "%REPO%" "%WORK%\repo" -- --depth 1
if errorlevel 1 goto :failure
echo [2/4] Copy updated source...
robocopy "%CD%" "%WORK%\repo" /E /XD .git node_modules .venv /XF *.tgz *.zip *.log >nul
if errorlevel 8 goto :failure
git -C "%WORK%\repo" config user.name XavierStudio01
for /f "delims=" %%U in ('gh api user --jq .id') do set "GHUSERID=%%U"
git -C "%WORK%\repo" config user.email "%GHUSERID%+XavierStudio01@users.noreply.github.com"
git -C "%WORK%\repo" add -A
git -C "%WORK%\repo" diff --cached --quiet
if errorlevel 1 (
 git -C "%WORK%\repo" commit -m "v%VERSION%: update asset scanner and dashboard"
 if errorlevel 1 goto :failure
)
echo [3/4] Push to main...
git -C "%WORK%\repo" push origin HEAD:main
if errorlevel 1 goto :failure
echo [4/4] Publish release...
gh release view "v%VERSION%" --repo "%REPO%" >nul 2>&1
if errorlevel 1 (
 gh release create "v%VERSION%" --repo "%REPO%" --target main --title "XavierAssetPermision v%VERSION%" --notes "ModuleScript ID scanning and larger asset list panel."
 if errorlevel 1 goto :failure
)
echo [OK] Updated: https://github.com/%REPO%/releases/tag/v%VERSION%
if defined WORK if exist "%WORK%" rmdir /s /q "%WORK%" >nul 2>&1
popd
exit /b 0
:failure
echo [ERROR] Publish did not complete.
if defined WORK if exist "%WORK%" rmdir /s /q "%WORK%" >nul 2>&1
popd
exit /b 1
