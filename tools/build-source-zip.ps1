$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local.ps1')
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'version.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid version' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$dist = Join-Path $script:DesklandLocal 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$stage = Join-Path $dist ('src-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $stage | Out-Null

# 散文件（顶层文档 + host 源码 + 打包脚本 + 页面与角色脚本）
$files = @('.gitattributes', '.gitignore', 'LICENSE', 'NOTICE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'TRADEMARKS.md',
  'host\DesktopHost.cs', 'host\Themes.cs', 'host\SystemTheme.cs', 'host\DesklandPreview.ico', 'host\README.md', 'host\app.manifest', 'host\build.ps1', 'host\inspect.ps1',
  'tools\build-installer.ps1', 'tools\build-portable.ps1', 'tools\build-source-zip.ps1', 'tools\fetch-tools.ps1', 'tools\local.ps1', 'tools\installer.nsi', 'tools\version.json',
  'prototype\flat.html', 'prototype\meadow.html', 'prototype\sky.html', 'prototype\settings.html', 'prototype\thumbs-data.js', 'prototype\share.js', 'prototype\ripple.js', 'prototype\serve.mjs', 'prototype\themes.json',
  'prototype\beach-palms.js', 'prototype\meadow-boy.js', 'prototype\meadow-cat.js',
  'prototype\i18n\en.json', 'prototype\i18n\zh-CN.json')

# 整个目录收：主题、引擎、测试、钩子、文档（排除构建/测试产物）
$dirs = @('prototype\thumbs', 'prototype\assets', 'prototype\themes', 'prototype\engine', 'test', '.githooks', 'docs')
foreach ($d in $dirs) {
  $full = Join-Path $root $d
  if (-not (Test-Path -LiteralPath $full)) { Write-Warning ("missing dir: " + $d); continue }
  $files += Get-ChildItem -LiteralPath $full -Recurse -File |
    Where-Object { $_.FullName -notmatch '\\(bin|obj|\.playwright|test-profile)\\' } |
    ForEach-Object { $_.FullName.Substring($root.Length + 1) }
}

foreach ($f in ($files | Select-Object -Unique)) {
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
