# Deskland 宿主构建：官方 .NET SDK 编译（SDK-style csproj / net48 / C# 12）。
# 替代原先的 csc.exe 直编；WebView2 由 NuGet 包还原，不再手工下载 SDK zip。
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$bin = Join-Path $root 'bin'
New-Item -ItemType Directory -Force $bin | Out-Null

# .NET SDK 不在 PATH 时用本机全路径（与测试脚本一致）
$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if ($dotnet) { $dotnet = $dotnet.Source } else { $dotnet = Join-Path $env:LOCALAPPDATA 'Microsoft\dotnet\dotnet.exe' }
if (-not (Test-Path -LiteralPath $dotnet)) { throw "找不到 .NET SDK：$dotnet" }

# 版本号唯一来源：tools/build/version.json
$appVersion = (Get-Content -LiteralPath (Join-Path $root '..\tools\build\version.json') -Raw | ConvertFrom-Json).version
if ($appVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid application version' }

& $dotnet build (Join-Path $root 'Deskland.csproj') -c Debug -p:AppVersion=$appVersion -warnaserror -v:m
if ($LASTEXITCODE -ne 0) { throw "dotnet build 失败（exit $LASTEXITCODE）" }

# 图标随 exe 一起分发（打包脚本按 host\bin\DesklandPlus.ico 取）
Copy-Item -LiteralPath (Join-Path $root 'DesklandPlus.ico') -Destination (Join-Path $bin 'DesklandPlus.ico') -Force

# 前端产物：frontend/dist → bin/prototype（宿主把 app.local 映射到这里）
$frontDist = Join-Path $root '..\frontend\dist'
if (-not (Test-Path -LiteralPath $frontDist)) { throw "缺少前端产物：$frontDist（先跑 frontend\scripts\build.ps1）" }
$proto = Join-Path $bin 'prototype'
if (Test-Path -LiteralPath $proto) {
    # 清空旧产物（逐个删除，避免已移除的资源残留，如 thumbs-data.js）
    Get-ChildItem -LiteralPath $proto -Recurse -File -Force | Remove-Item -Force -Confirm:$false
    Get-ChildItem -LiteralPath $proto -Recurse -Directory -Force | Sort-Object -Property FullName -Descending | Remove-Item -Force -Confirm:$false
}
New-Item -ItemType Directory -Force -Path $proto | Out-Null
Copy-Item -Path (Join-Path $frontDist '*') -Destination $proto -Recurse -Force
Write-Host "前端产物已复制：$proto"
Write-Host "编译完成：$bin\Deskland.exe"
