# 新克隆后执行一次：把 git hooks 指向仓库内的 .githooks，避免 hook 依赖手动复制。
# 用法（仓库根）：pwsh -File tools/setup-hooks.ps1
#
# 说明：core.hooksPath 对每台新机器仍是「一次」操作（git 配置不随仓库走），
# 因此这一条需写进团队/本机的新克隆检查清单（见工作区 HANDOFF.md）。

$ErrorActionPreference = 'Stop'

$root = (git rev-parse --show-toplevel) 2>$null
if (-not $root) { throw '当前目录不是 git 仓库（git rev-parse --show-toplevel 失败）。' }

Push-Location -LiteralPath $root
try {
    git config core.hooksPath .githooks
    $configured = git config --get core.hooksPath

    Write-Host "core.hooksPath = $configured" -ForegroundColor Green
    Write-Host ''
    Write-Host '已启用的 hook：'
    foreach ($name in @('pre-commit', 'pre-push')) {
        $path = Join-Path $root (Join-Path '.githooks' $name)
        if (Test-Path -LiteralPath $path) {
            Write-Host "  ✅ $name" -ForegroundColor Green
        } else {
            Write-Host "  ⚠️  $name 缺失（.github 上的门禁仍会兜底）" -ForegroundColor Yellow
        }
    }

    Write-Host ''
    Write-Host '提示：.git/hooks 下的旧副本已被忽略（core.hooksPath 优先），可自行删除。' -ForegroundColor DarkGray
} finally {
    Pop-Location
}
