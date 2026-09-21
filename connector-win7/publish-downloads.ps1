$ErrorActionPreference = 'Stop'
$dest = Join-Path (Split-Path -Parent $PSScriptRoot) 'public\downloads\connector-win7'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$msiName = 'Travkin-Connector-Win7-1.1.0.msi'
$zipName = 'Travkin-Connector-Win7-1.1.0-portable.zip'
foreach ($name in @($msiName, $zipName)) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "artifacts\$name") -Destination (Join-Path $dest $name)
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination (Join-Path $dest 'instructions.txt')
$release = [ordered]@{
  version = '1.1.0'; stage = 'diagnostic-capture'; automaticTicketWeight = $false
  requiredOS = 'Windows 7 SP1 or newer'; requiredRuntime = '.NET Framework 4.8'
  signed = $false; testedOnPhysicalScale = $false; testedOnWindows7 = $false
  installer = [ordered]@{
    url = "/downloads/connector-win7/$msiName"
    sha256 = (Get-FileHash -LiteralPath (Join-Path $dest $msiName) -Algorithm SHA256).Hash.ToLowerInvariant()
    bytes = (Get-Item -LiteralPath (Join-Path $dest $msiName)).Length
  }
  portable = [ordered]@{
    url = "/downloads/connector-win7/$zipName"
    sha256 = (Get-FileHash -LiteralPath (Join-Path $dest $zipName) -Algorithm SHA256).Hash.ToLowerInvariant()
    bytes = (Get-Item -LiteralPath (Join-Path $dest $zipName)).Length
  }
}
# Generated manifest, kept alongside the exact binary artifacts that it identifies.
$release | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $dest 'release.json') -Encoding utf8
$release | ConvertTo-Json -Depth 4
