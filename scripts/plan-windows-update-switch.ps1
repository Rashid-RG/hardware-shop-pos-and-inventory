# Read-only activation preflight. No release switch, database restore or approval.
param([Parameter(Mandatory=$true)][string]$RecoveryId)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
if ($RecoveryId -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{32}$') { throw 'Invalid recovery identifier.' }
$root=Split-Path -Parent $PSScriptRoot
$state=Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor'
$control=Join-Path $state 'desktop-control'
$folder=Join-Path (Join-Path $state 'update-recovery') $RecoveryId
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
function Read-Evidence([string]$Path) {
  $item=Get-Item -LiteralPath $Path -Force
  if ($item.PSIsContainer -or $item.Length -gt 1048576 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid evidence file.' }
  Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another startup or maintenance operation is active.' }
  foreach ($dir in @($state,$control,(Split-Path -Parent $folder),$folder)) {
    if ((Get-Item -LiteralPath $dir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected evidence directory reparse point.' }
  }
  $m=Read-Evidence (Join-Path $folder 'recovery.json')
  if ($m.schema -ne 1 -or $m.previousProject -ine $root -or $m.activationApproved -ne $false -or $m.managedShutdownVerified -ne $true -or $m.databaseActivityChecksPassed -ne $true -or $m.version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$' -or $RecoveryId -cnotlike ($m.version+'-*') -or $m.archive -cnotmatch '^ars-[A-Za-z0-9_-]+\.dump$') { throw 'Matching final maintenance recovery record required.' }
  $marker=Join-Path $control 'maintenance.json'
  $proof=Join-Path $control 'maintenance-shutdown.json'
  $a=Read-Evidence $marker
  $b=Read-Evidence $proof
  if ($a.schema -ne 1 -or $b.schema -ne 1 -or $a.project -ine $root -or $b.project -ine $root -or $a.pid -ne $b.pid -or $a.startedUtc -cne $b.startedUtc -or $a.requestedAt -cne $b.requestedAt -or $a.shutdownVerified -ne $false -or $b.shutdownVerified -ne $true -or $a.activationApproved -ne $false -or $b.activationApproved -ne $false) { throw 'Matching verified maintenance state required.' }
  $digest=(Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash+':'+(Get-FileHash -LiteralPath $proof -Algorithm SHA256).Hash
  if ($digest -cne $m.maintenanceDigest) { throw 'Final backup belongs to a different maintenance session.' }
  if ((Test-Path -LiteralPath (Join-Path $control 'instance.json')) -or (Test-Path -LiteralPath (Join-Path $control 'activation.json'))) { throw 'Existing managed instance or activation evidence blocks preflight.' }
  if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { throw 'Application listener exists.' }
  $old=Get-Process -Id ([int]$a.pid) -ErrorAction SilentlyContinue
  if ($old -and $old.StartTime.ToUniversalTime().Ticks.ToString() -ceq $a.startedUtc) { throw 'Previous application process remains active.' }
  $archive=Join-Path $folder $m.archive
  if ((Get-Item -LiteralPath $archive -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected archive reparse point.' }
  & node (Join-Path $root 'scripts/verify-backup.mjs') $archive | Out-Host
  if ($LASTEXITCODE -ne 0 -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -cne $m.archiveSha256) { throw 'Final archive verification failed.' }
  $prepared=Join-Path (Join-Path $state 'prepared-releases') $m.version
  if ((Assert-ArsPreparedFingerprint $prepared).digest -cne $m.preparedDigest) { throw 'Candidate build differs from recovery record.' }
  $r=Read-Evidence (Join-Path $folder 'rollback-compatibility-rehearsal.json')
  if ($r.schema -ne 1 -or $r.recoveryId -cne $RecoveryId -or $r.version -cne $m.version -or $r.archiveSha256 -cne $m.archiveSha256 -or $r.preparedDigest -cne $m.preparedDigest -or $r.activationApproved -ne $false) { throw 'Matching rollback rehearsal evidence required.' }
  foreach ($flag in @('offlineRestorePassed','candidateStartupPassed','authenticatedReadsPassed','authenticatedWritesPassed','historicalRowsCompared','backwardStartupPassed','backwardReadsPassed','backwardWritesPassed')) {
    if ($r.$flag -ne $true) { throw "Required rehearsal check failed: $flag" }
  }
  if ((Get-ArsPreparedFingerprint (Join-Path $root 'dist')).digest -cne $r.previousBuildDigest) { throw 'Previous executable differs from rehearsal.' }
  $blockers=@('Continuous database writer exclusion not implemented or independently verified.','Native Windows runtime and physical acceptance not verified.','Stable runtime storage and atomic version switch not implemented.','Explicit activation approval required.')
  [ordered]@{schema=1;recoveryId=$RecoveryId;currentProject=$root;candidateProject=$prepared;candidateVersion=$m.version;archive=$archive;evidenceMatched=$true;activationAllowed=$false;rollbackAllowed=$false;blockers=$blockers} | ConvertTo-Json -Depth 4
} finally {
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
