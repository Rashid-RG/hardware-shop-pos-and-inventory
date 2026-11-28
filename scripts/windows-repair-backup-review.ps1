# Read-only backup observation, never authorizes repair or startup.
. (Join-Path $PSScriptRoot 'windows-prepare-repair.ps1')
function Get-ArsRepairReviewBinding([string]$project,[string]$state,[string]$folder) {
 foreach ($path in @($project,$state,$folder)) { Assert-ArsPlainPath $path }
 if ((Split-Path -Parent $folder) -ine $state -or (Split-Path -Leaf $folder) -cnotmatch '^repair-preparation-[a-f0-9]{32}$') { throw 'Managed repair folder required.' }
 $candidate=Join-Path $folder 'candidate'
 $receiptHash=Get-ArsRepairMetadataHash $folder 'repair-preparation.json'
 $receipt=Get-Content -LiteralPath (Join-Path $folder 'repair-preparation.json') -Raw | ConvertFrom-Json
 if ($receipt.schema -ne 1 -or $receipt.candidate -ine $candidate -or $receipt.sourceVerified -ne $true) { throw 'Invalid repair receipt.' }
 foreach ($flag in @('backupVerified','activationAllowed','startupAllowed','repairApplied')) {
  if ($receipt.$flag -isnot [bool] -or $receipt.$flag) { throw 'Invalid authorization flag.' }
 }
 $manifest=Get-ArsRepairMetadataHash $project 'PILOT-FILES.json'
 $release=Get-ArsRepairMetadataHash $project 'PILOT-RELEASE.json'
 if ($manifest -ine $receipt.manifestSha256 -or $release -ine $receipt.releaseSha256 -or (Get-ArsRepairMetadataHash $candidate 'PILOT-FILES.json') -cne $manifest -or (Get-ArsRepairMetadataHash $candidate 'PILOT-RELEASE.json') -cne $release) { throw 'Repair metadata changed.' }
 $files=Get-Content -LiteralPath (Join-Path $candidate 'PILOT-FILES.json') -Raw | ConvertFrom-Json
 foreach ($record in $files.PSObject.Properties) {
  $name=$record.Name
  if ($name -match '[\\:*?"<>|\x00-\x1f]' -or $name.StartsWith('/') -or $name -match '(^|/)(\.{1,2})(/|$)' -or $name -match '(^|/)[^/]*[. ](/|$)' -or $name.Contains('//')) { throw 'Invalid candidate path.' }
  if ((Get-ArsRepairMetadataHash $candidate $name) -ine $record.Value.sha256) { throw 'Candidate file changed.' }
 }
 if ((Get-ArsRepairMetadataHash $folder 'repair-preparation.json') -cne $receiptHash) { throw 'Repair receipt changed.' }
 [ordered]@{receiptDigest=$receiptHash;manifestDigest=$manifest;releaseDigest=$release}
}
function Test-ArsRepairBackupPlan($plan,[string]$recoveryId) {
 if ($plan.schema -ne 1 -or $plan.recoveryId -cne $recoveryId) { throw 'Recovery identity mismatch.' }
 foreach ($flag in @('runtimeInventoryMatched','recoveryEvidenceMatched','originalDatabaseBindingMatched','preparedDatabaseBindingMatched')) {
  if ($plan.$flag -isnot [bool] -or -not $plan.$flag) { throw 'Backup preflight incomplete.' }
 }
 foreach ($flag in @('runtimeActivated','activationAllowed')) {
  if ($plan.$flag -isnot [bool] -or $plan.$flag) { throw 'Unexpected authorization.' }
 }
}
function Review-ArsRepairBackup([string]$project,[string]$folder,[string]$recoveryId) {
 if ($recoveryId -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{32}$') { throw 'Invalid recovery identifier.' }
 $state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
 $control=Join-Path $state 'desktop-control'
 $mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
 $owned=$false
 try {
  try { $owned=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned=$true; throw 'Interrupted maintenance requires review.' }
  if (-not $owned) { throw 'Another maintenance operation is active.' }
  Assert-ArsPlainPath $control
  $markers=@('runtime-activation-interrupted.json','runtime-switch-intent.json','runtime-migration-interrupted.json','handoff-pending.json','switch-journal.json')
  if (@(Get-ChildItem -LiteralPath $control -Force | Where-Object Name -in $markers).Count) { throw 'Unresolved maintenance evidence.' }
  $before=Get-ArsRepairReviewBinding $project $state $folder
  $helper=Join-Path $project 'scripts/plan-windows-runtime-activation.ps1'
  Assert-ArsPlainPath $helper
  $recovery=Join-Path (Join-Path $state 'update-recovery') $recoveryId
  $evidence=[ordered]@{}
  foreach ($name in @('recovery.json','rollback-compatibility-rehearsal.json')) { $evidence[$name]=Get-ArsRepairMetadataHash $recovery $name }
  $plan=(@(& $helper -RecoveryId $recoveryId) -join [Environment]::NewLine) | ConvertFrom-Json
  Test-ArsRepairBackupPlan $plan $recoveryId
  $again=Get-ArsRepairReviewBinding $project $state $folder
  if (($before | ConvertTo-Json -Compress) -cne ($again | ConvertTo-Json -Compress)) { throw 'Repair evidence changed.' }
  foreach ($name in $evidence.Keys) { if ((Get-ArsRepairMetadataHash $recovery $name) -cne $evidence[$name]) { throw 'Recovery evidence changed.' } }
  $record=[ordered]@{schema=1;kind='windows-repair-backup-observation';binding=$before;recoveryId=$recoveryId;evidence=$evidence;backupEvidenceMatched=$true;repairCandidateRestoreTested=$false;continuousExclusionVerified=$false;activationAllowed=$false;startupAllowed=$false;repairApplied=$false}
  $stream=[IO.File]::Open((Join-Path $folder 'backup-observation.json'),[IO.FileMode]::CreateNew)
  try {
   $bytes=[Text.Encoding]::UTF8.GetBytes(($record | ConvertTo-Json -Depth 6))
   $stream.Write($bytes,0,$bytes.Length)
   $stream.Flush($true)
  } finally { $stream.Dispose() }
 } finally {
  if ($owned) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
 }
}
