# v1.3.2 — ModuleScript scanning and a larger asset list

The RBXM/RBXL importer detects readable Script, LocalScript and ModuleScript asset references including require(ID), pcall(require, ID), InsertService:LoadAsset(ID), and named asset configuration fields. IDs are candidates only and must be verified with Roblox before permission grants. The asset table is taller, with scroll contained inside the dashboard.

---

# Windows installer and RBX scanner update — v1.3.2

**Fixed packaging for Windows paths containing spaces (v1.3.2):** extract this archive, double-click `INSTALL-CLI.bat` or run `cmd /c install.cmd` from PowerShell. Installer uses no PowerShell scripts. Installer uses `npm.cmd` and removes only this application's `.ps1` shim when the corresponding `.cmd` launcher exists, so `XavierAssetPermision` works in PowerShell without changing Execution Policy. A managed corporate policy may still block software installs.

**Import Roblox Studio files:** Asset Library → **Paste Asset IDs** → **Import file**. Read-only offline extraction from `.rbxm`, `.rbxl`, `.rbxmx` and `.rbxlx` (binary LZ4/ZSTD + XML). Candidate IDs are recognized only from `rbxassetid://` / official Roblox asset URLs / explicit asset properties, not random numeric text. They are **not** proven to exist or belong to the logged-in account until Roblox ownership inspection returns verified. Private/unavailable/unmanaged assets remain blocked from grant. ZSTD decompression uses native Node.js 22.15+ (`node:zlib`) — there are no npm dependencies to download. Input file max 128 MB, 5,000 unique candidate IDs per paste.

**GitHub publish:** on maintainer PC, run `PUBLISH-GITHUB.cmd` and `RELEASE-GITHUB.cmd` (requires authenticated `gh` and `git`). Repo may not exist yet; no release is assumed.

---

# XAVIER STUDIO ASSET PERMISION

**XavierAssetPermision v1.3.2** — Windows-first, local CLI + web dashboard for Roblox asset permissions. No hosted Xavier backend, subscriptions, or browser extensions.

> Status: tested with simulated Roblox HTTP responses and a local server. Actual Roblox account discovery and permission grants need verification on your own authorized account. The Roblox API and rate limits can change.

