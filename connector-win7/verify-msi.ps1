param([string]$Path = (Join-Path $PSScriptRoot 'artifacts\Travkin-Connector-Win7-1.1.0.msi'))
$ErrorActionPreference = 'Stop'
$installer = New-Object -ComObject WindowsInstaller.Installer
$session = $null
try {
  # OpenPackage/AppSearch reads package/registry only. No Install/ExecuteSequence action is called.
  $session = $installer.OpenPackage((Resolve-Path -LiteralPath $Path).Path, 1)
  if ($session.DoAction('AppSearch') -ne 1) { throw 'AppSearch failed' }
  if ($session.EvaluateCondition('NETFRAMEWORK48RELEASE >= "#528040"') -ne 1) { throw 'Installed compatible framework was rejected' }
  foreach ($release in @('#528040','#528049','#528372','#528449','#533320','#533509')) {
    if ($session.EvaluateCondition(('"{0}" >= "#528040"' -f $release)) -ne 1) { throw "Compatible release rejected: $release" }
  }
  foreach ($release in @('','#378389','#461808','#461814')) {
    if ($session.EvaluateCondition(('"{0}" >= "#528040"' -f $release)) -ne 0) { throw "Old/missing release accepted: $release" }
  }
  if ($session.EvaluateCondition('VersionNT > 601 OR (VersionNT = 601 AND ServicePackLevel >= 1)') -ne 1) { throw 'Supported test OS rejected' }
  'PASS MSI metadata, runtime prerequisite and 10 release boundary cases. No installation performed.'
} finally {
  if ($session) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($session) }
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer)
}
