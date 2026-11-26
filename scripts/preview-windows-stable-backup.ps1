# Permanent backup entry point: readiness only. Never invokes the backup uploader.
param()
$ErrorActionPreference='Stop'
$package=Split-Path -Parent $PSScriptRoot
$state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
if ($package -ine (Join-Path $state 'launcher-prepared')) { throw 'Stable backup entry point must run from the independent launcher package.' }
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another launcher or maintenance operation is active.' }
  $cursor=$package
  while ($cursor) {
    $item=Get-Item -LiteralPath $cursor -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid launcher directory or ancestor.' }
    $cursor=Split-Path -Parent $cursor
  }
  foreach ($name in @('windows-prepared-fingerprint.ps1','preview-windows-stable-launcher.ps1','windows-runtime-paths.ps1')) {
    $item=Get-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid launcher helper.' }
  }
  . (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
  . (Join-Path $PSScriptRoot 'windows-runtime-paths.ps1')
  $digest=(Assert-ArsPreparedFingerprint $package).digest
  $preview=(@(& (Join-Path $PSScriptRoot 'preview-windows-stable-launcher.ps1')) -join [Environment]::NewLine) | ConvertFrom-Json
  if ($preview.schema -ne 1 -or $preview.fingerprintMatched -ne $true -or $preview.databaseBindingMatched -ne $true -or $preview.activationAllowed -ne $false -or $preview.schedulingAllowed -ne $false) { throw 'Launcher preview failed.' }
  $runtime=Get-ArsWindowsRuntimeRoot $preview.release
  $backupDirectory=Join-Path $runtime 'backups'
  $locks=@(Get-ChildItem -LiteralPath $backupDirectory -Force | Where-Object { $_.Name -in @('.ars-drive-backup.lock','.ars-local-backup.lock','.ars-drive-recovery.lock') })
  if ($locks.Count -gt 0) { throw 'Backup execution or recovery evidence requires review.' }
  $node=Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
  $rclone=Get-Command rclone.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
  foreach ($name in @('drive-backup.mjs','drive-backup-lock.mjs','backup-local-postgres.ps1')) {
    $file=Get-Item -LiteralPath (Join-Path (Join-Path $preview.release 'scripts') $name) -Force
    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid backup release member.' }
  }
  [ordered]@{schema=1;launcherDigest=$digest;releaseVersion=$preview.version;databaseBindingMatched=$true;backupLocksAbsent=$true;nodeAvailable=[bool]$node;rcloneAvailable=[bool]$rclone;activationAllowed=$false;schedulingAllowed=$false;uploadAllowed=$false;backupStarted=$false} | ConvertTo-Json
} finally {
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
