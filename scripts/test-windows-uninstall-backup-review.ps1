$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-uninstall-backup-review.ps1')
$id='1.0.0-'+('a'*32)
$plan=[pscustomobject]@{schema=1;recoveryId=$id;runtimeInventoryMatched=$true;recoveryEvidenceMatched=$true;originalDatabaseBindingMatched=$true;preparedDatabaseBindingMatched=$true;runtimeActivated=$false;activationAllowed=$false}
$hashes=[ordered]@{'recovery.json'=('b'*64);'rollback-compatibility-rehearsal.json'=('c'*64)}
$result=New-ArsUninstallBackupReview $plan 'C:\fixture' $id $hashes
if ($result.protectedUpdateBackupMatched -ne $true) { throw 'Protected backup review missing.' }
foreach ($flag in @('finalUninstallBackupVerified','continuousExclusionVerified','applicationRemovalAllowed','serviceRemovalAllowed','databaseDeletionAllowed','uninstalled')) {
 if ($result[$flag] -isnot [bool] -or $result[$flag]) { throw 'Unsafe uninstall authorization.' }
}
foreach ($flag in @('recoveryEvidenceMatched','originalDatabaseBindingMatched','activationAllowed')) {
 $old=$plan.$flag
 $plan.$flag=-not $old
 $blocked=$false
 try {New-ArsUninstallBackupReview $plan 'C:\fixture' $id $hashes|Out-Null} catch {$blocked=$true}
 if (-not $blocked) {throw "Unsafe backup review accepted: $flag"}
 $plan.$flag=$old
}
$hashes.Remove('rollback-compatibility-rehearsal.json')
$blocked=$false
try {New-ArsUninstallBackupReview $plan 'C:\fixture' $id $hashes|Out-Null} catch {$blocked=$true}
if (-not $blocked) {throw 'Incomplete evidence accepted.'}
