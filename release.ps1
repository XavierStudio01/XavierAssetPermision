$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$owner = 'XavierStudio01'
$repo = 'XavierAssetPermision'
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'Install GitHub CLI: https://cli.github.com/' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Install Git: https://git-scm.com/' }
$login = (& gh api user --jq '.login').Trim()
if ($login -ne $owner) { throw "Wrong GitHub login: $login. Expected $owner." }
$pkg = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'package.json') | ConvertFrom-Json
$tag = 'v' + $pkg.version
if ($tag -notmatch '^v\d+\.\d+\.\d+$') { throw 'Use package.json version MAJOR.MINOR.PATCH' }
if (git status --porcelain) { throw 'Uncommitted changes. Commit and push before releasing.' }
& git push origin main
if ($LASTEXITCODE -ne 0) { throw 'Git push failed. Check branch and remote.' }
& gh release view $tag --repo "$owner/$repo" *> $null
if ($LASTEXITCODE -eq 0) { throw "$tag already exists. Bump package.json version." }
$artifact = Join-Path $env:TEMP "XavierAssetPermision_$tag.zip"
if (Test-Path $artifact) { Remove-Item -LiteralPath $artifact -Force }
$tree = Join-Path $env:TEMP "xavier-asset-release-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tree | Out-Null
try {
    $zipRoot = Join-Path $tree 'XavierAssetPermision'
    New-Item -ItemType Directory -Path $zipRoot | Out-Null
    @('bin','src','web','docs','test','package.json','README.md','LICENSE','UNINSTALL-CLI.cmd','install.cmd','PUBLISH-GITHUB.cmd','RELEASE-GITHUB.cmd','scripts','publish-github.ps1','release.ps1','START-LOCAL.bat','INSTALL-CLI.bat','.gitignore') | ForEach-Object {
        $source = Join-Path $PSScriptRoot $_
        if (Test-Path $source) { Copy-Item -LiteralPath $source -Destination $zipRoot -Recurse -Force }
    }
    Compress-Archive -Path $zipRoot -DestinationPath $artifact -Force
    & gh release create $tag $artifact --repo "$owner/$repo" --target main --title "XavierAssetPermision $tag" --notes "Windows local CLI and source release $tag. See README.md for setup and permissions."
    if ($LASTEXITCODE -ne 0) { throw 'GitHub release create failed' }
    Write-Host "Release created: https://github.com/$owner/$repo/releases/tag/$tag" -ForegroundColor Green
} finally { Remove-Item -LiteralPath $tree -Recurse -Force -ErrorAction SilentlyContinue }
