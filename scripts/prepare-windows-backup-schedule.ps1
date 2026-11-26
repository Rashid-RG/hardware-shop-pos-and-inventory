# Persist a proposed schedule only. Never register or enable a scheduled task.
param([ValidatePattern('^([01][0-9]|2[0-3]):[0-5][0-9]$')][string]$At='20:00',[switch]$Verify)
$ErrorActionPreference='Stop'
$state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
$control=Join-Path $state 'desktop-control'
$target=Join-Path $control 'backup-schedule-prepared.json'
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
function Read-SchedulePlan([string]$Time) {
  $p=(@(& (Join-Path $PSScriptRoot 'plan-windows-stable-backup-schedule.ps1') -At $Time) -join [Environment]::NewLine) | ConvertFrom-Json
  if ($p.schema -ne 1 -or $p.dailyLocalTime -cne $Time -or $p.schedulingAllowed -ne $false -or $p.uploadAllowed -ne $false -or $p.existingTasksChanged -ne $false -or $p.nodeAvailable -ne $true -or $p.rcloneAvailable -ne $true -or $p.matchingTasks -ne 0) { throw 'Backup schedule plan unavailable or conflicting tasks require review.' }
  $preview=(@(& (Join-Path $state 'launcher-prepared\scripts\preview-windows-stable-backup.ps1')) -join [Environment]::NewLine) | ConvertFrom-Json
  if ($preview.schema -ne 1 -or $preview.launcherDigest -cne $p.launcherDigest -or $preview.databaseBindingMatched -ne $true -or $preview.backupLocksAbsent -ne $true -or $preview.schedulingAllowed -ne $false -or $preview.backupStarted -ne $false) { throw 'Stable backup readiness failed.' }
  [ordered]@{schema=1;dailyLocalTime=$Time;timeZone=$p.timeZone;runtimeRoot=$p.runtimeRoot;launcherDigest=$p.launcherDigest;userSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;taskName=$p.proposedTaskName;multipleInstances='IgnoreNew';startWhenAvailable=$true;schedulingAllowed=$false;uploadAllowed=$false;existingTasksChanged=$false}
}
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another launcher or maintenance operation is active.' }
  $cursor=$control
  while ($cursor) {
    $item=Get-Item -LiteralPath $cursor -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid schedule control directory.' }
    $cursor=Split-Path -Parent $cursor
  }
  if ($Verify) {
    $item=Get-Item -LiteralPath $target -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 8192) { throw 'Invalid schedule record.' }
    $saved=Get-Content -LiteralPath $target -Raw | ConvertFrom-Json
    if ($saved.dailyLocalTime -isnot [string] -or $saved.dailyLocalTime -cnotmatch '^([01][0-9]|2[0-3]):[0-5][0-9]$') { throw 'Invalid saved schedule time.' }
    $expected=Read-SchedulePlan $saved.dailyLocalTime
    foreach ($key in $expected.Keys) {
      if ($expected[$key] -is [bool] -and $saved.$key -isnot [bool]) { throw 'Invalid schedule flag.' }
      if ($saved.$key -cne $expected[$key]) { throw 'Saved schedule differs from current readiness evidence.' }
    }
    if (@($saved.PSObject.Properties).Count -ne $expected.Count) { throw 'Unexpected schedule fields.' }
    [ordered]@{schema=1;scheduleMatched=$true;dailyLocalTime=$saved.dailyLocalTime;timeZone=$saved.timeZone;schedulingAllowed=$false;uploadAllowed=$false} | ConvertTo-Json
    return
  }
  if (Test-Path -LiteralPath $target) { throw 'Prepared schedule already exists; no overwrite permitted.' }
  $first=Read-SchedulePlan $At
  if ((Read-Host 'Type PREPARE BACKUP SCHEDULE to save an inactive proposal') -cne 'PREPARE BACKUP SCHEDULE') { return }
  $second=Read-SchedulePlan $At
  $json=$first | ConvertTo-Json -Compress
  if (($second | ConvertTo-Json -Compress) -cne $json) { throw 'Schedule readiness changed during confirmation.' }
  $pending=Join-Path $control ('.pending-backup-schedule-'+[guid]::NewGuid().ToString('N'))
  $stream=[IO.File]::Open($pending,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $bytes=[Text.Encoding]::UTF8.GetBytes($json); $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
  [IO.File]::Move($pending,$target)
  Write-Host 'Inactive backup schedule saved. No task registered or upload started.'
} finally {
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
