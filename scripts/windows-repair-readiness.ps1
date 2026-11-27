# Read-only repair readiness; never selects or activates a repair.
. (Join-Path $PSScriptRoot 'windows-repair-rehearsal.ps1')
. (Join-Path $PSScriptRoot 'windows-repair-native-probe.ps1')
function Assert-ArsRepairReadinessReceipts($binding,$backup,$test,$completion,[string]$backupHash,[string]$testHash) {
 foreach ($receipt in @($backup,$test,$completion)) {
  foreach ($flag in @('activationAllowed','startupAllowed','repairApplied')) {
   if ($receipt.$flag -isnot [bool] -or $receipt.$flag) { throw 'Unexpected repair authorization.' }
  }
 }
 if ($backup.schema -ne 1 -or $backup.kind -cne 'windows-repair-backup-observation' -or $backup.backupEvidenceMatched -isnot [bool] -or -not $backup.backupEvidenceMatched -or $backup.repairCandidateRestoreTested -isnot [bool] -or $backup.repairCandidateRestoreTested) { throw 'Invalid backup observation.' }
 foreach ($key in @('receiptDigest','manifestDigest','releaseDigest')) {
  if ($backup.binding.$key -cne $binding[$key] -or $test.repairBinding.$key -cne $binding[$key]) { throw 'Repair identity mismatch.' }
 }
 if ($test.schema -ne 1 -or $test.kind -cne 'windows-isolated-repair-restore-test' -or $test.recoveryId -cne $backup.recoveryId -or $test.dependencyImageId -cnotmatch '^sha256:[a-f0-9]{64}$') { throw 'Invalid repair test receipt.' }
 foreach ($flag in @('offlineRestorePassed','candidateStartupPassed','authenticatedReadsPassed','authenticatedWritesPassed','historicalRowsCompared','backwardStartupPassed','backwardReadsPassed','backwardWritesPassed','candidateRestartPreserved','previousRestartPreserved','repairSpecificBackwardTested')) {
  if ($test.$flag -isnot [bool] -or -not $test.$flag) { throw 'Incomplete repair test.' }
 }
 if ($test.previousBuildDigest -cnotmatch '^[a-f0-9]{64}$' -or $test.previousDependencyImageId -cnotmatch '^sha256:[a-f0-9]{64}$') { throw 'Previous executable identity missing.' }
 foreach ($flag in @('activationApproved','continuousExclusionVerified')) {
  if ($test.$flag -isnot [bool] -or $test.$flag) { throw 'Unexpected test authorization.' }
 }
 if ($completion.schema -ne 1 -or $completion.kind -cne 'windows-repair-rehearsal-observation' -or $completion.backupObservationDigest -cne $backupHash -or $completion.testReceiptDigest -cne $testHash) { throw 'Post-test observation mismatch.' }
}
function Get-ArsRepairReadiness([string]$project,[string]$folder) {
 $state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
 $mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
 $owned=$false
 try {
  try { $owned=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned=$true; throw 'Interrupted maintenance requires review.' }
  if (-not $owned) { throw 'Another maintenance operation is active.' }
  foreach ($key in @('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH')) {
   if ([Environment]::GetEnvironmentVariable($key,'Process')) { throw 'Custom Docker connection unsupported.' }
  }
  $endpoint=(& docker context inspect --format '{{.Endpoints.docker.Host}}')
  if ($LASTEXITCODE -ne 0 -or $endpoint -notin @('npipe:////./pipe/docker_engine','npipe:////./pipe/dockerDesktopLinuxEngine')) { throw 'Local Docker engine required.' }
  $control=Join-Path $state 'desktop-control'
  Assert-ArsPlainPath $control
  $markers=@('runtime-activation-interrupted.json','runtime-switch-intent.json','runtime-migration-interrupted.json','handoff-pending.json','switch-journal.json','repair-interrupted.json','runtime-switch-journal.json')
  if (@(Get-ChildItem -LiteralPath $control -Force | Where-Object Name -in $markers).Count) { throw 'Unresolved maintenance evidence.' }
  $binding=Get-ArsRepairReviewBinding $project $state $folder
  $names=@('backup-observation.json','repair-restore-test.json','repair-rehearsal-observation.json')
  $hashes=[ordered]@{}
  $records=[ordered]@{}
  foreach ($name in $names) {
   $hashes[$name]=Get-ArsRepairMetadataHash $folder $name
   $records[$name]=Get-Content -LiteralPath (Join-Path $folder $name) -Raw | ConvertFrom-Json
  }
  $backup=$records[$names[0]]
  $test=$records[$names[1]]
  Assert-ArsRepairReadinessReceipts $binding $backup $test $records[$names[2]] $hashes[$names[0]] $hashes[$names[1]]
  $id=$backup.recoveryId
  if ($id -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{32}$') { throw 'Invalid recovery identity.' }
  $recovery=Join-Path (Join-Path $state 'update-recovery') $id
  foreach ($name in @('recovery.json','rollback-compatibility-rehearsal.json')) {
   if ((Get-ArsRepairMetadataHash $recovery $name) -cne $backup.evidence.$name) { throw 'Backup evidence changed.' }
  }
  $prior=Get-Content -LiteralPath (Join-Path $recovery 'rollback-compatibility-rehearsal.json') -Raw | ConvertFrom-Json
  if ($test.previousBuildDigest -cne $prior.previousBuildDigest -or $test.previousDependencyImageId -cne $prior.previousDependencyImageId -or $test.archiveSha256 -cne $prior.archiveSha256) { throw 'Previous rollback identity mismatch.' }
  $meta=Get-Content -LiteralPath (Join-Path $recovery 'recovery.json') -Raw | ConvertFrom-Json
  if ($test.archiveSha256 -cne $meta.archiveSha256 -or $test.version -cne $meta.version) { throw 'Repair rehearsal archive mismatch.' }
  $plan=(@(& (Join-Path $project 'scripts/plan-windows-runtime-activation.ps1') -RecoveryId $id) -join [Environment]::NewLine) | ConvertFrom-Json
  Test-ArsRepairBackupPlan $plan $id
  $image=@(& docker image inspect --format '{{.Id}}' $test.dependencyImageId)
  if ($LASTEXITCODE -ne 0 -or $image.Count -ne 1 -or $image[0] -cne $test.dependencyImageId) { throw 'Tested repair image unavailable.' }
  $label=@(& docker image inspect --format '{{index .Config.Labels "com.rsnextward.ars-lock-sha256"}}' $test.dependencyImageId)
  $lock=(Get-ArsRepairMetadataHash (Join-Path $folder 'candidate') 'package-lock.json').ToLowerInvariant()
  if ($LASTEXITCODE -ne 0 -or $label.Count -ne 1 -or $label[0] -cne $lock) { throw 'Tested dependency identity mismatch.' }
  foreach ($name in $names) {
   if ((Get-ArsRepairMetadataHash $folder $name) -cne $hashes[$name]) { throw 'Repair evidence changed.' }
  }
  foreach ($name in @('recovery.json','rollback-compatibility-rehearsal.json')) {
   if ((Get-ArsRepairMetadataHash $recovery $name) -cne $backup.evidence.$name) { throw 'Backup evidence changed.' }
  }
  if (((Get-ArsRepairReviewBinding $project $state $folder) | ConvertTo-Json -Compress) -cne ($binding | ConvertTo-Json -Compress)) { throw 'Repair identity changed.' }
  $native=Get-ArsNativeRepairProbe $test.dependencyImageId
  [ordered]@{nativeProbe=$native;schema=1;repairEvidenceMatched=$true;testedContainerImageRetained=$true;repairSpecificBackwardTested=$true;previousBuildDigest=$test.previousBuildDigest;previousDependencyImageId=$test.previousDependencyImageId;nativeWindowsBuildTested=$false;continuousExclusionVerified=$false;rollbackVerified=$false;activationAllowed=$false;startupAllowed=$false;repairApplied=$false}
 } finally {
  if ($owned) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
 }
}
