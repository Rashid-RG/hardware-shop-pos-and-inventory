$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-repair-readiness.ps1')
$binding=[ordered]@{receiptDigest='a';manifestDigest='b';releaseDigest='c'}
$backup=[pscustomobject]@{schema=1;kind='windows-repair-backup-observation';backupEvidenceMatched=$true;repairCandidateRestoreTested=$false;binding=[pscustomobject]$binding;recoveryId='test';activationAllowed=$false;startupAllowed=$false;repairApplied=$false}
$test=[pscustomobject]@{schema=1;kind='windows-isolated-repair-restore-test';repairBinding=[pscustomobject]$binding;recoveryId='test';dependencyImageId=('sha256:'+('a'*64));offlineRestorePassed=$true;candidateStartupPassed=$true;authenticatedReadsPassed=$true;authenticatedWritesPassed=$true;historicalRowsCompared=$true;backwardStartupPassed=$true;backwardReadsPassed=$true;backwardWritesPassed=$true;repairSpecificBackwardTested=$true;previousBuildDigest=('b'*64);previousDependencyImageId=('sha256:'+('c'*64));activationApproved=$false;continuousExclusionVerified=$false;activationAllowed=$false;startupAllowed=$false;repairApplied=$false}
$completion=[pscustomobject]@{schema=1;kind='windows-repair-rehearsal-observation';backupObservationDigest='backup';testReceiptDigest='test';activationAllowed=$false;startupAllowed=$false;repairApplied=$false}
Assert-ArsRepairReadinessReceipts $binding $backup $test $completion 'backup' 'test'
foreach ($flag in @('authenticatedWritesPassed','activationAllowed','backwardStartupPassed','backwardReadsPassed','backwardWritesPassed','repairSpecificBackwardTested')) {
 $old=$test.$flag
 $test.$flag=-not $old
 $blocked=$false
 try { Assert-ArsRepairReadinessReceipts $binding $backup $test $completion 'backup' 'test' } catch { $blocked=$true }
 if (-not $blocked) { throw "Unsafe receipt accepted: $flag" }
 $test.$flag=$old
}
$blocked=$false
try { Assert-ArsRepairReadinessReceipts $binding $backup $test $completion 'backup' 'changed' } catch { $blocked=$true }
if (-not $blocked) { throw 'Altered receipt accepted.' }
