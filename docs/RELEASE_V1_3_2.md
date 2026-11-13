# Release v1.3.2 — XavierAssetPermision

Scanner now inspects readable Lua/Luau Source in Roblox model and place XML/binary files for module require(ID), pcall(require, ID), LoadAsset(ID), and named asset ID values. Candidate IDs must be checked against Roblox before granting permissions. Asset Library table is enlarged with internal scrolling.

## User install

Run `npm.cmd install -g "https://github.com/XavierStudio01/XavierAssetPermision/archive/refs/tags/v1.3.2.tar.gz"` after the official tag/release is published, then run `XavierAssetPermision`.

## Maintainer GitHub release

From the extracted source folder, run `cmd /c PUBLISH-UPDATE.cmd` to push and create v1.3.2 release. Review source first and never commit Roblox cookies or access tokens.
