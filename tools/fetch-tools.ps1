$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$cache = Join-Path (Join-Path $PSScriptRoot '..\dist') 'installer-tools'
New-Item -ItemType Directory -Force $cache | Out-Null
$proxy = 'http://127.0.0.1:7890'

$nsis = Join-Path $cache 'nsis-3.13-setup.exe'
$nsisUrl = 'https://prdownloads.sourceforge.net/nsis/nsis-3.13-setup.exe?download'
if (-not (Test-Path -LiteralPath $nsis)) {
    Write-Host 'Downloading NSIS 3.13 setup ...'
    Invoke-WebRequest -Uri $nsisUrl -OutFile $nsis -UseBasicParsing -Proxy $proxy -MaximumRedirection 10
}
Write-Host ("NSIS setup size: " + (Get-Item -LiteralPath $nsis).Length)
Write-Host ("NSIS setup sha256: " + (Get-FileHash -LiteralPath $nsis -Algorithm SHA256).Hash)
$sig = Get-AuthenticodeSignature -LiteralPath $nsis
Write-Host ("NSIS setup signature: " + $sig.Status)

$boot = Join-Path $cache 'MicrosoftEdgeWebview2Setup.exe'
if (-not (Test-Path -LiteralPath $boot)) {
    Write-Host 'Downloading WebView2 bootstrapper ...'
    Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' `
        -OutFile $boot -UseBasicParsing -Proxy $proxy
}
Write-Host ("Bootstrapper size: " + (Get-Item -LiteralPath $boot).Length)
