# Read-only startup migration recovery validation. No restoration or activation.
param()
$ErrorActionPreference='Stop'
$state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
$target=Join-Path $state 'desktop-control\startup-migration-prepared'
$startup=[Environment]::GetFolderPath('Startup')
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
function Assert-RecoveryFile([string]$Path,[long]$Limit) {
  $item=Get-Item -LiteralPath $Path -Force
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -lt 1 -or $item.Length -gt $Limit) { throw 'Invalid startup recovery file.' }
  $item
}
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another launcher or maintenance operation is active.' }
  foreach ($directory in @($target,$startup)) {
    if (-not $directory) { throw 'Startup recovery directory unavailable.' }
    $cursor=$directory
    while ($cursor) {
      $item=Get-Item -LiteralPath $cursor -Force
      if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid startup recovery directory.' }
      $cursor=Split-Path -Parent $cursor
    }
  }
  $record=Assert-RecoveryFile (Join-Path $target 'migration.json') 8192
  $m=Get-Content -LiteralPath $record.FullName -Raw | ConvertFrom-Json
  if ($m.schema -ne 1 -or $m.userSid -cne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -or $m.launcherDigest -cnotmatch '^[a-f0-9]{64}$' -or $m.legacyStartup -notin @('absent','matches-current-installation')) { throw 'Invalid startup recovery record or different Windows user.' }
  foreach ($flag in @('activationAllowed','automaticStartupAllowed','existingStartupChanged','recoveryExecuted')) {
    if ($m.$flag -isnot [bool] -or $m.$flag) { throw 'Unexpected startup recovery authorization state.' }
  }
  $backup=Join-Path $target 'legacy-shortcut.backup'
  $legacy=Join-Path $startup 'ARS Distributor POS.lnk'
  $raw=@(& (Join-Path $PSScriptRoot 'plan-windows-stable-startup.ps1'))
  $p=($raw -join [Environment]::NewLine) | ConvertFrom-Json
  if ($p.schema -ne 1 -or $p.launcherDigest -cne $m.launcherDigest -or $p.legacyStartup -cne $m.legacyStartup -or $p.commonStartupPresent -ne $false -or $p.otherMatchingEntries -ne 0 -or $p.registryMatchingObservations -ne 0 -or $p.matchingBootOrLogonTasks -ne 0) { throw 'Current startup inventory differs from retained evidence.' }
  if ($m.legacyStartup -eq 'absent') {
    if ($m.legacySha256 -cne 'absent' -or (Test-Path -LiteralPath $backup) -or (Test-Path -LiteralPath $legacy)) { throw 'Unexpected shortcut evidence.' }
  } else {
    if ($m.legacySha256 -cnotmatch '^[A-F0-9]{64}$') { throw 'Invalid shortcut digest.' }
    foreach ($file in @($backup,$legacy)) {
      $item=Assert-RecoveryFile $file 1048576
      if ((Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash -cne $m.legacySha256) { throw 'Startup shortcut checksum mismatch.' }
    }
  }
  [ordered]@{schema=1;recoveryEvidenceMatched=$true;legacyStartup=$m.legacyStartup;launcherDigest=$m.launcherDigest;activationAllowed=$false;automaticStartupAllowed=$false;recoveryExecuted=$false} | ConvertTo-Json
} finally {
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
