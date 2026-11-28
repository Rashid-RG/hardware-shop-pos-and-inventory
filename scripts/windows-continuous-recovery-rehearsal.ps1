# Internal opt-in continuous recovery rehearsal. Not wired into the GUI.
# Never removes software, restarts POS or restores the live database.
. (Join-Path $PSScriptRoot 'windows-continuous-recovery-preparation.ps1')
function Invoke-ArsContinuousRecoveryRehearsal([string]$project,[string]$confirmation) {
 $ErrorActionPreference='Stop'
 if ($confirmation -cne 'STOP POS FOR UNINSTALL BACKUP') {throw 'Explicit shutdown approval required.'}
 $root=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
 if ($project -ine $root -or $env:LOCALAPPDATA -ine ([Environment]::GetFolderPath('LocalApplicationData'))) {throw 'Managed installation required.'}
 $state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
 $control=Join-Path $state 'desktop-control'
 $entry=Join-Path $PSScriptRoot 'windows-continuous-recovery-entry.mjs'
 foreach ($p in @($root,$state,$control,$entry,(Join-Path $root 'uploads'))) {Assert-ArsPlainPath $p}
 foreach ($key in @('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','ARS_RUNTIME_ROOT')) {
  if ($null -ne [Environment]::GetEnvironmentVariable($key,'Process')) {throw 'Unsupported runtime override.'}
 }
 # Stop only after explicit confirmation; the stop routine owns its launcher mutex.
 & (Join-Path $PSScriptRoot 'stop-local.ps1') -Maintenance -UninstallPreparation -UninstallConfirmation $confirmation|Out-Null
 $prepared=Initialize-ArsContinuousRecovery $root
 if ($prepared.schema -ne 1 -or $prepared.kind -cne 'windows-continuous-recovery-preparation' -or $prepared.uninstallId -cnotmatch '^[a-f0-9]{32}$' -or $prepared.destination -ine (Join-Path (Join-Path $state 'uninstall-recovery') $prepared.uninstallId) -or $prepared.holdDigest -cnotmatch '^[A-F0-9]{64}$' -or $prepared.shutdownDigest -cnotmatch '^[A-F0-9]{64}$' -or $prepared.uploadsDigest -notmatch '^[a-f0-9]{64}$') {throw 'Invalid recovery preparation.'}
 foreach ($flag in @('applicationRemovalAllowed','databaseDeletionAllowed','activationAllowed','continuousExclusionVerified')) {
  if ($prepared[$flag] -isnot [bool] -or $prepared[$flag]) {throw 'Unexpected preparation authorization.'}
 }
 $holdPath=Join-Path $control 'maintenance.json'
 $proofPath=Join-Path $control 'maintenance-shutdown.json'
 function Assert-RecoveryPreparationUnchanged {
  foreach ($p in @($holdPath,$proofPath,$prepared.destination,(Join-Path $root 'uploads'))) {Assert-ArsPlainPath $p}
  if ((Get-FileHash -LiteralPath $holdPath -Algorithm SHA256).Hash -cne $prepared.holdDigest -or (Get-FileHash -LiteralPath $proofPath -Algorithm SHA256).Hash -cne $prepared.shutdownDigest -or (Get-ArsPreparedFingerprint (Join-Path $root 'uploads')).digest -cne $prepared.uploadsDigest -or (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {throw 'Prepared shutdown or uploads changed.'}
 }
 Assert-RecoveryPreparationUnchanged
 # No parent launcher mutex: the native restore worker must acquire its own.
 $lines=@(& node $entry $prepared.destination $prepared.holdDigest $prepared.shutdownDigest)
 if ($LASTEXITCODE -ne 0 -or $lines.Count -ne 1 -or $lines[0] -isnot [string] -or -not $lines[0].StartsWith('ARS_RECOVERY=')) {throw 'Continuous recovery failed; evidence retained.'}
 $result=$lines[0].Substring(13)|ConvertFrom-Json
 if ($result.uninstallId -cne $prepared.uninstallId -or $result.database -cnotin @('hardware_pos','hardware_pos_ars') -or $result.restoreObservationDigest -cnotmatch '^[a-f0-9]{64}$' -or $result.finalReviewMatched -isnot [bool] -or -not $result.finalReviewMatched -or $result.sharedProtectionScopeObserved -isnot [bool] -or -not $result.sharedProtectionScopeObserved) {throw 'Invalid continuous recovery result.'}
 foreach ($flag in @('applicationRemovalAllowed','databaseDeletionAllowed','serviceRemovalAllowed','activationAllowed','uninstalled','finalUninstallBackupVerified','continuousExclusionVerified')) {
  if ($result.$flag -isnot [bool] -or $result.$flag) {throw 'Unexpected recovery authorization.'}
 }
 Assert-RecoveryPreparationUnchanged
 return $result
}
