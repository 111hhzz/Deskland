# 前端产物：Vite 构建（root=src，public=../public 原样拷贝，产物 ../dist，固定名无哈希）。
# 由 host/build.ps1 调用；也可单独 `powershell frontend\scripts\build.ps1`。
# 需要 Node（本机已装 LTS）；未装则跳过（宿主会因缺 dist 报错提示）。
$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot                              # frontend/scripts
$front = Split-Path $here -Parent                  # frontend
$dist = Join-Path $front 'dist'
$versionTxt = Join-Path $dist 'version.txt'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '未找到 node，跳过前端构建（安装 Node LTS 后重试）'
    exit 0
}

Push-Location $front
try {
    # 依赖缺失时按 pnpm-lock.yaml 装一次；平时直接构建（Vite 构建本身很快）
    if (-not (Test-Path (Join-Path $front 'node_modules\vite-plus'))) {
        & pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw "pnpm install 失败（exit $LASTEXITCODE）" }
    }
    & pnpm run build
    if ($LASTEXITCODE -ne 0) { throw "Vite 构建失败（exit $LASTEXITCODE）" }
} finally {
    Pop-Location
}

# 浏览器缓存清理：宿主每次构建改 ?v=版本号，资源引用不带版本，所以额外写 version.txt 供宿主比对
$version = (Get-Content (Join-Path $front 'package.json') -Raw | ConvertFrom-Json).version
Set-Content -LiteralPath $versionTxt -Value $version -Encoding utf8
Write-Host "前端打包完成：$dist （$version）"
