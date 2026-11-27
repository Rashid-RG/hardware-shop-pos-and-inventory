$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-repair-activation-plan.ps1')
$r=[ordered]@{schema=1;kind='windows-repair-rollback-preparation';repairSpecificRollbackTested=$true;continuousExclusionVerified=$false;activationAllowed=$false;startupAllowed=$false;repairApplied=$false;rollbackAllowed=$false;archiveSha256=('a'*64);repairEvidenceDigests=[ordered]@{test='b';backup='c'}}
$record=($r|ConvertTo-Json -Depth 8)|ConvertFrom-Json
$folder='repair-preparation-'+('c'*32)
$plan=New-ArsRepairActivationPlan $record $r ('d'*64) $folder
foreach ($flag in @('activationAllowed','startupAllowed','repairApplied','rollbackAllowed','continuousExclusionVerified','fileSwitchAllowed','nativeHostRepairCertified')) {
 if ($plan[$flag] -isnot [bool] -or $plan[$flag]) { throw 'Unsafe activation plan.' }
}
$record.archiveSha256='e'*64
$blocked=$false
try { New-ArsRepairActivationPlan $record $r ('d'*64) $folder } catch {$blocked=$true}
if (-not $blocked) { throw 'Stale rollback accepted.' }
$r.activationAllowed=$true
$blocked=$false
try { New-ArsRepairActivationPlan $r $r ('d'*64) $folder } catch {$blocked=$true}
if (-not $blocked) { throw 'Authorizing rollback accepted.' }
