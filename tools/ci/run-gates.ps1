# Deskland+ 统一门禁入口：本地 git hook 与 GitHub Actions 共用同一份，避免两套逻辑各自漂移。
#
# 用法：
#   pwsh -File tools/ci/run-gates.ps1 -Stage L0      # 确定性硬门禁（静态检查 + 构建，不含 E2E）
#   pwsh -File tools/ci/run-gates.ps1 -Stage L1      # E2E 非视觉部分
#   pwsh -File tools/ci/run-gates.ps1 -Stage L2      # 视觉基线（像素 diff，永不作硬门禁）
#   pwsh -File tools/ci/run-gates.ps1 -Stage All     # 本地提交 / 推送前全量
#
# 分层理由：L0 全是确定性检查，失败即真失败；L1/L2 依赖真实 WebView2 / GPU / DPI，
# CI 上可能 flaky，因此单独分层、分别决定是否设为 required。
#
# 退出码非 0 表示未通过。脚本不做任何重试或降级。

#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateSet('L0', 'L1', 'L2', 'All')]
    [string]$Stage = 'All',

    # 仓库根目录；默认由本脚本位置推导（tools/ci 的上两级）
    [string]$RepoRoot = ''
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
    $RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..' '..'))
}

$HostProject  = Join-Path $RepoRoot 'host/Deskland.csproj'
$TestProject  = Join-Path $RepoRoot 'test/Deskland.Tests/Deskland.Tests.csproj'
$SlnPath      = Join-Path $RepoRoot 'Deskland.sln'
$FrontendDir  = Join-Path $RepoRoot 'frontend'
$DeslopScript = Join-Path $RepoRoot 'tools/ci/gates-deslop.sh'
$HostExe      = Join-Path $RepoRoot 'host/bin/Deskland.exe'

# ─── 工具探测 ───────────────────────────────────────────────────────────────

function Resolve-DotnetPath {
    # 不再硬编码 /c/Users/<name>/...：优先本机妙手管理的 SDK 目录，其次 PATH。
    $localSdk = $null
    if ($env:LOCALAPPDATA) {
        $localSdk = Join-Path $env:LOCALAPPDATA 'Microsoft/dotnet/dotnet.exe'
    }
    if ($localSdk -and (Test-Path -LiteralPath $localSdk)) { return $localSdk }

    $onPath = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }

    throw '找不到 dotnet SDK。请安装 .NET SDK 8.0.4xx（global.json 指定），或确认 PATH 可达。'
}

$Dotnet = Resolve-DotnetPath
Write-Host "dotnet: $Dotnet" -ForegroundColor DarkGray
Write-Host "repo:   $RepoRoot" -ForegroundColor DarkGray

# 执行原生程序并在非零退出时抛错（输出已由管道实时打印，便于 CI 日志排错）。
function Invoke-Native {
    param([string]$Exe, [string[]]$Arguments, [string]$ErrorMessage, [string]$WorkingDirectory = '')
    if ($WorkingDirectory) { Push-Location -LiteralPath $WorkingDirectory }
    try {
        & $Exe @Arguments
        if ($LASTEXITCODE -ne 0) { throw $ErrorMessage }
    } finally {
        if ($WorkingDirectory) { Pop-Location }
    }
}

function Write-StepHeader([int]$Index, [int]$Total, [string]$Title) {
    Write-Host ''
    Write-Host "▶ [$Index/$Total] $Title" -ForegroundColor Cyan
}

# ─── L0：确定性硬门禁 ────────────────────────────────────────────────────────

