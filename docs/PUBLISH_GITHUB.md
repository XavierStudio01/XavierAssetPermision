# GitHub Publish & Release — `aristore018-cpu/XavierAssetPermision`

This tool does **not** upload Roblox cookie files or DPAPI vault data. Only source code and documentation should go into the repository. Review `git status` before each push.

## 1. Prerequisites (maintainer PC)
Install [Git](https://git-scm.com/) and [GitHub CLI](https://cli.github.com/). In PowerShell:

```powershell
git --version
gh --version
gh auth login
gh auth status
gh api user --jq .login
```

The login must be **`aristore018-cpu`**. Switch accounts if necessary:

```powershell
gh auth switch
```

## 2. Create the public repository and upload source (one command)

Open PowerShell in the extracted project directory:

```powershell
cmd /c PUBLISH-GITHUB.cmd
```

The script initializes git, commits files, checks your GitHub identity, creates **only** `aristore018-cpu/XavierAssetPermision` when missing, and pushes `main`. It will not touch `XavierSpoofer`, the asset uploader, or any other repository.

If script reports `git commit failed`, configure the maintainer identity:

```powershell
git config --global user.name "YOUR_GITHUB_NAME"
git config --global user.email "YOUR_GITHUB_VERIFIED_EMAIL"
```

## 3. Create a versioned release to activate CLI updates

A commit on `main` does not automatically trigger end-user updates. Before publishing a new stable version, increment the **`version`** field in `package.json`, then commit and push that change. Create the matching release:

```powershell
cmd /c RELEASE-GITHUB.cmd
```

The release script creates tag `v1.3.1` (derived from `package.json`) and uploads a source ZIP to the GitHub Release. The CLI's auto-updater reads `https://api.github.com/repos/aristore018-cpu/XavierAssetPermision/releases/latest` and installs only stable semver tags from that repo.

## 4. Users install CLI

```powershell
npm.cmd install --global "https://github.com/aristore018-cpu/XavierAssetPermision/archive/refs/tags/v1.3.1.tar.gz"
XavierAssetPermision
```

Afterward, running `XavierAssetPermision` checks for newer stable GitHub Releases (unless `--no-update`).

## 5. Updating later

1. Change source and increment `package.json` version plus visible UI version labels.
2. Run `npm test` and `npm run check`, test with an authorized Roblox account.
3. Run `git add .`, `git commit -m "Release version..."`, and `git push origin main`.
4. Run `RELEASE-GITHUB.cmd` to create a new versioned tag and release.
5. A Windows client running the CLI will attempt the update at its next launch.

## License

The repository uses the **Xavier Studio Source-Available License**, not MIT. A public repository makes source viewable but not freely reusable for derivative distributions. Before publishing remakes / forks outside GitHub-hosted viewing features, obtain written permission from the project owner. No license can prevent independently written implementations of unprotected ideas; consult legal advice for enforceable protections in your jurisdiction.
