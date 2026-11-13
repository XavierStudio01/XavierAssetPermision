@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Always install from this script's own folder. Never pass a quoted %~dp0 to npm pack
rem through FOR /F: it breaks on paths containing spaces such as "Xavier Suite".
pushd "%~dp0"
if errorlevel 1 (
  echo [ERROR] Cannot access the extracted XavierAssetPermision folder.
  exit /b 1
)
title Xavier Studio Asset Permision - CLI Installer
echo.
echo  XAVIER STUDIO ASSET PERMISION
echo  ==============================================
echo  Installing XavierAssetPermision for Windows
echo.
where node.exe >nul 2>&1
if errorlevel 1 goto neednode
where npm.cmd >nul 2>&1
if errorlevel 1 goto neednode
for /f "delims=" %%V in ('node -p "parseInt(process.versions.node,10)"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto neednode
if %NODE_MAJOR% LSS 22 (
  echo [ERROR] Node.js 22.15 or newer is required. Found major version %NODE_MAJOR%.
  goto failed
)
rem Native ZSTD support is required for the Roblox binary scanner.
node -e "process.exit(typeof require('node:zlib').zstdDecompressSync==='function'?0:1)"
if errorlevel 1 (
  echo [ERROR] Update Node.js to 22.15+ or 24 LTS for built-in ZSTD support.
  goto failed
)
if not exist "package.json" (
  echo [ERROR] Missing package.json. Extract the whole ZIP before installing.
  goto failed
)
for /f "delims=" %%V in ('node -p "require('./package.json').version"') do set "APP_VERSION=%%V"
if not defined APP_VERSION (
  echo [ERROR] Cannot read package version.
  goto failed
)
set "PACK_DIR=%TEMP%\XavierAssetPermision-%RANDOM%-%RANDOM%"
mkdir "%PACK_DIR%" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Cannot create temporary installation directory.
  goto failed
)
set "PACK_FILE=%PACK_DIR%\xavier-asset-permision-%APP_VERSION%.tgz"
echo [1/3] Preparing the CLI package from this ZIP...
rem Passing . instead of a quoted source path also works under folders with spaces.
call npm.cmd pack . --pack-destination "%PACK_DIR%" --silent
if errorlevel 1 goto pack_failed
if not exist "%PACK_FILE%" (
  echo [ERROR] npm pack did not generate the expected package.
  goto pack_failed
)
echo [2/3] Installing CLI...
call npm.cmd install --global "%PACK_FILE%" --no-audit --no-fund
if errorlevel 1 goto install_failed
rem Remove the temporary file; users never need to download or manage a .tgz.
rmdir /s /q "%PACK_DIR%" >nul 2>&1
set "PACK_DIR="
set "NPM_PREFIX="
for /f "delims=" %%P in ('call npm.cmd prefix -g 2^>nul') do set "NPM_PREFIX=%%P"
if not defined NPM_PREFIX (
  echo [ERROR] npm installed, but global npm prefix could not be determined.
  goto failed
)
echo [3/3] Repairing Windows PowerShell command and verifying installation...
rem PowerShell prioritizes generated .ps1 shims, which can be blocked by Execution Policy.
rem Delete ONLY this package's .ps1 shim when its matching .cmd exists.
for %%N in (XavierAssetPermision xavierassetpermision xavierasetpermision xavierassetpermission) do (
  if exist "%NPM_PREFIX%\%%N.cmd" (
    if exist "%NPM_PREFIX%\%%N.ps1" del /f /q "%NPM_PREFIX%\%%N.ps1" >nul 2>&1
  )
)
if not exist "%NPM_PREFIX%\XavierAssetPermision.cmd" (
  echo [ERROR] CLI command was not created: "%NPM_PREFIX%\XavierAssetPermision.cmd"
  goto failed
)
call "%NPM_PREFIX%\XavierAssetPermision.cmd" --version
if errorlevel 1 (
  echo [ERROR] CLI was installed but did not pass the startup smoke test.
  goto failed
)
echo.
echo [OK] XavierAssetPermision v%APP_VERSION% is installed and tested.
echo [OK] Open a NEW PowerShell, then run: XavierAssetPermision
echo [INFO] Backup command: XavierAssetPermision.cmd
echo [INFO] PowerShell execution policy was NOT modified.
popd
exit /b 0
:pack_failed
echo [ERROR] Cannot prepare package. Source path or npm pack failed.
goto cleanup_failed
:install_failed
echo [ERROR] npm installation failed. See the real npm message above.
goto cleanup_failed
:cleanup_failed
if defined PACK_DIR if exist "%PACK_DIR%" rmdir /s /q "%PACK_DIR%" >nul 2>&1
:failed
popd
exit /b 1
:neednode
echo [ERROR] Node.js 22.15+ and npm.cmd must be installed first.
echo [INFO] Download Node.js LTS from https://nodejs.org/
popd
exit /b 1
