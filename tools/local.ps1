# 本机状态根：构建产物 / 测试 profile / 凭据都不进仓库。
# 默认放在工作区根的 .local\Deskland（即仓库的上一级），可用环境变量 DESKLAND_LOCAL 覆盖。
# 用法：. (Join-Path $PSScriptRoot 'local.ps1')  然后直接用 $script:DesklandLocal
$script:DesklandLocal = if ($env:DESKLAND_LOCAL) {
    [IO.Path]::GetFullPath($env:DESKLAND_LOCAL)
} else {
    [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\.local\Deskland'))
}
