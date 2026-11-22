param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local.ps1')
. (Join-Path $PSScriptRoot 'packaging.ps1')
$root = Get-RepoRoot
$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'version.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid package version' }

if (-not $SkipBuild) { & (Join-Path $root 'host\build.ps1') }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$dist = Join-Path $script:DesklandLocal 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null

# 便携版布局与安装版一致：prototype\* + 宿主 exe / 运行库 + 文档
$runtime = Get-RuntimeFiles
Assert-ThemePages -RuntimeFiles $runtime
$docs = @('LICENSE', 'NOTICE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'TRADEMARKS.md')

$stage = Join-Path $dist ('portable-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $stage | Out-Null
foreach ($f in $runtime) {
    $target = Join-Path $stage (ConvertTo-InstallPath $f)
    New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
    Copy-Item -LiteralPath (Join-Path $root $f) -Destination $target
}
foreach ($d in $docs) { Copy-Item -LiteralPath (Join-Path $root $d) -Destination (Join-Path $stage $d) }

$zip = Join-Path $dist "Deskland-Preview-$version-win-x64-portable.zip"
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip)
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
[IO.File]::WriteAllText(($zip + '.sha256'), "$hash  $([IO.Path]::GetFileName($zip))`r`n", (New-Object Text.UTF8Encoding($false)))
Write-Host "Portable: $zip"
Write-Host "SHA256: $hash"
Remove-TempDir $stage
