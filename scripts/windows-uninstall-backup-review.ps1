# Existing protected update backup review only; no uninstall authorization.
. (Join-Path $PSScriptRoot 'windows-repair-backup-review.ps1')
function New-ArsUninstallBackupReview($plan,[string]$project,[string]$id,$hashes) {
 Test-ArsRepairBackupPlan $plan $id
 if ($id -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{32}$') { throw 'Invalid recovery identifier.' }
 foreach ($name in @('recovery.json','rollback-compatibility-rehearsal.json')) {
  if ($hashes[$name] -cnotmatch '^[a-fA-F0-9]{64}$') { throw 'Incomplete recovery evidence.' }
 }
 [ordered]@{schema=1;kind='windows-uninstall-backup-review';installation=$project;recoveryId=$id;protectedUpdateBackupMatched=$true;evidenceDigests=$hashes;finalUninstallBackupVerified=$false;continuousExclusionVerified=$false;applicationRemovalAllowed=$false;serviceRemovalAllowed=$false;databaseDeletionAllowed=$false;uninstalled=$false}
}
function Get-ArsUninstallBackupReview([string]$project,[string]$folder) {
 $state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
 $control=Join-Path $state 'desktop-control'
 $id=Split-Path -Leaf $folder
 if ((Split-Path -Parent $folder) -ine (Join-Path $state 'update-recovery') -or $id -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{32}$') { throw 'Managed recovery directory required.' }
 $mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
 $owned=$false
 try {
  try { $owned=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned=$true;throw 'Interrupted maintenance requires review.' }
  if (-not $owned) { throw 'Maintenance is active.' }
  foreach ($path in @($project,$state,$control,$folder)) { Assert-ArsPlainPath $path }
  $markers=@('repair-interrupted.json','runtime-switch-intent.json','runtime-switch-journal.json','runtime-active.json','activation.json','runtime-activation-interrupted.json','runtime-migration-interrupted.json','handoff-pending.json','switch-journal.json')
  if (@(Get-ChildItem -LiteralPath $control -Force | Where-Object Name -in $markers).Count) { throw 'Unresolved maintenance incident.' }
  foreach ($key in @('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH')) {
   if ([Environment]::GetEnvironmentVariable($key,'Process')) { throw 'Custom Docker connection unsupported.' }
  }
  $endpoint=@(& docker context inspect --format '{{.Endpoints.docker.Host}}')
  if ($LASTEXITCODE -ne 0 -or $endpoint.Count -ne 1 -or $endpoint[0] -notin @('npipe:////./pipe/docker_engine','npipe:////./pipe/dockerDesktopLinuxEngine')) { throw 'Local Docker engine required.' }
  $hashes=[ordered]@{}
  foreach ($name in @('recovery.json','rollback-compatibility-rehearsal.json')) { $hashes[$name]=Get-ArsRepairMetadataHash $folder $name }
  $helper=Join-Path $project 'scripts/plan-windows-runtime-activation.ps1'
  Assert-ArsPlainPath $helper
  $plan=(@(& $helper -RecoveryId $id) -join [Environment]::NewLine)|ConvertFrom-Json
  $result=New-ArsUninstallBackupReview $plan $project $id $hashes
  $again=(@(& $helper -RecoveryId $id) -join [Environment]::NewLine)|ConvertFrom-Json
  Test-ArsRepairBackupPlan $again $id
  if (($again|ConvertTo-Json -Depth 8 -Compress) -cne ($plan|ConvertTo-Json -Depth 8 -Compress)) { throw 'Recovery plan changed.' }
  foreach ($name in $hashes.Keys) { if ((Get-ArsRepairMetadataHash $folder $name) -cne $hashes[$name]) { throw 'Recovery evidence changed.' } }
  if (@(Get-ChildItem -LiteralPath $control -Force | Where-Object Name -in $markers).Count) { throw 'Maintenance incident detected.' }
  return $result
 } finally {
  if ($owned) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
 }
}
