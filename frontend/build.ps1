# 前端打包：frontend/src（源）→ frontend/dist（产物）。
# 产物为纯静态文件，供 host 构建时复制到 bin/prototype。
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent          # Deskland 仓库根
$src = Join-Path $PSScriptRoot 'src'
$dist = Join-Path $PSScriptRoot 'dist'
if (-not (Test-Path -LiteralPath $src)) { throw "缺少前端源目录：$src" }

# 清理并重建产物
if (Test-Path -LiteralPath $dist) { Get-ChildItem -LiteralPath $dist -File | Remove-Item -Force }
New-Item -ItemType Directory -Force -Path $dist | Out-Null

# 复制（保留目录结构）
Copy-Item -Path (Join-Path $src '*') -Destination $dist -Recurse -Force

# 校验关键入口存在
foreach ($need in @('settings.html', 'engine.html', 'themes.json', 'themes/base.css')) {
    if (-not (Test-Path -LiteralPath (Join-Path $dist $need))) { throw "产物缺少关键文件：$need" }
}

# 版本戳（缓存清理用）
$ver = (Get-Content -LiteralPath (Join-Path $root 'tools\version.json') -Raw | ConvertFrom-Json).version
[IO.File]::WriteAllText((Join-Path $dist 'version.txt'), $ver, (New-Object Text.UTF8Encoding($false)))

Write-Host "前端打包完成：$dist （$ver）"