![License](https://img.shields.io/badge/license-Source--Available-gray) ![Node](https://img.shields.io/badge/node-%3E%3D20-lightgrey)

## Quick installation (Windows PowerShell)

Requires **Node.js 22.15 or newer** (includes npm). Run **inside the extracted folder**. Only one ZIP download is needed:

```powershell
cd "$HOME\Downloads\XavierAssetPermision_v1.3.2_Source_Windows\XavierAssetPermision"
cmd /c install.cmd
```

Or double-click `INSTALL-CLI.bat`. The installer uses a temporary npm archive internally, then deletes it. **No separate .tgz download or PowerShell policy override is needed.**

Open a **new** PowerShell window, then:

```powershell
XavierAssetPermision
```

The app opens `http://127.0.0.1:<random-port>` in your browser. The PowerShell console owns the server; close it to stop. If the command isn't found, reopen the terminal or run `npm config get prefix` to check the global npm folder's PATH.

**When the public repo exists**, anyone can install without downloading the ZIP:

```powershell
npm.cmd install -g "https://github.com/XavierStudio01/XavierAssetPermision/archive/refs/heads/main.tar.gz"
XavierAssetPermision
```

If using a tagged release, install the **tagged archive**, e.g. `https://github.com/XavierStudio01/XavierAssetPermision/archive/refs/tags/v1.3.2.tar.gz`. Node.js must already be installed.

## Auto-update on CLI startup

When you run `XavierAssetPermision`, the program requests `releases/latest` from the **official GitHub repository only**. If a newer stable `vMAJOR.MINOR.PATCH` GitHub Release exists, it attempts to run `npm install --global` for that version, then restarts the updated CLI. A failed or offline check **does not block the locally installed app**. This requires connectivity, npm, and permission to install global npm packages. Windows clients use `npm.cmd`; installation and updates clean up only the app-specific `.ps1` shims when a `.cmd` counterpart exists.

```powershell
XavierAssetPermision --no-update   # start without checking GitHub
XavierAssetPermision --no-browser  # print URL without opening browser
XavierAssetPermision --version
XavierAssetPermision --help
```

**An ordinary push/commit alone does not trigger updates**. The publisher must create a versioned GitHub Release after merging a new version (see `docs/PUBLISH_GITHUB.md`). No arbitrary GitHub Actions or third-party update endpoints are executed. Autoupdate installs source code published by the repository owner; users should trust that maintainer before installing.

## CLI installer regression fix (v1.3.2)

The old v1.3.0 installer combined a quoted absolute source path with `--pack-destination` within a `FOR /F` command, resulting in npm trying to open a malformed `package.json` path under `Xavier Suite`. The new installer calls `npm.cmd pack .` from the project directory, checks the expected archive, runs `npm.cmd install -g` from that archive, removes its temporary directory, and only reports success after running the installed command with `--version`. Failed steps return a nonzero exit code. On Windows the cmd launcher is used and only this application's matching `.ps1` shims are removed.

If an earlier failed attempt left a broken CLI, install v1.3.2 over it. If npm reports EEXIST, run `npm.cmd uninstall -g xavier-asset-permision` and retry the new `install.cmd`. Stored Roblox account data is not removed by npm uninstall.

## Dashboard and workflow

1. Open **Accounts**, paste your own `.ROBLOSECURITY` cookie into the local form. Auto-login starts after paste (or click Connect). Session is validated via Roblox; no fake login success.
2. On successful login the app automatically starts **three independent discoveries**: assets, friend list, and group memberships. A failure in one API is displayed without discarding the others. Switching to **Paste Asset IDs** interrupts the background library scan to prioritize pasted IDs.
3. **Asset Library** has selectable categories: Music/Audio, Animation, Model, Mesh, MeshPart, Decal, Image, Video, Place. Switch between **My Assets** (account library) and **Paste Asset IDs** (independent manual ID queue). Each mode supports category filtering, multi-selection, `Select this category`, and `Select all eligible`. Selected IDs from both modes remain selected when you switch. Paste supports CSV, whitespace, and `rbxassetid://` links and begins verification automatically.
4. **Permissions**: select one or all friends, one or all joined groups, or manually add `User`, `Group`, and `Universe` IDs. Roblox group memberships show role, rank, and ownership, but **being a group member does not automatically confer asset management rights**.
5. Choose `Use` (default) or a supported special action. Review changes, confirm, and run batch. View processed / succeeded / failed counts with Roblox error results and a cancellation button.
6. **Accounts** allows multiple saved identities; each cookie re-login updates the existing account instead of generating duplicates. Cookies are Windows DPAPI-encrypted per Windows user. On non-Windows systems sessions are memory-only, not persisted.

### Roblox permission compatibility

| Type | Permission to User / Group / Universe | Public Everyone |
| --- | --- | --- |
| Audio / Animation | Use | Not supported |
| Model | Use; Edit only to User | Not supported |
| Decal / Image / Mesh | Use | Use |
| MeshPart / Video | Use | Not supported |
| Place | Special `CopyFromRcc`, `UpdateFromRcc` for Universe only | Special `Download` |

**All Assets** means all the scanned / imported **supported** categories. It does *not* mean every item, clothing, game pass, and UGC object that exists on Roblox. Group-owned assets may not appear in personal creations scanning; paste their IDs and use an account with management authority. Pasted IDs are looked up against Roblox metadata to identify the **creator, asset type and ownership**. `Owned by you` and `Managed group` are selectable. `Not owned` and `Unverified` are blocked, not silently treated as owned. Pasted selections run **before** library selections. Roblox retains final authority to accept or reject grants; success is counted only from actual `successAssetIds`.

## Two selection modes (v1.2)

**My Assets** loads your account creations and lets you filter by Audio/Music, Animation, Model, Mesh, MeshPart, Decal, Image, Video, and Place. Select individual rows, a category, or every loaded eligible row.

**Paste Asset IDs** is a separate high-priority queue. Paste 600+ IDs (up to 5,000 unique IDs per paste), separated by commas, spaces, or newlines, and the dashboard automatically checks metadata in groups of 50. Checks run four at a time inside each chunk, with rate-limit handling. For each ID the UI displays the real asset type, creator and verification state:

- **Owned by you** — creator ID matches the logged-in Roblox user; grant enabled.
- **Managed group** — creator is a Roblox group whose management role is confirmed by Roblox; grant enabled (Roblox still checks grant authorization).
- **Not owned** — belongs to a different user or a group you cannot manage; grant disabled.
- **Unverified** — asset was unavailable, type unsupported, or access could not be confirmed; grant disabled.

Pasting cancels an active background discovery scan, so it doesn't compete with the manually supplied IDs. Selections from both modes persist; jobs process pasted IDs first. Server-side verification cache lasts 20 minutes and prevents granting arbitrary fabricated asset records through the dashboard API. Refresh a verification after it expires. Asset ID metadata lookup uses Roblox's economy asset-details endpoint; metadata unavailable for a private or deleted asset is not guessed. The live Roblox grant endpoint is authoritative.

## Important security information

- `.ROBLOSECURITY` allows full account access and is more dangerous than a scoped API key. Never paste it into chat, GitHub Issues, source code, screenshots, or untrusted websites. Prefer API keys for limited grant-only usage (requires relevant Roblox scope; API key alone cannot scan private creations).
- This application listens on `127.0.0.1` only. Local browser requests are restricted with an in-memory request token, localhost Host / Origin checks, restrictive CSP, no remote scripts, and non-credential responses.
- No raw cookie is sent to a Xavier-owned server or GitHub; it is sent **only to official HTTPS Roblox endpoints** by the local process. GitHub receives only version requests for the updater, without Roblox credentials.
- On Windows, DPAPI protects credentials at rest against access from *other Windows profiles*, but not malware / software acting under your same Windows user account. Treat your PC as trusted.
- Use only assets that you own or manage and recipients that should have permission. Bulk grants are real changes to Roblox access policies.

## Diagnostics

- **Friends empty**: newer `/friends/find` returns IDs without names and supports pagination. The adapter retrieves names separately from `/v1/users`. When hydration fails, ID-only entries are shown instead of being hidden.
- **Groups empty**: uses `groups.roblox.com/v2/users/{userId}/groups/roles`. An account with no group memberships may genuinely return an empty list. Error messages distinguish a failed API request from a zero-result list.
- **Asset scan incomplete**: itemconfiguration `get-assets` can reject unsupported asset types or return rate limits / 5xx. Other categories remain usable; use **Paste Asset IDs** to verify and grant missing IDs. Source cannot auto-scan another creator's private inventory.
- **Permission denied**: confirm selected *owner account*, recipient kind (User/Group/Universe), asset type, and authorization; Roblox is final authority.
- **Cannot auto-update**: the repo must be public with a stable `v#.#.#` release. Otherwise app starts normally. Run `XavierAssetPermision --no-update` to skip updates.

## Publishing, release, and support

Read **[docs/PUBLISH_GITHUB.md](docs/PUBLISH_GITHUB.md)** for the repo creation/push/tag/release tutorial, and **[docs/INSTALL_CLI.md](docs/INSTALL_CLI.md)** for end-user installation / troubleshoot. `PUBLISH-GITHUB.cmd` (wrapper around `publish-github.ps1`) targets **only** `XavierStudio01/XavierAssetPermision`; it does not alter other repositories. `RELEASE-GITHUB.cmd` (wrapper around `release.ps1`) creates a GitHub Release using the current `package.json` version.

### Development / tests

```powershell
npm test
npm run check
node .\bin\xavier.js --no-update --no-browser
```

Roblox ZSTD-compressed binary files use native Node.js 22.15+ decoding; LZ4 is decoded internally. The npm package has no third-party runtime dependencies. Source layout: `src/` Roblox adapters, local API and DPAPI vault; `web/` frontend; `bin/` CLI; `test/` simulated Roblox response tests.

### License / remakes

© 2026 Xavier Studio. **All rights reserved.** Public source code does **not** grant automatic permission to reproduce, remake, fork, rebrand, or resell the application. Read [LICENSE](LICENSE). Request **written permission** through the repo owner before publishing adaptations. This is *source-available*, **not** MIT or an open-source license. Roblox trademarks remain with Roblox Corporation.

### Roblox developer documentation

- [Asset Permissions API v1](https://github.com/Roblox/creator-docs/blob/main/content/en-us/reference/cloud/asset-permissions-api/v1.json)
- [Roblox Friends API](https://create.roblox.com/docs/cloud/reference/features/friends)
- [Roblox Groups API](https://create.roblox.com/docs/cloud/reference/domains/groups)
- [Item Configuration API](https://create.roblox.com/docs/cloud/reference/domains/itemconfiguration)
