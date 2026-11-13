**Recommended Windows installer: `INSTALL-CLI.bat` or `install.cmd` (no PowerShell execution-policy changes).**

# CLI Installation — Windows

## One-time prerequisite
Install [Node.js LTS](https://nodejs.org/) 22.15+ (npm included). Open a new PowerShell and check:

```powershell
node -v
npm -v
```

## Install from ZIP downloaded from GitHub Release
Unzip `XavierAssetPermision_v1.3.1_Source_Windows.zip`, then:

```powershell
cd "FULL_PATH_TO_EXTRACTED_FOLDER\XavierAssetPermision"
cmd /c install.cmd
```

This installer does not change PowerShell Execution Policy. It also removes only this app’s generated `.ps1` global shim when its `.cmd` shim is present, so PowerShell can launch the application normally. If company security policy blocks software installation entirely, seek approval.

## Install from GitHub without cloning (after repository publication)

```powershell
npm.cmd install --global "https://github.com/aristore018-cpu/XavierAssetPermision/archive/refs/heads/main.tar.gz"
```

## Start

```powershell
XavierAssetPermision
```

On startup it checks the latest GitHub Release for updates, installs a newer stable release if possible, then starts its localhost dashboard. You may use `XavierAssetPermision --no-update` when offline.

## Troubleshooting

If PowerShell reports `XavierAssetPermision is not recognized`, close and reopen PowerShell, or check `npm config get prefix` to ensure the npm global binaries are on your PATH. Global install permission errors generally indicate npm prefix configuration rather than a problem with Roblox.

The application is local; the PowerShell window must remain open while the dashboard is running. Login secrets are encrypted locally with DPAPI on Windows. Uninstall with `npm.cmd uninstall --global xavier-asset-permision` or `UNINSTALL-CLI.cmd`; previously stored credentials are intentionally preserved until removed from Accounts or manually deleted.

## Fixed Windows path handling in v1.3.1

The installer runs `npm.cmd pack .` in the extracted source directory rather than passing a quoted absolute directory through `FOR /F`, preventing the malformed `package.json` path seen when the install folder contains spaces. A temporary .tgz is created and deleted automatically; **users download only one source ZIP**. Installer verifies the installed `.cmd` launcher using `--version` before reporting success.
