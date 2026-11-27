# Non-authorizing Windows repair rollback preparation.
. (Join-Path $PSScriptRoot 'windows-repair-readiness.ps1')
. (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
function Assert-ArsPreviousRepairBuild($previous,[string]$digest,[string]$archiveHash,[string]$id) {
 if ($previous.schema -ne 1 -or $previous.recoveryId -cne $id -or $previous.archiveSha256 -cne $archiveHash -or $previous.previousBuildDigest -cnotmatch '^[a-f0-9]{64}$' -or $previous.previousBuildDigest -cne $digest -or $previous.previousDependencyImageId -cnotmatch '^sha256:[a-f0-9]{64}$') { throw 'Previous rollback build identity mismatch.' }
 foreach ($flag in @('offlineRestorePassed','candidateStartupPassed','authenticatedReadsPassed','authenticatedWritesPassed','historicalRowsCompared','backwardStartupPassed','backwardReadsPassed','backwardWritesPassed')) {
  if ($previous.$flag -isnot [bool] -or -not $previous.$flag) { throw 'Existing backward rehearsal incomplete.' }
 }
 if ($previous.activationApproved -isnot [bool] -or $previous.activationApproved) { throw 'Unexpected activation approval.' }
}
function Get-ArsRepairRollbackObservation([string]$project,[string]$folder) {
 $state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
  $ready=Get-ArsRepairReadiness $project $folder
  if ($ready.repairEvidenceMatched -ne $true -or $ready.activationAllowed -ne $false) { throw 'Repair readiness unavailable.' }
  $binding=Get-ArsRepairReviewBinding $project $state $folder
  $hashes=[ordered]@{}
  foreach ($name in @('backup-observation.json','repair-restore-test.json','repair-rehearsal-observation.json')) { $hashes[$name]=Get-ArsRepairMetadataHash $folder $name }
  $backup=Get-Content -LiteralPath (Join-Path $folder 'backup-observation.json') -Raw | ConvertFrom-Json
  $test=Get-Content -LiteralPath (Join-Path $folder 'repair-restore-test.json') -Raw | ConvertFrom-Json
  $id=$backup.recoveryId
  if ($id -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{32}$') { throw 'Invalid recovery ID.' }
  $recovery=Join-Path (Join-Path $state 'update-recovery') $id
  $name='rollback-compatibility-rehearsal.json'
  $previousHash=Get-ArsRepairMetadataHash $recovery $name
  if ($previousHash -cne $backup.evidence.$name) { throw 'Existing rollback evidence changed.' }
  $previous=Get-Content -LiteralPath (Join-Path $recovery $name) -Raw | ConvertFrom-Json
  $dist=Join-Path $project 'dist'
  Assert-ArsPlainPath $dist
  $digest=(Get-ArsPreparedFingerprint $dist).digest
  Assert-ArsPreviousRepairBuild $previous $digest $test.archiveSha256 $id
  if ($test.previousBuildDigest -cne $digest -or $test.previousDependencyImageId -cne $previous.previousDependencyImageId) { throw 'Repair-specific previous executable identity mismatch.' }
  $image=$previous.previousDependencyImageId
  $actual=@(& docker image inspect --format '{{.Id}}' $image)
  if ($LASTEXITCODE -ne 0 -or $actual.Count -ne 1 -or $actual[0] -cne $image) { throw 'Previous dependency image unavailable.' }
  $label=@(& docker image inspect --format '{{index .Config.Labels "com.rsnextward.ars-lock-sha256"}}' $image)
  $lock=(Get-ArsRepairMetadataHash $project 'package-lock.json').ToLowerInvariant()
  if ($LASTEXITCODE -ne 0 -or $label.Count -ne 1 -or $label[0] -cne $lock) { throw 'Previous dependency lock mismatch.' }
  $again=Get-ArsRepairReadiness $project $folder
  if (($again | ConvertTo-Json -Depth 8 -Compress) -cne ($ready | ConvertTo-Json -Depth 8 -Compress) -or (Get-ArsPreparedFingerprint $dist).digest -cne $digest -or (Get-ArsRepairMetadataHash $recovery $name) -cne $previousHash -or ((Get-ArsRepairReviewBinding $project $state $folder)|ConvertTo-Json -Compress) -cne ($binding|ConvertTo-Json -Compress)) { throw 'Rollback evidence changed.' }
  foreach ($key in $hashes.Keys) { if ((Get-ArsRepairMetadataHash $folder $key) -cne $hashes[$key]) { throw 'Repair evidence changed.' } }
  $record=[ordered]@{schema=1;kind='windows-repair-rollback-preparation';recoveryId=$id;previousProject=$project;previousBuildDigest=$digest;previousDependencyImageId=$image;repairDependencyImageId=$test.dependencyImageId;archiveSha256=$test.archiveSha256;previousReceiptDigest=$previousHash;repairEvidenceDigests=$hashes;previousUpdateRollbackEvidenceMatched=$true;repairSpecificRollbackTested=$true;continuousExclusionVerified=$false;activationAllowed=$false;startupAllowed=$false;repairApplied=$false;rollbackAllowed=$false}
  return $record
}
function Prepare-ArsRepairRollback([string]$project,[string]$folder) {
 $mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
 $owned=$false
 try {
  try { $owned=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned=$true; throw 'Interrupted maintenance requires review.' }
  if (-not $owned) { throw 'Maintenance is active.' }
  $record=Get-ArsRepairRollbackObservation $project $folder
  $target=Join-Path $folder 'rollback-preparation.json'
  $bytes=[Text.Encoding]::UTF8.GetBytes(($record|ConvertTo-Json -Depth 8))
  $stream=[IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $stream.Write($bytes,0,$bytes.Length);$stream.Flush($true) } finally { $stream.Dispose() }
  return $record
 } finally {
  if ($owned) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
 }
}
