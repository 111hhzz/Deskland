$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'version.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid version' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$stage = Join-Path $dist ('src-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $stage | Out-Null
$files = @('.gitattributes', '.gitignore', 'AGENTS.md', 'LICENSE', 'NOTICE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'TRADEMARKS.md',
  'host\DesktopHost.cs', 'host\Themes.cs', 'host\DesklandPreview.ico', 'host\README.md', 'host\app.manifest', 'host\build.ps1', 'host\inspect.ps1',
  'tools\build-installer.ps1', 'tools\build-portable.ps1', 'tools\build-source-zip.ps1', 'tools\installer.nsi', 'tools\version.json',
  'prototype\flat.html', 'prototype\meadow.html', 'prototype\sky.html', 'prototype\settings.html', 'prototype\thumbs-data.js', 'prototype\share.js', 'prototype\ripple.js', 'prototype\serve.mjs', 'prototype\themes.json',
  'prototype\beach-palms.js', 'prototype\meadow-boy.js', 'prototype\meadow-cat.js',
  'prototype\i18n\en.json', 'prototype\i18n\zh-CN.json')
$thumbs = Get-ChildItem (Join-Path $root 'prototype\thumbs') -File
foreach ($t in $thumbs) { $files += 'prototype\thumbs\' + $t.Name }
$assets = Get-ChildItem (Join-Path $root 'prototype\assets') -File
foreach ($a in $assets) { $files += 'prototype\assets\' + $a.Name }
foreach ($f in $files) {
  $src = Join-Path $root $f
  if (-not (Test-Path -LiteralPath $src)) { Write-Warning ("missing: " + $f); continue }
  $target = Join-Path $stage $f
  New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
  Copy-Item -LiteralPath $src -Destination $target
}
$zip = Join-Path $dist "Deskland-Preview-$version-source.zip"
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip)
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
[IO.File]::WriteAllText(($zip + '.sha256'), "$hash  $([IO.Path]::GetFileName($zip))`r`n", (New-Object Text.UTF8Encoding($false)))
Write-Host "Source: $zip"
Write-Host "SHA256: $hash"
Remove-Item -LiteralPath $stage -Recurse -Force
