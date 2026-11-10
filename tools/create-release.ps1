param([string]$Tag = 'v0.1.3', [string]$Name = 'Deskland Preview 0.1.3')
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$proxy = 'http://127.0.0.1:7890'
$token = $env:GITHUB_TOKEN
if (-not $token) { throw 'Set GITHUB_TOKEN environment variable to a GitHub PAT (repo scope).' }
$repo = '111hhzz/Deskland'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'version.json') -Raw | ConvertFrom-Json).version
if ($tag -eq 'v0.1.3') { $tag = 'v' + $version }
if ($name -eq 'Deskland Preview 0.1.3') { $name = 'Deskland Preview ' + $version }

$headers = @{ 'Authorization' = 'token ' + $token; 'User-Agent' = 'deskland'; 'Accept' = 'application/vnd.github+json' }
$base = "https://api.github.com/repos/$repo"

# Check for existing release with this tag; reuse it (idempotent).
$rj = $null
try {
  $existing = Invoke-WebRequest -Uri "$base/releases/tags/$tag" -UseBasicParsing -Proxy $proxy -Headers $headers
  $rj = $existing.Content | ConvertFrom-Json
  Write-Host ("Reusing release id=" + $rj.id + " tag=" + $rj.tag_name)
} catch {
  # Not found: create below.
}

$notesPath = Join-Path (Join-Path $root 'dist') ("release-notes-" + $version + ".md")
if (-not (Test-Path -LiteralPath $notesPath)) { throw "Release notes missing: $notesPath" }
$notes = [IO.File]::ReadAllText($notesPath, (New-Object Text.UTF8Encoding($false)))
if (-not $rj) {
  $body = @{
    tag_name = $tag
    target_commitish = 'main'
    name = $name
    draft = $false
    prerelease = $false
    body = $notes
  } | ConvertTo-Json -Depth 4

  $release = Invoke-WebRequest -Uri "$base/releases" -Method Post -UseBasicParsing -Proxy $proxy -Headers $headers -Body $body -ContentType 'application/json'
  $rj = $release.Content | ConvertFrom-Json
  Write-Host ("Created release id=" + $rj.id + " tag=" + $rj.tag_name)
  Write-Host ("Upload URL: " + $rj.upload_url)
}

# Upload assets
$assets = @(
  "Deskland-Preview-$version-win-x64-portable.zip",
  "Deskland-Preview-$version-win-x64-portable.zip.sha256",
  "Deskland-Preview-$version-source.zip",
  "Deskland-Preview-$version-source.zip.sha256"
)
foreach ($name in $assets) {
  $path = Join-Path (Join-Path $root 'dist') $name
  if (-not (Test-Path -LiteralPath $path)) { Write-Warning ("missing asset: " + $name); continue }
  $label = [uri]::EscapeDataString($name)
  $upload = $rj.upload_url -replace '\{.*$', ''
  $uri = $upload + '?name=' + $label
  Write-Host ("Uploading " + $name + " ...")
  try {
    $resp = Invoke-WebRequest -Uri $uri -Method Post -UseBasicParsing -Proxy $proxy -Headers $headers `
      -ContentType 'application/octet-stream' -InFile $path -MaximumRedirection 5
    Write-Host ("  OK " + $resp.StatusCode)
  } catch {
    Write-Host ("  FAIL: " + $_.Exception.Message)
  }
}
Write-Host ("Release page: https://github.com/$repo/releases/tag/$tag")
