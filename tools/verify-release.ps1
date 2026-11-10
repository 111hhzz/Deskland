$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$proxy = 'http://127.0.0.1:7890'
$token = $env:GITHUB_TOKEN
if (-not $token) { throw 'Set GITHUB_TOKEN environment variable to a GitHub PAT (repo scope).' }
$repo = '111hhzz/Deskland'
$headers = @{ 'Authorization' = 'token ' + $token; 'User-Agent' = 'deskland'; 'Accept' = 'application/vnd.github+json' }
$r = Invoke-WebRequest -Uri "https://api.github.com/repos/$repo/releases/tags/v0.1.3" -UseBasicParsing -Proxy $proxy -Headers $headers
$j = $r.Content | ConvertFrom-Json
Write-Host ("Release: " + $j.name + " tag=" + $j.tag_name + " url=" + $j.html_url)
foreach ($a in $j.assets) {
  Write-Host ("- " + $a.name + "  " + [math]::Round($a.size/1MB,2) + " MB  url=" + $a.browser_download_url)
}
