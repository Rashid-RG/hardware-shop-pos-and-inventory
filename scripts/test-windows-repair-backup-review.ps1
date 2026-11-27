$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-repair-backup-review.ps1')
$id='1.0.0-0123456789abcdef0123456789abcdef'
$plan=[pscustomobject]@{schema=1;recoveryId=$id;runtimeInventoryMatched=$true;recoveryEvidenceMatched=$true;originalDatabaseBindingMatched=$true;preparedDatabaseBindingMatched=$true;runtimeActivated=$false;activationAllowed=$false}
Test-ArsRepairBackupPlan $plan $id
foreach ($flag in @('recoveryEvidenceMatched','originalDatabaseBindingMatched','activationAllowed')) {
 $old=$plan.$flag
 $plan.$flag=-not $old
 $blocked=$false
 try { Test-ArsRepairBackupPlan $plan $id } catch { $blocked=$true }
 if (-not $blocked) { throw "Unsafe backup plan accepted: $flag" }
 $plan.$flag=$old
}
