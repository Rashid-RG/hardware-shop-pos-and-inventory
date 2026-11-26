# Read-only schedule inventory. A saved proposal is not an activation approval.
param()
$ErrorActionPreference='Stop'
$state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
$control=Join-Path $state 'desktop-control'
$package=Join-Path $state 'launcher-prepared'
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another launcher or maintenance operation is active.' }
  foreach ($directory in @($control,$package)) {
    $cursor=$directory
    while ($cursor) {
      $item=Get-Item -LiteralPath $cursor -Force
      if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid schedule directory.' }
      $cursor=Split-Path -Parent $cursor
    }
  }
  . (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
  $digest=(Assert-ArsPreparedFingerprint $package).digest
  $savedTime=$null
  $proposal='not-prepared'
  $target=Join-Path $control 'backup-schedule-prepared.json'
  if (Test-Path -LiteralPath $target) {
    $item=Get-Item -LiteralPath $target -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 8192) { throw 'Invalid schedule record.' }
    $p=Get-Content -LiteralPath $target -Raw | ConvertFrom-Json
    if ($p.schema -ne 1 -or $p.dailyLocalTime -isnot [string] -or $p.dailyLocalTime -cnotmatch '^([01][0-9]|2[0-3]):[0-5][0-9]$' -or $p.schedulingAllowed -isnot [bool] -or $p.schedulingAllowed -or $p.uploadAllowed -isnot [bool] -or $p.uploadAllowed) { throw 'Invalid inactive schedule proposal.' }
    $savedTime=$p.dailyLocalTime
    $proposal='review-required'
    if ($p.launcherDigest -ceq $digest -and $p.userSid -ceq [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -and $p.timeZone -ceq [TimeZoneInfo]::Local.Id) { $proposal='local-metadata-matched' }
  }
  $tasks=@(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -eq 'ARS Distributor - Stable Encrypted Backup' })
  $taskState='not-registered'
  if ($tasks.Count -gt 0) {
    $taskState='review-required'
    if ($tasks.Count -eq 1 -and $tasks[0].TaskPath -eq '\' -and $tasks[0].State -eq 'Disabled' -and $tasks[0].Settings.Enabled -eq $false -and $tasks[0].Settings.AllowDemandStart -eq $false -and @($tasks[0].Triggers).Count -eq 1 -and $tasks[0].Triggers[0].Enabled -eq $false -and @($tasks[0].Actions).Count -eq 1 -and $tasks[0].Actions[0].Arguments -ceq ('-NoProfile -NonInteractive -File "'+(Join-Path $package 'scripts\preview-windows-stable-backup.ps1')+'"')) { $taskState='disabled-preview' }
  }
  [ordered]@{schema=1;dailyLocalTime=$savedTime;proposalState=$proposal;taskState=$taskState;activationAllowed=$false;uploadAllowed=$false;existingTasksChanged=$false} | ConvertTo-Json
} finally {
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
