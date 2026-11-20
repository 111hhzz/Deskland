# Deskland 统一开发入口：一条命令完成「构建宿主 + 运行测试（+ 可选打包）」。
# 用法（仓库根或任意目录）：
#   powershell -ExecutionPolicy Bypass -File tools\ci.ps1            # 构建 + 测试
#   powershell -ExecutionPolicy Bypass -File tools\ci.ps1 -Package   # 构建 + 测试 + 打包
#   powershell -ExecutionPolicy Bypass -File tools\ci.ps1 -SkipTests # 只构建
param(
    [switch]$Package,
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

function Write-Step($text) { Write-Host "`n==== $text ====" -ForegroundColor Cyan }

# 1) 前端打包（prototype → frontend/dist）
Write-Step '前端打包'
& (Join-Path $root 'frontend\build.ps1')
if (-not $?) { throw '前端打包失败' }

# 2) 构建宿主（.NET Framework C# 编译器）
Write-Step '构建宿主'
& (Join-Path $root 'host\build.ps1')
if (-not $?) { throw '宿主构建失败' }

# 3) 运行测试（xUnit + Playwright .NET；需要 .NET SDK）
if (-not $SkipTests) {
    Write-Step '运行测试'
    $dotnet = Join-Path $env:LOCALAPPDATA 'Microsoft\dotnet\dotnet.exe'
    if (-not (Test-Path $dotnet)) { $dotnet = 'dotnet' }
    & $dotnet test (Join-Path $root 'test\Deskland.Tests') --nologo
    if ($LASTEXITCODE -ne 0) { throw '测试失败' }
}

# 4) 可选：打包安装器 / 便携版 / 源码包
if ($Package) {
    Write-Step '打包发布产物'
    & (Join-Path $root 'tools\build-installer.ps1')
    if ($LASTEXITCODE -ne 0) { throw '打包失败' }
}

Write-Host "`n✅ CI 完成" -ForegroundColor Green
