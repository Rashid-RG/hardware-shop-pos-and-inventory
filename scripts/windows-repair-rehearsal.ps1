# Explicit repair rehearsal wrapper. Never starts the live POS.
. (Join-Path $PSScriptRoot 'windows-repair-backup-review.ps1')
function Invoke-ArsRepairRehearsal([string]$project,[string]$folder) {
 $state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
 $mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
 $owned=$false
 try {
  try { $owned=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned=$true; throw 'Interrupted maintenance requires review.' }
  if (-not $owned) { throw 'Another maintenance operation is active.' }
  foreach ($key in @('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH')) {
   if ([Environment]::GetEnvironmentVariable($key,'Process')) { throw 'Custom Docker connection is unsupported.' }
  }
  $endpoint=(& docker context inspect --format '{{.Endpoints.docker.Host}}')
  if ($LASTEXITCODE -ne 0 -or $endpoint -notin @('npipe:////./pipe/docker_engine','npipe:////./pipe/dockerDesktopLinuxEngine')) { throw 'Local Windows Docker engine required.' }
  $binding=Get-ArsRepairReviewBinding $project $state $folder
  $hash=Get-ArsRepairMetadataHash $folder 'backup-observation.json'
  $obs=Get-Content -LiteralPath (Join-Path $folder 'backup-observation.json') -Raw | ConvertFrom-Json
  if ($obs.kind -cne 'windows-repair-backup-observation' -or $obs.backupEvidenceMatched -ne $true -or ($obs.binding | ConvertTo-Json -Compress) -cne ($binding | ConvertTo-Json -Compress)) { throw 'Matching backup observation required.' }
  foreach ($flag in @('repairCandidateRestoreTested','activationAllowed','startupAllowed','repairApplied','continuousExclusionVerified')) {
   if ($obs.$flag -isnot [bool] -or $obs.$flag) { throw 'Unexpected repair authorization.' }
  }
  $id=$obs.recoveryId
  if ($id -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{32}$') { throw 'Invalid recovery ID.' }
  $control=Join-Path $state 'desktop-control'
  Assert-ArsPlainPath $control
  $markers=@('runtime-activation-interrupted.json','runtime-switch-intent.json','runtime-migration-interrupted.json','handoff-pending.json','switch-journal.json','repair-interrupted.json','runtime-switch-journal.json')
  if (@(Get-ChildItem -LiteralPath $control -Force | Where-Object Name -in $markers).Count) { throw 'Unresolved maintenance evidence.' }
  foreach ($entry in @(Get-ChildItem -LiteralPath $folder -Force)) {
   if ($entry.Name -in @('repair-restore-test.json','repair-rehearsal-observation.json')) { throw 'Existing rehearsal evidence must be retained; prepare a fresh repair folder.' }
  }
  $recovery=Join-Path (Join-Path $state 'update-recovery') $id
  foreach ($name in @('recovery.json','rollback-compatibility-rehearsal.json')) {
   if ((Get-ArsRepairMetadataHash $recovery $name) -cne $obs.evidence.$name) { throw 'Backup evidence changed.' }
  }
  $plan=(@(& (Join-Path $project 'scripts/plan-windows-runtime-activation.ps1') -RecoveryId $id) -join [Environment]::NewLine) | ConvertFrom-Json
  Test-ArsRepairBackupPlan $plan $id
  & (Join-Path $project 'scripts/rehearse-windows-update-container.ps1') -RecoveryId $id -CandidateStartup -RepairFolder $folder -RepairConfirmed
  if ((Get-ArsRepairMetadataHash $folder 'backup-observation.json') -cne $hash -or ((Get-ArsRepairReviewBinding $project $state $folder) | ConvertTo-Json -Compress) -cne ($binding | ConvertTo-Json -Compress)) { throw 'Repair evidence changed.' }
  $plan=(@(& (Join-Path $project 'scripts/plan-windows-runtime-activation.ps1') -RecoveryId $id) -join [Environment]::NewLine) | ConvertFrom-Json
  Test-ArsRepairBackupPlan $plan $id
  $testHash=Get-ArsRepairMetadataHash $folder 'repair-restore-test.json'
  $result=Get-Content -LiteralPath (Join-Path $folder 'repair-restore-test.json') -Raw | ConvertFrom-Json
  foreach ($flag in @('offlineRestorePassed','candidateStartupPassed','authenticatedReadsPassed','authenticatedWritesPassed','historicalRowsCompared','backwardStartupPassed','backwardReadsPassed','backwardWritesPassed','candidateRestartPreserved','previousRestartPreserved','repairSpecificBackwardTested')) {
   if ($result.$flag -isnot [bool] -or -not $result.$flag) { throw 'Repair rehearsal incomplete.' }
  }
  foreach ($name in @('recovery.json','rollback-compatibility-rehearsal.json')) {
   if ((Get-ArsRepairMetadataHash $recovery $name) -cne $obs.evidence.$name) { throw 'Backup evidence changed.' }
  }
  $prior=Get-Content -LiteralPath (Join-Path $recovery 'rollback-compatibility-rehearsal.json') -Raw | ConvertFrom-Json
  if ($result.previousBuildDigest -cne $prior.previousBuildDigest -or $result.previousDependencyImageId -cne $prior.previousDependencyImageId -or $result.archiveSha256 -cne $prior.archiveSha256) { throw 'Previous executable or archive mismatch.' }
  # Separate completion receipt, only after post-rehearsal evidence checks.
  if ((Get-ArsRepairMetadataHash $folder 'repair-restore-test.json') -cne $testHash -or (Get-ArsRepairMetadataHash $folder 'backup-observation.json') -cne $hash -or @(Get-ChildItem -LiteralPath $control -Force | Where-Object Name -in $markers).Count) { throw 'Rehearsal evidence changed before completion.' }
  $final=[ordered]@{schema=1;kind='windows-repair-rehearsal-observation';scope='isolated-rehearsal-only';liveRepairCompleted=$false;rollbackAllowed=$false;continuousExclusionVerified=$false;backupObservationDigest=$hash;testReceiptDigest=$testHash;activationAllowed=$false;repairApplied=$false;startupAllowed=$false}
  $file=[IO.File]::Open((Join-Path $folder 'repair-rehearsal-observation.json'),[IO.FileMode]::CreateNew)
  try { $bytes=[Text.Encoding]::UTF8.GetBytes(($final | ConvertTo-Json)); $file.Write($bytes,0,$bytes.Length); $file.Flush($true) } finally { $file.Dispose() }
 } finally {
  if ($owned) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
 }
}
