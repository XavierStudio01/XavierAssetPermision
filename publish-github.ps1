$ErrorActionPreference = 'Stop'
$owner = 'aristore018-cpu'
$repo = 'XavierAssetPermision'
Set-Location $PSScriptRoot
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'Install GitHub CLI: https://cli.github.com/' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Install Git: https://git-scm.com/' }
& gh auth status
if ($LASTEXITCODE -ne 0) { throw 'Run gh auth login and choose GitHub.com before publishing.' }
$login = (& gh api user --jq '.login').Trim()
if ($login -ne $owner) { throw "Wrong GitHub account ($login). This project must publish to $owner. Run gh auth switch." }
if (-not (Test-Path .git)) { git init -b main }
git add .
if ($LASTEXITCODE -ne 0) { throw 'git add failed' }
$changes = git status --porcelain
if ($changes) {
    git commit -m 'Initial local-first Roblox asset permission manager'
    if ($LASTEXITCODE -ne 0) { throw 'git commit failed. Configure git user.name and user.email.' }
}
& gh repo view "$owner/$repo" --json name *> $null
if ($LASTEXITCODE -ne 0) {
    & gh repo create "$owner/$repo" --public --source . --remote origin --push
    if ($LASTEXITCODE -ne 0) { throw 'GitHub repository creation failed' }
} else {
    if (-not (git remote get-url origin 2>$null)) { git remote add origin "https://github.com/$owner/$repo.git" }
    git push --set-upstream origin main
    if ($LASTEXITCODE -ne 0) { throw 'Push failed; inspect existing branches before retrying.' }
}
Write-Host "Published: https://github.com/$owner/$repo" -ForegroundColor Green
