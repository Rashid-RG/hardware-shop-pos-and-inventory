# Read-only schedule planning. No task registration or upload.
param([ValidatePattern('^([01][0-9]|2[0-3]):[0-5][0-9]$')][string]$At='20:00')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
. (Join-Path $PSScriptRoot 'windows-runtime-paths.ps1')
$state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
$package=Join-Path $state 'launcher-prepared'
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another launcher or maintenance operation is active.' }
  $cursor=$package
  while ($cursor) {
    $item=Get-Item -LiteralPath $cursor -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid launcher package directory.' }
    $cursor=Split-Path -Parent $cursor
  }
  $digest=(Assert-ArsPreparedFingerprint $package).digest
  if ($null -eq [Environment]::GetEnvironmentVariable('ARS_RUNTIME_ROOT','Process')) { throw 'Explicit permanent runtime selection required.' }
  $runtime=Get-ArsWindowsRuntimeRoot $package
  $node=Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
  $rclone=Get-Command rclone.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
  $matching=@(Get-ScheduledTask -ErrorAction Stop | Where-Object {
    $found=($_.TaskName -match '(?i)(ARS|hardware.pos).*(backup|drive)|(backup|drive).*(ARS|hardware.pos)')
    foreach ($action in @($_.Actions)) {
      if ($action.Arguments -match '(?i)drive-backup\.mjs|backup-local-postgres\.ps1|stable-backup') { $found=$true }
    }
    $found
  })
  $active=@($matching | Where-Object { $_.State -ne 'Disabled' })
  [ordered]@{schema=1;dailyLocalTime=$At;timeZone=[TimeZoneInfo]::Local.Id;runtimeRoot=$runtime;launcherDigest=$digest;nodeAvailable=[bool]$node;rcloneAvailable=[bool]$rclone;matchingTasks=$matching.Count;enabledMatchingTasks=$active.Count;proposedTaskName='ARS Distributor - Stable Encrypted Backup';multipleInstances='IgnoreNew';runAs='Current interactive Windows user';schedulingAllowed=$false;uploadAllowed=$false;existingTasksChanged=$false;blockers=@('Stable backup execution and runtime activation not yet approved.','Existing schedules require review; task inventory is heuristic.','Encrypted remote and restore acceptance still required.')} | ConvertTo-Json -Depth 4
} finally {
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
