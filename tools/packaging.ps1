# 发布打包的公共定义（installer / portable / source-zip 共用）。
#
# 运行时产物来自 host\bin：host\build.ps1 已经把 frontend\dist 复制成 host\bin\prototype，
# 也就是宿主真正服务的目录（宿主按 <exe 目录>\prototype 定位页面）。
# 源码包直接用 git 跟踪文件列表，天然排除 bin / obj / dist / node_modules 与本机状态，
# 不会出现"清单里写着已删文件"或"把构建产物打进源码包"的问题。

function Get-RepoRoot { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')) }

# 仓库源码文件（git 跟踪 = 仓库内容，不含 .gitignore 的产物与依赖）
function Get-RepoFiles {
    $root = Get-RepoRoot
    $out = & git -C $root ls-files 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'git ls-files 失败：请在仓库内执行打包' }
    return @($out | Where-Object { $_ } | ForEach-Object { $_ -replace '/', '\' })
}

# 运行时文件（仓库相对路径）：宿主 exe / 图标 / WebView2 运行库 + prototype\ 前端产物
function Get-RuntimeFiles {
    $root = Get-RepoRoot
    $proto = Join-Path $root 'host\bin\prototype'
    if (-not (Test-Path -LiteralPath $proto)) { throw "缺少前端产物：$proto（先跑 host\build.ps1）" }
    $files = @('Deskland.exe', 'DesklandPlus.ico', 'Microsoft.Web.WebView2.Core.dll',
               'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll') |
        ForEach-Object { 'host\bin\' + $_ }
    $files += Get-ChildItem -LiteralPath $proto -Recurse -File -Force |
        Where-Object { $_.FullName -notmatch '\\themes\\_template\\' } |
        ForEach-Object { $_.FullName.Substring($root.Length + 1) }
    return @($files)
}

# host\bin\ 前缀去掉后就是安装目录里的相对路径（prototype\... / Deskland.exe）
function ConvertTo-InstallPath { param([string]$RepoRelative) $RepoRelative -replace '^host\\bin\\', '' }

# 清空并删除临时目录（逐个删除，不用递归删除）
function Remove-TempDir {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Get-ChildItem -LiteralPath $Path -Recurse -File -Force | Remove-Item -Force -Confirm:$false
    Get-ChildItem -LiteralPath $Path -Recurse -Directory -Force | Sort-Object -Property FullName -Descending | Remove-Item -Force -Confirm:$false
    Remove-Item -LiteralPath $Path -Force -Confirm:$false
}

# 校验：每个 ready 主题的页面与 theme.css / theme.json 都在运行时产物里，避免装完缺页面
function Assert-ThemePages {
    param([string[]]$RuntimeFiles)
    $root = Get-RepoRoot
    $have = @{}
    foreach ($f in $RuntimeFiles) { $have[(ConvertTo-InstallPath $f).Replace('\', '/')] = $true }
    if (-not $have['prototype/engine.html']) { throw '运行时产物缺少 prototype/engine.html（页内热切换入口）' }
    $themes = Get-Content -LiteralPath (Join-Path $root 'host\bin\prototype\themes.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($t in $themes.themes) {
        if ($t.status -ne 'ready') { continue }
        $page = 'prototype/' + $t.page
        $css = 'prototype/themes/' + $t.id + '/theme.css'
        $json = 'prototype/themes/' + $t.id + '/theme.json'
        foreach ($p in @($page, $css, $json)) {
            if (-not $have[$p]) { throw ('ready 主题缺少运行时文件：' + $p) }
        }
    }
}
