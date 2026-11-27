# Internal staged uninstall rehearsal. No removal, restart or database deletion.
. (Join-Path $PSScriptRoot 'windows-uninstall-restore.ps1')
. (Join-Path $PSScriptRoot 'windows-uninstall-final-review.ps1')
function Invoke-ArsUninstallRehearsal([string]$project,[string]$confirmation) {
 $ErrorActionPreference='Stop'
 if ($confirmation -cne 'STOP POS FOR UNINSTALL BACKUP') {throw 'Explicit shutdown approval required.'}
 $root=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
 if ($project -ine $root) {throw 'Managed installation required.'}
 $state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
 $control=Join-Path $state 'desktop-control'
 foreach ($p in @($project,$state,$control)) {Assert-ArsPlainPath $p}
 if ($env:LOCALAPPDATA -ine ([Environment]::GetFolderPath('LocalApplicationData'))) {throw 'Unexpected local application state.'}
 $holdPath=Join-Path $control 'maintenance.json'
 $proofPath=Join-Path $control 'maintenance-shutdown.json'
 # Each stage acquires and releases its own launcher mutex.
 # This is not continuous database writer exclusion certification.
 & (Join-Path $PSScriptRoot 'stop-local.ps1') -Maintenance -UninstallPreparation -UninstallConfirmation $confirmation
 foreach ($p in @($holdPath,$proofPath)) {
  Assert-ArsPlainPath $p
  $item=Get-Item -LiteralPath $p
  if ($item.PSIsContainer -or $item.Length -lt 1 -or $item.Length -gt 65536) {throw 'Invalid shutdown evidence.'}
 }
 $holdDigest=(Get-FileHash -LiteralPath $holdPath -Algorithm SHA256).Hash
 $proofDigest=(Get-FileHash -LiteralPath $proofPath -Algorithm SHA256).Hash
 $hold=Get-Content -LiteralPath $holdPath -Raw -Encoding UTF8|ConvertFrom-Json
 $proof=Get-Content -LiteralPath $proofPath -Raw -Encoding UTF8|ConvertFrom-Json
 Assert-ArsUninstallHold $hold $proof $project
 $id=$hold.uninstallId
 function Assert-RehearsalHold {
  foreach ($p in @($holdPath,$proofPath)) {Assert-ArsPlainPath $p}
  if ((Get-FileHash -LiteralPath $holdPath -Algorithm SHA256).Hash -cne $holdDigest -or (Get-FileHash -LiteralPath $proofPath -Algorithm SHA256).Hash -cne $proofDigest -or (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {throw 'Shutdown evidence changed.'}
 }
 Assert-RehearsalHold
 $folder=Prepare-ArsUninstallBackup $project
 if ($folder -ine (Join-Path (Join-Path $state 'uninstall-recovery') $id)) {throw 'Unexpected recovery identity.'}
 Assert-RehearsalHold
 $observation=Test-ArsUninstallRestore $project $folder
 if ($observation.uninstallId -cne $id -or $observation.isolatedRestorePassed -isnot [bool] -or -not $observation.isolatedRestorePassed) {throw 'Restore observation mismatch.'}
 Assert-RehearsalHold
 $plan=Get-ArsFinalUninstallEvidenceReview $project $folder
 if ($plan.uninstallId -cne $id -or $plan.restoreObservationMatched -isnot [bool] -or -not $plan.restoreObservationMatched) {throw 'Final review mismatch.'}
 $flags=@('applicationRemovalAllowed','databaseDeletionAllowed','serviceRemovalAllowed','uninstalled','finalUninstallBackupVerified','continuousExclusionVerified')
 foreach ($flag in $flags) {if ($plan[$flag] -isnot [bool] -or $plan[$flag]) {throw 'Unexpected authorization.'}}
 Assert-RehearsalHold
 $result=[ordered]@{schema=1;kind='windows-uninstall-coordinator-rehearsal';uninstallId=$id;finalReviewMatched=$true;maintenanceHoldObserved=$true}
 foreach ($flag in $flags) {$result[$flag]=$false}
 return $result
}
# No GUI or CLI entry point until coordinated failure testing is complete.
