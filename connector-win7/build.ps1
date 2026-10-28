param(
  [string]$Compiler = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe',
  [string]$Dotnet = 'C:\Users\TRAVKIN\Downloads\CodecSaaS\.tools\dotnet8\dotnet.exe',
  [string]$WixDirectory = 'C:\Users\TRAVKIN\Downloads\CodecSaaS\.tools\wix'
)
$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$artifacts = Join-Path $source 'artifacts'
New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
$exe = Join-Path $artifacts 'TravkinConnectorWin7.exe'
& $Compiler /nologo /target:winexe /platform:anycpu /optimize+ /utf8output "/out:$exe" /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll (Join-Path $source 'Program.cs') (Join-Path $source 'Capture.cs')
if ($LASTEXITCODE -ne 0) { throw 'Compilation failed' }
Copy-Item -LiteralPath (Join-Path $source 'App.config') -Destination "$exe.config"
Copy-Item -LiteralPath (Join-Path $source 'README.md') -Destination (Join-Path $artifacts 'README.txt')
$test = Join-Path $artifacts 'ConnectorTests.exe'
& $Compiler /nologo /target:exe /platform:anycpu /utf8output "/out:$test" /reference:System.dll /reference:System.Core.dll (Join-Path $source 'Tests.cs') (Join-Path $source 'Capture.cs')
if ($LASTEXITCODE -ne 0) { throw 'Test compilation failed' }
& $test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
$wixDll = Get-ChildItem -LiteralPath $WixDirectory -Filter wix.dll -Recurse -File | Select-Object -First 1 -ExpandProperty FullName
if (!$wixDll) { throw 'WiX CLI not found' }
$msi = Join-Path $artifacts 'Travkin-Connector-Win7-1.1.0.msi'
& $Dotnet $wixDll build (Join-Path $source 'Installer.wxs') -arch x86 -d "Artifacts=$artifacts" -o $msi
if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $msi)) { throw 'MSI build failed' }
$zip = Join-Path $artifacts 'Travkin-Connector-Win7-1.1.0-portable.zip'
Compress-Archive -LiteralPath $exe,"$exe.config",(Join-Path $artifacts 'README.txt') -DestinationPath $zip -Force
Get-FileHash -LiteralPath $exe,$msi,$zip -Algorithm SHA256 | Select-Object Path,Hash
