# Non-authorizing Windows repair activation plan; no file switching.
. (Join-Path $PSScriptRoot 'windows-repair-rollback-preparation.ps1')
. (Join-Path $PSScriptRoot 'windows-repair-interruption.ps1')
function ConvertTo-ArsRepairCanonical($value) {
 if ($value -is [System.Collections.IDictionary]) {
  $ordered=[ordered]@{}
  foreach ($key in ($value.Keys | Sort-Object -CaseSensitive)) { $ordered[$key]=ConvertTo-ArsRepairCanonical $value[$key] }
  return $ordered
 }
 if ($value -is [pscustomobject]) {
  $ordered=[ordered]@{}
  foreach ($property in ($value.PSObject.Properties | Sort-Object Name -CaseSensitive)) { $ordered[$property.Name]=ConvertTo-ArsRepairCanonical $property.Value }
  return $ordered
 }
 return $value
}
function Test-ArsRepairEqual($left,$right) {
 ((ConvertTo-ArsRepairCanonical $left)|ConvertTo-Json -Depth 12 -Compress) -ceq ((ConvertTo-ArsRepairCanonical $right)|ConvertTo-Json -Depth 12 -Compress)
}
function New-ArsRepairActivationPlan($record,$observed,[string]$digest,[string]$folder) {
 if (-not (Test-ArsRepairEqual $record $observed) -or $record.schema -ne 1 -or $record.kind -cne 'windows-repair-rollback-preparation' -or $record.repairSpecificRollbackTested -isnot [bool] -or -not $record.repairSpecificRollbackTested -or $digest -cnotmatch '^[a-fA-F0-9]{64}$' -or $folder -cnotmatch '^repair-preparation-[a-f0-9]{32}$') { throw 'Rollback evidence missing or changed.' }
 foreach ($flag in @('activationAllowed','startupAllowed','repairApplied','rollbackAllowed','continuousExclusionVerified')) {
  if ($record.$flag -isnot [bool] -or $record.$flag) { throw 'Unexpected repair authorization.' }
 }
 [ordered]@{schema=1;kind='windows-repair-activation-plan';observationOnly=$true;repairFolder=$folder;rollbackReceiptDigest=$digest;recoveryId=$record.recoveryId;previousProject=$record.previousProject;previousBuildDigest=$record.previousBuildDigest;previousDependencyImageId=$record.previousDependencyImageId;repairDependencyImageId=$record.repairDependencyImageId;archiveSha256=$record.archiveSha256;repairEvidenceDigests=$record.repairEvidenceDigests;nativeHostRepairCertified=$false;continuousExclusionVerified=$false;fileSwitchAllowed=$false;activationAllowed=$false;startupAllowed=$false;repairApplied=$false;rollbackAllowed=$false}
}
function Prepare-ArsRepairActivationPlan([string]$project,[string]$folder) {
 $mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
 $owned=$false
 try {
  try { $owned=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned=$true; throw 'Interrupted maintenance requires review.' }
  if (-not $owned) { throw 'Maintenance is active.' }
  $observed=Get-ArsRepairRollbackObservation $project $folder
  $receipt=Join-Path $folder 'rollback-preparation.json'
  $raw=Read-ArsInterruptionFile $receipt
  $digest=Get-ArsRepairMetadataHash $folder 'rollback-preparation.json'
  $plan=New-ArsRepairActivationPlan ($raw|ConvertFrom-Json) $observed $digest (Split-Path -Leaf $folder)
  $target=Join-Path $folder 'activation-plan.json'
  $existing=Test-Path -LiteralPath $target
  if ($existing -and -not (Test-ArsRepairEqual ((Read-ArsInterruptionFile $target)|ConvertFrom-Json) $plan)) { throw 'Existing activation plan differs.' }
  if (-not (Test-ArsRepairEqual (Get-ArsRepairRollbackObservation $project $folder) $observed) -or (Read-ArsInterruptionFile $receipt) -cne $raw -or (Get-ArsRepairMetadataHash $folder 'rollback-preparation.json') -cne $digest) { throw 'Repair evidence changed.' }
  if (-not $existing) {
   $bytes=[Text.Encoding]::UTF8.GetBytes(($plan|ConvertTo-Json -Depth 12))
   $stream=[IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
   try { $stream.Write($bytes,0,$bytes.Length);$stream.Flush($true) } finally { $stream.Dispose() }
  }
  if (-not (Test-ArsRepairEqual ((Read-ArsInterruptionFile $target)|ConvertFrom-Json) $plan)) { throw 'Activation plan could not be verified.' }
  return $plan
 } finally {
  if ($owned) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
 }
}
