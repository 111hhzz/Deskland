# Deskland+ 发版：创建 / 复用 GitHub Release 并上传固定 7 个资产。
# 用法（仓库根）：pwsh -File tools/release/create-release.ps1
#
# 严格口径：
#   - 仓库名从 `git remote get-url origin` 解析（可用 GITHUB_REPO 覆盖），不再写死旧名。
#   - 代理取 $env:HTTPS_PROXY，未设置则直连（不写死端口）。
#   - tag/name 由 tools/build/version.json 派生（可用 -Tag/-Name 覆盖）。
#   - 发布前断言本地 HEAD == origin/main，避免把未推送的代码打进包。
#   - 缺资产、上传失败一律非零退出；幂等：已存在的 release / 资产会跳过复用。
param(
    [string]$Tag = '',
    [string]$Name = ''
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
. (Join-Path $PSScriptRoot '..\local.ps1')

$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\build\version.json') -Raw | ConvertFrom-Json).version
if ($Tag -eq '') { $Tag = 'v' + $version }
if ($Name -eq '') { $Name = 'Deskland+ ' + $version }

$repo = $env:GITHUB_REPO
if (-not $repo) {
    $remote = (git remote get-url origin)
    if ($remote -notmatch 'github\.com[:/](?<owner>[^/]+)/(?<repo>[^/]+?)(?:\.git)?$') {
        throw "无法从 origin 解析仓库名：$remote（可用 GITHUB_REPO=owner/repo 覆盖）"
    }
    $repo = "$($Matches['owner'])/$($Matches['repo'])"
}

$proxyParam = if ($env:HTTPS_PROXY) { @{ Proxy = $env:HTTPS_PROXY } } else { @{} }

$token = $env:GITHUB_TOKEN
if (-not $token) {
    $tokenFile = Join-Path $script:DesklandLocal '.gh_token'
    if (Test-Path -LiteralPath $tokenFile) { $token = (Get-Content -LiteralPath $tokenFile -Raw).Trim() }
}
if (-not $token) { throw 'Set GITHUB_TOKEN environment variable (or create .gh_token) with a GitHub PAT (repo scope).' }

# 发布前断言：HEAD 必须等于 origin/main
$head = (git rev-parse HEAD).Trim()
$originMain = (git rev-parse origin/main).Trim()
if ($head -ne $originMain) {
    throw "本地 HEAD ($head) != origin/main ($originMain)：请先同步主干（git fetch && git pull --ff-only）再发布。"
}

$headers = @{ 'Authorization' = 'token ' + $token; 'User-Agent' = 'deskland'; 'Accept' = 'application/vnd.github+json' }
$base = "https://api.github.com/repos/$repo"

$rj = $null
try {
    $existing = Invoke-WebRequest -Uri "$base/releases/tags/$Tag" -UseBasicParsing @proxyParam -Headers $headers
    $rj = $existing.Content | ConvertFrom-Json
    Write-Host ("Reusing release id=" + $rj.id + " tag=" + $rj.tag_name)
    $existingAssets = @{}
    foreach ($a in $rj.assets) { $existingAssets[$a.name] = $true }
} catch {
    # Not found: create below.
    $existingAssets = @{}
}

$notesPath = Join-Path (Join-Path $script:DesklandLocal 'dist') ("release-notes-" + $version + ".md")
if (-not (Test-Path -LiteralPath $notesPath)) { throw "Release notes missing: $notesPath" }
$notes = [IO.File]::ReadAllText($notesPath, (New-Object Text.UTF8Encoding($false)))

if (-not $rj) {
    $body = @{
        tag_name = $Tag
        target_commitish = 'main'
        name = $Name
        draft = $false
        prerelease = $false
        body = $notes
    } | ConvertTo-Json -Depth 4

    # Windows PowerShell 5.1 会把字符串 Body 按本地 ANSI(GBK) 字节发出，GitHub 按 UTF-8
    # 解析就会把中文全变成 '?'。显式转成 UTF-8 字节再发。
    $bodyBytes = [Text.Encoding]::UTF8.GetBytes($body)

    $release = Invoke-WebRequest -Uri "$base/releases" -Method Post -UseBasicParsing @proxyParam -Headers $headers -Body $bodyBytes -ContentType 'application/json'
    $rj = $release.Content | ConvertFrom-Json
    Write-Host ("Created release id=" + $rj.id + " tag=" + $rj.tag_name)
} else {
    # 复用已有 release 时同步正文与目标分支，避免旧正文 / 错误 target 流到用户手里。
    $patch = @{ body = $notes; target_commitish = 'main' } | ConvertTo-Json
    $patchBytes = [Text.Encoding]::UTF8.GetBytes($patch)
    Invoke-WebRequest -Uri "$base/releases/$($rj.id)" -Method Patch -UseBasicParsing @proxyParam -Headers $headers -Body $patchBytes -ContentType 'application/json' | Out-Null
    Write-Host ("Updated release body/target_commitish id=" + $rj.id)
}
Write-Host ("Upload URL: " + $rj.upload_url)

$assets = @(
  "Deskland-Preview-$version-win-x64-portable.zip",
  "Deskland-Preview-$version-win-x64-portable.zip.sha256",
  "Deskland-Preview-$version-win-x64-Setup.exe",
  "Deskland-Preview-$version-win-x64-Setup.exe.sha256",
  "Deskland-Preview-$version-win-x64-Setup.exe.manifest.json",
  "Deskland-Preview-$version-win-x64-source.zip",
  "Deskland-Preview-$version-win-x64-source.zip.sha256"
)
$uploadFailed = $false
foreach ($asset in $assets) {
    if ($existingAssets.ContainsKey($asset)) { Write-Host ("Already uploaded, skipping: " + $asset); continue }
    $path = Join-Path (Join-Path $script:DesklandLocal 'dist') $asset
    if (-not (Test-Path -LiteralPath $path)) { throw "缺少发布资产：$path" }
    $label = [uri]::EscapeDataString($asset)
    $upload = $rj.upload_url -replace '\{.*$', ''
    $uri = $upload + '?name=' + $label
    Write-Host ("Uploading " + $asset + " ...")
    try {
        $resp = Invoke-WebRequest -Uri $uri -Method Post -UseBasicParsing @proxyParam -Headers $headers `
            -ContentType 'application/octet-stream' -InFile $path -MaximumRedirection 5
        Write-Host ("  OK " + $resp.StatusCode)
    } catch {
        Write-Host ("  FAIL: " + $_.Exception.Message)
        $uploadFailed = $true
    }
}
if ($uploadFailed) { throw '部分资产上传失败；修复后重跑本脚本（幂等，会跳过已上传项）。' }

Write-Host ("Release page: https://github.com/$repo/releases/tag/$Tag")
