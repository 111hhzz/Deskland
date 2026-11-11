# 编译 Win32 Probe
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$bin = Join-Path $root 'bin'
New-Item -ItemType Directory -Force $bin | Out-Null

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}

& $csc /nologo /target:exe "/out:$bin\Win32Probe.exe" `
    /reference:System.dll /reference:System.Management.dll `
    "$root\Win32Probe.cs"

if ($LASTEXITCODE -ne 0) { throw '编译失败' }
Write-Host "编译完成: $bin\Win32Probe.exe"
