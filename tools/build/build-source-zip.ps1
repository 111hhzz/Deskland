$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\local.ps1')
. (Join-Path $PSScriptRoot 'packaging.ps1')
$root = Get-RepoRoot
$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'version.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid version' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$dist = Join-Path $script:DesklandLocal 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$stage = Join-Path $dist ('src-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $stage | Out-Null

# git 跟踪文件 = 仓库源码：不含 bin / obj / dist / node_modules / 本机状态
$files = Get-RepoFiles
foreach ($f in $files) {
    $target = Join-Path $stage $f
    New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
    Copy-Item -LiteralPath (Join-Path $root $f) -Destination $target
}

$zip = Join-Path $dist "Deskland-Preview-$version-source.zip"
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip)
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
[IO.File]::WriteAllText(($zip + '.sha256'), "$hash  $([IO.Path]::GetFileName($zip))`r`n", (New-Object Text.UTF8Encoding($false)))
Write-Host "Source: $zip"
Write-Host "SHA256: $hash"
Remove-TempDir $stage
