param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'version.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid package version' }

if (-not $SkipBuild) { & (Join-Path $root 'host\build.ps1') }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null

# Portable layout mirrors the installer's runtime + theme files.
$files = @(
  'host\bin\Deskland.exe', 'host\bin\DesklandPreview.ico',
  'host\bin\Microsoft.Web.WebView2.Core.dll', 'host\bin\Microsoft.Web.WebView2.WinForms.dll', 'host\bin\WebView2Loader.dll',
  'LICENSE', 'NOTICE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'TRADEMARKS.md'
)
$themeFiles = @('flat.html', 'meadow.html', 'sky.html', 'settings.html', 'thumbs-data.js', 'share.js', 'ripple.js', 'themes.json', 'beach-palms.js', 'meadow-boy.js', 'meadow-cat.js',
  'i18n\en.json', 'i18n\zh-CN.json', 'thumbs\beach.webp', 'thumbs\meadow.webp', 'thumbs\sky.webp',
  'assets\beach-coconut-palm-v2.png', 'assets\beach-coconut-palm-curved.png', 'assets\beach-coconut-palm-airy.png', 'assets\beach-coconut-palm-windswept.png', 'assets\beach-coconut-palm-arch.png',
  'assets\meadow-black-kitten.png', 'assets\meadow-kite-boy-level-face.png', 'assets\meadow-kite-boy-diagonal-run.png')
# 主题目录自动发现（base.css / CONVENTIONS.md / <id>/theme.css / <id>/theme.json ...）；模板不打进运行时包。
$themesRoot = Join-Path $root 'prototype\themes'
foreach ($f in @(Get-ChildItem -LiteralPath $themesRoot -Recurse -File | Where-Object { $_.FullName -notmatch '\\_template\\' })) {
  $themeFiles += 'themes\' + $f.FullName.Substring($themesRoot.Length + 1)
}
foreach ($t in $themeFiles) { $files += 'prototype\' + $t }

$stage = Join-Path $dist ('portable-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $stage | Out-Null
foreach ($f in $files) {
  $target = Join-Path $stage $f
  New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
  Copy-Item -LiteralPath (Join-Path $root $f) -Destination $target
}

$zip = Join-Path $dist "Deskland-Preview-$version-win-x64-portable.zip"
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip)
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
[IO.File]::WriteAllText(($zip + '.sha256'), "$hash  $([IO.Path]::GetFileName($zip))`r`n", (New-Object Text.UTF8Encoding($false)))
Write-Host "Portable: $zip"
Write-Host "SHA256: $hash"
Remove-Item -LiteralPath $stage -Recurse -Force