function Invoke-L0 {
    $step = 0

    # 1) 前端门禁：token 产物同步 + Oxfmt + Oxlint(类型感知) + Vitest
    $step++
    Write-StepHeader $step 5 'Frontend: pnpm run check'
    Push-Location -LiteralPath $FrontendDir
    try {
        if (-not (Test-Path -LiteralPath (Join-Path $FrontendDir 'node_modules/vite-plus'))) {
            Write-Host '   node_modules 缺失，按 lockfile 安装依赖…' -ForegroundColor DarkGray
            Invoke-Native 'pnpm' @('install', '--frozen-lockfile') 'pnpm install 失败（lockfile 与 package.json 不一致？）'
        }
        Invoke-Native 'pnpm' @('run', 'check') '前端门禁失败（token 产物同步 / 格式 / lint / 类型 / 单测）'
    } finally { Pop-Location }

    # 2) dotnet format
    $step++
    Write-StepHeader $step 5 'Lint: dotnet format --verify-no-changes'
    Invoke-Native $Dotnet @('format', $SlnPath, '--verify-no-changes', '--verbosity', 'quiet') `
        '代码格式不符合规范；修复命令：dotnet format Deskland.sln'

    # 3) deslop（TODO/调试输出/空 catch/硬编码密钥/BOM）
    $step++
    Write-StepHeader $step 5 'Deslop: 屎山代码检查'
    $bash = Get-Command bash -ErrorAction SilentlyContinue
    if (-not $bash) {
        throw '找不到 bash：deslop 检查依赖 Git Bash（GitHub Windows runner 与本机 Git for Windows 均自带）。'
    }
    # 传相对 POSIX 路径：bash 会把 Windows 反斜杠当转义符吞掉（D:\... -> D:...）
    Invoke-Native $bash.Source @('tools/ci/gates-deslop.sh') 'Deslop 失败：发现屎山代码，请清理后重试' $RepoRoot

    # 4) 宿主构建（内含前端 Vite 构建 + dotnet build --warnaserror）
    $step++
    Write-StepHeader $step 5 'Build: host/build.ps1 --warnaserror'
    Invoke-Native 'pwsh' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $RepoRoot 'host/build.ps1')) `
        '宿主编译失败（含编译警告，--warnaserror）'

    # 5) 测试工程构建
    $step++
    Write-StepHeader $step 5 'Build: test project --warnaserror'
    Invoke-Native $Dotnet @('build', $TestProject, '--warnaserror') `
        '测试工程编译失败（含编译警告）'
}

# ─── L1 / L2：E2E 分层 ───────────────────────────────────────────────────────

function Assert-E2eArtifacts {
    if (-not (Test-Path -LiteralPath $HostExe)) {
        throw "缺少宿主产物 $HostExe；请先运行 -Stage L0 完成构建。"
    }
    $testBin = Join-Path $RepoRoot 'test/Deskland.Tests/bin/Debug/net8.0/Deskland.Tests.dll'
    if (-not (Test-Path -LiteralPath $testBin)) {
        throw "缺少测试程序集 $testBin；请先运行 -Stage L0 完成构建。"
    }
}

function Invoke-E2e {
    param([string]$Filter, [string]$Label)

    Assert-E2eArtifacts
    Write-Host ''
    Write-Host "▶ E2E: $Label" -ForegroundColor Cyan
    Invoke-Native $Dotnet @('test', $TestProject, '--no-build', '--filter', $Filter) `
        "E2E 失败：$Label"
}

# ─── 编排 ────────────────────────────────────────────────────────────────────

$swatch = [System.Diagnostics.Stopwatch]::StartNew()
$failed = $false

try {
    switch ($Stage) {
        'L0' { Invoke-L0 }
        'L1' { Invoke-E2e 'Category!=visual' '非视觉用例（宿主启动 / CDP / DOM / 性能事件）' }
        'L2' { Invoke-E2e 'Category=visual' '视觉基线像素 diff' }
        'All' {
            Invoke-L0
            Invoke-E2e 'Category!=visual' '非视觉用例（宿主启动 / CDP / DOM / 性能事件）'
            Invoke-E2e 'Category=visual' '视觉基线像素 diff'
        }
    }
} catch {
    $failed = $true
    Write-Host ''
    Write-Host "❌ $_" -ForegroundColor Red
} finally {
    $swatch.Stop()
}

Write-Host ''
if ($failed) {
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Red
    Write-Host "  门禁未通过（$Stage），用时 $([int]$swatch.Elapsed.TotalSeconds)s" -ForegroundColor Red
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Red
    exit 1
}

Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✅ 门禁通过（$Stage），用时 $([int]$swatch.Elapsed.TotalSeconds)s" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
exit 0
