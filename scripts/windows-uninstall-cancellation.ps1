# Dedicated cancellation only. No database restore, application removal or automatic startup.
. (Join-Path $PSScriptRoot 'windows-uninstall-backup-preparation.ps1')
. (Join-Path $PSScriptRoot 'windows-installation-identity.ps1')
. (Join-Path $PSScriptRoot 'windows-desktop-registration.ps1')
function Assert-ArsUninstallCancellation($hold,$proof,[string]$project,[string]$confirmation) {
 if ($confirmation -cne 'CANCEL UNINSTALL AND KEEP POS') {throw 'Explicit cancellation approval required.'}
 Assert-ArsUninstallHold $hold $proof $project
 foreach ($record in @($hold,$proof)) {
  foreach ($flag in @('activationApproved','databaseDeletionAllowed')) {
   if ($record.$flag -isnot [bool] -or $record.$flag) {throw 'Unexpected authorization.'}
  }
 }
 if ($hold.pid -lt 1 -or $hold.startedUtc -cnotmatch '^[0-9]{1,19}$') {throw 'Invalid process evidence.'}
}
function Write-ArsCancellationBytes([string]$path,[byte[]]$bytes) {
 $stream=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try {$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)} finally {$stream.Dispose()}
}
function Cancel-ArsUninstall([string]$project,[string]$confirmation) {
 if ($confirmation -cne 'CANCEL UNINSTALL AND KEEP POS') {throw 'Explicit cancellation approval required.'}
 $state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
 $control=Join-Path $state 'desktop-control'
 $mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
 $owned=$false
 try {
  try {$owned=$mutex.WaitOne(0)} catch [System.Threading.AbandonedMutexException] {$owned=$true;throw 'Interrupted maintenance requires review.'}
  if (-not $owned) {throw 'Maintenance active.'}
  foreach ($p in @($project,$state,$control)) {Assert-ArsPlainPath $p}
  if ($null -ne [Environment]::GetEnvironmentVariable('ARS_RUNTIME_ROOT','Process')) {throw 'Unsupported runtime override.'}
  $marker=Join-Path $control 'maintenance.json'
  $proofPath=Join-Path $control 'maintenance-shutdown.json'
  $hashes=[ordered]@{}
  $bytes=[ordered]@{}
  foreach ($p in @($marker,$proofPath)) {
   Assert-ArsPlainPath $p
   $item=Get-Item -LiteralPath $p -Force
   if ($item.PSIsContainer -or $item.Length -lt 1 -or $item.Length -gt 65536) {throw 'Invalid evidence file.'}
   $hashes[$p]=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash
   $bytes[$p]=[IO.File]::ReadAllBytes($p)
  }
  $hold=[Text.Encoding]::UTF8.GetString($bytes[$marker])|ConvertFrom-Json
  $proof=[Text.Encoding]::UTF8.GetString($bytes[$proofPath])|ConvertFrom-Json
  Assert-ArsUninstallCancellation $hold $proof $project $confirmation
  $incidents=@('instance.json','repair-interrupted.json','runtime-switch-intent.json','runtime-switch-journal.json','runtime-active.json','activation.json','handoff-pending.json','runtime-activation-interrupted.json','runtime-migration-interrupted.json','switch-journal.json')
  function Assert-UnchangedInstallation {
   if (@(Get-ChildItem -LiteralPath $control -Force -ErrorAction Stop|Where-Object Name -in $incidents).Count -or (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {throw 'Application or unresolved incident remains active.'}
   $old=Get-Process -Id ([int]$hold.pid) -ErrorAction SilentlyContinue
   if ($old -and $old.StartTime.ToUniversalTime().Ticks.ToString() -ceq $hold.startedUtc) {throw 'Original application remains active.'}
   foreach ($p in @($marker,$proofPath)) {
    Assert-ArsPlainPath $p
    if ((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash -cne $hashes[$p]) {throw 'Shutdown evidence changed.'}
   }
   foreach ($relative in @('.env.local','dist/server.cjs','dist/index.html')) {
    $p=Join-Path $project $relative
    Assert-ArsPlainPath $p
    if ((Get-Item -LiteralPath $p -Force).PSIsContainer) {throw 'Invalid application file.'}
   }
   $null=Review-ArsInstallationIdentity $project $state
   $null=Review-ArsDesktopRegistration $project $state ([Environment]::GetFolderPath('DesktopDirectory')) ([Environment]::GetFolderPath('Programs'))
  }
  Assert-UnchangedInstallation
  $history=Join-Path $control ('uninstall-cancelled-'+$hold.uninstallId)
  New-Item -ItemType Directory -Path $history -ErrorAction Stop|Out-Null
  foreach ($p in @($marker,$proofPath)) {
   $copy=Join-Path $history ([IO.Path]::GetFileName($p))
   Write-ArsCancellationBytes $copy $bytes[$p]
   if ((Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash -cne $hashes[$p]) {throw 'Archived evidence mismatch.'}
  }
  $receipt=[ordered]@{schema=1;kind='windows-uninstall-cancellation';uninstallId=$hold.uninstallId;previousProject=$project;cancelledAt=[DateTime]::UtcNow.ToString('o');holdDigest=$hashes[$marker];shutdownDigest=$hashes[$proofPath];backupArchivesRetained=$true;databaseRestored=$false;releaseSwitched=$false;applicationRemovalAllowed=$false;applicationStarted=$false}
  Write-ArsCancellationBytes (Join-Path $history 'cancellation.json') ([Text.Encoding]::UTF8.GetBytes(($receipt|ConvertTo-Json -Compress)))
  Assert-UnchangedInstallation
  # Remove completion evidence first; the hold remains if interrupted.
  Remove-Item -LiteralPath $proofPath -ErrorAction Stop
  if ((Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash -cne $hashes[$marker] -or @(Get-ChildItem -LiteralPath $control -Force -ErrorAction Stop|Where-Object Name -in $incidents).Count) {throw 'Maintenance evidence changed; hold retained.'}
  Remove-Item -LiteralPath $marker -ErrorAction Stop
  return $receipt
 } finally {
  if ($owned) {$mutex.ReleaseMutex()}
  $mutex.Dispose()
 }
}
# Internal only until integrated cancellation and interruption acceptance.
