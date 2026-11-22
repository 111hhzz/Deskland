# 前端打包：frontend/src（源）→ frontend/dist（产物）。
# 产物为纯静态文件，供 host 构建时复制到 bin/prototype。
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot                              # frontend/scripts（本文件是工具，不属 src）
$front = Split-Path $here -Parent                  # frontend
$root = Split-Path $front -Parent                  # Deskland 仓库根
$src = Join-Path $front 'src'
$dist = Join-Path $front 'dist'
if (-not (Test-Path -LiteralPath $src)) { throw "缺少前端源目录：$src" }

# 清理并重建产物（枚举删除，避免子目录残留）
if (Test-Path -LiteralPath $dist) {
    Get-ChildItem -LiteralPath $dist -Recurse -File -Force | Remove-Item -Force -Confirm:$false
    Get-ChildItem -LiteralPath $dist -Recurse -Directory -Force | Sort-Object -Property FullName -Descending | Remove-Item -Force -Confirm:$false
}
New-Item -ItemType Directory -Force -Path $dist | Out-Null

# 复制（保留目录结构）
Copy-Item -Path (Join-Path $src '*') -Destination $dist -Recurse -Force

# 可选：esbuild 压缩 dist/assets（开发机装有 frontend/node_modules 才执行；无依赖时跳过）
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd -and (Test-Path (Join-Path $front 'node_modules\esbuild'))) {
    & node (Join-Path $here 'minify.mjs')
} else {
    Write-Host '  （跳过 JS/CSS 压缩：未安装 frontend/node_modules）'
}

# 校验关键入口存在
foreach ($need in @('settings.html', 'engine.html', 'themes.json', 'themes/base.css')) {
    if (-not (Test-Path -LiteralPath (Join-Path $dist $need))) { throw "产物缺少关键文件：$need" }
}

# 版本戳（缓存清理用）
$ver = (Get-Content -LiteralPath (Join-Path $root 'tools\version.json') -Raw | ConvertFrom-Json).version
[IO.File]::WriteAllText((Join-Path $dist 'version.txt'), $ver, (New-Object Text.UTF8Encoding($false)))

Write-Host "前端打包完成：$dist （$ver）"
