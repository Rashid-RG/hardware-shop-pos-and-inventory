# Preserve recognized legacy startup evidence before any future migration.
# No startup entry is enabled, removed or replaced.
param()
$ErrorActionPreference='Stop'
$state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
$control=Join-Path $state 'desktop-control'
$startup=[Environment]::GetFolderPath('Startup')
$legacy=Join-Path $startup 'ARS Distributor POS.lnk'
$target=Join-Path $control 'startup-migration-prepared'
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
$pending=$null
function Read-Inventory {
  $raw=@(& (Join-Path $PSScriptRoot 'plan-windows-stable-startup.ps1'))
  $p=($raw -join [Environment]::NewLine) | ConvertFrom-Json
  if ($p.schema -ne 1 -or $p.automaticStartupAllowed -ne $false -or $p.existingStartupChanged -ne $false -or $p.legacyStartup -notin @('absent','matches-current-installation') -or $p.commonStartupPresent -ne $false -or $p.otherMatchingEntries -ne 0 -or $p.registryMatchingObservations -ne 0 -or $p.matchingBootOrLogonTasks -ne 0) { throw 'Startup inventory contains conflicts or is incomplete. No migration prepared.' }
  $p
}
function Get-LegacyDigest($inventory) {
  if ($inventory.legacyStartup -eq 'absent') {
    if (Test-Path -LiteralPath $legacy) { throw 'Startup shortcut appeared.' }
    return 'absent'
  }
  $item=Get-Item -LiteralPath $legacy -Force
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 1048576) { throw 'Invalid legacy shortcut.' }
  return (Get-FileHash -LiteralPath $legacy -Algorithm SHA256).Hash
}
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another launcher or maintenance operation is active.' }
  $cursor=$control
  while ($cursor) {
    $item=Get-Item -LiteralPath $cursor -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid control directory.' }
    $cursor=Split-Path -Parent $cursor
  }
  if (Test-Path -LiteralPath $target) { throw 'Migration evidence already exists; no overwrite supported.' }
  $first=Read-Inventory
  $before=Get-LegacyDigest $first
  if ((Read-Host 'Type PREPARE STARTUP MIGRATION to retain recovery evidence only') -cne 'PREPARE STARTUP MIGRATION') { return }
  $second=Read-Inventory
  if ($first.launcherDigest -cne $second.launcherDigest -or $first.legacyStartup -cne $second.legacyStartup -or (Get-LegacyDigest $second) -cne $before) { throw 'Startup inventory changed during confirmation.' }
  $pending=Join-Path $control ('.pending-startup-'+[guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $pending | Out-Null
  if ($before -ne 'absent') {
    # Keep the original bytes under a non-launchable filename, outside startup folders.
    $copy=Join-Path $pending 'legacy-shortcut.backup'
    Copy-Item -LiteralPath $legacy -Destination $copy
    if ((Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash -cne $before) { throw 'Recovery shortcut checksum mismatch.' }
  }
  $last=Read-Inventory
  if ($last.launcherDigest -cne $first.launcherDigest -or $last.legacyStartup -cne $first.legacyStartup -or (Get-LegacyDigest $last) -cne $before) { throw 'Startup state changed while preparing evidence.' }
  $record=[ordered]@{schema=1;createdAt=[DateTime]::UtcNow.ToString('o');userSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;legacyStartup=$first.legacyStartup;legacySha256=$before;launcherDigest=$first.launcherDigest;activationAllowed=$false;automaticStartupAllowed=$false;existingStartupChanged=$false;recoveryExecuted=$false}
  $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $pending 'migration.json') -Encoding UTF8
  [IO.Directory]::Move($pending,$target)
  Write-Host 'Startup recovery evidence retained. Existing startup configuration unchanged.'
} finally {
  if ($pending -and (Test-Path -LiteralPath $pending)) { Write-Warning 'Incomplete startup preparation retained for inspection.' }
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
