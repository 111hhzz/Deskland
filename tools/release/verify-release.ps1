# 校验已发布的 Release：资产齐全、大小可读。
# 用法（仓库根）：pwsh -File tools/release/verify-release.ps1   （默认校验当前 version.json 对应的 tag）
param([string]$Tag = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\local.ps1')
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\build\version.json') -Raw | ConvertFrom-Json).version
if ($Tag -eq '') { $Tag = 'v' + $version }

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

$headers = @{ 'Authorization' = 'token ' + $token; 'User-Agent' = 'deskland'; 'Accept' = 'application/vnd.github+json' }
$r = Invoke-WebRequest -Uri "https://api.github.com/repos/$repo/releases/tags/$Tag" -UseBasicParsing @proxyParam -Headers $headers
$j = $r.Content | ConvertFrom-Json
Write-Host ("Release: " + $j.name + " tag=" + $j.tag_name + " url=" + $j.html_url)
foreach ($a in $j.assets) {
    Write-Host ("- " + $a.name + "  " + [math]::Round($a.size/1MB,2) + " MB  url=" + $a.browser_download_url)
}
if ($j.assets.Count -lt 7) { throw ("资产不齐全：期望 >= 7，实际 " + $j.assets.Count) }
Write-Host "✅ 资产齐全"
