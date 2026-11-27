# Pure final restore evidence comparison. Never authorizes removal or startup.
. (Join-Path $PSScriptRoot 'windows-uninstall-backup-preparation.ps1')
function Assert-ArsFinalReviewDigests($current,$recorded,[string[]]$names,[string]$pattern) {
 if ($current -isnot [System.Collections.IDictionary] -or $current.Count -ne $names.Count -or @($recorded.PSObject.Properties.Name).Count -ne $names.Count) {throw 'Incomplete evidence.'}
 foreach ($name in $names) {
  if ($name -cnotin @($current.Keys) -or $name -cnotin @($recorded.PSObject.Properties.Name) -or $current[$name] -isnot [string] -or $current[$name] -cnotmatch $pattern -or $recorded.$name -cne $current[$name]) {throw 'Recovery evidence mismatch.'}
 }
}
function New-ArsFinalUninstallEvidenceReview($observation,[string]$id,[string]$archive,$evidence,$members) {
 if ($id -cnotmatch '^[a-f0-9]{32}$' -or $observation.schema -ne 1 -or $observation.kind -cne 'windows-uninstall-restore-observation' -or $observation.uninstallId -cne $id) {throw 'Restore observation identity mismatch.'}
 $flags=@('applicationRemovalAllowed','databaseDeletionAllowed','serviceRemovalAllowed','uninstalled','finalUninstallBackupVerified','continuousExclusionVerified')
 foreach ($flag in $flags) {if ($observation.$flag -isnot [bool] -or $observation.$flag) {throw 'Unexpected authorization.'}}
 foreach ($flag in @('isolatedRestorePassed','allPublicTableFingerprintsMatched','uploadArchiveReadable')) {if ($observation.$flag -isnot [bool] -or -not $observation.$flag) {throw 'Incomplete restore observation.'}}
 foreach ($key in @('restoredTableCount','uploadMemberCount')) {if (($observation.$key -isnot [int] -and $observation.$key -isnot [long]) -or $observation.$key -lt 0) {throw 'Invalid restore count.'}}
 if ($observation.restoredTableCount -lt 5 -or [IO.Path]::GetFileName($archive) -cne $archive) {throw 'Incomplete restore evidence.'}
 $names=@(Get-ArsUninstallArchiveMembers $archive | ForEach-Object {[IO.Path]::GetFileName($_)})+@('uninstall-table-manifest.json')
 Assert-ArsFinalReviewDigests $evidence $observation.evidenceDigests @('hold','proof','meta') '^[A-F0-9]{64}$'
 Assert-ArsFinalReviewDigests $members $observation.archiveMemberDigests $names '^[a-f0-9]{64}$'
 if ($observation.archiveSha256 -cne $members[$archive]) {throw 'Archive digest mismatch.'}
 $result=[ordered]@{schema=1;kind='windows-final-uninstall-evidence-review';uninstallId=$id;restoreObservationMatched=$true;evidenceDigests=$evidence;archiveMemberDigests=$members}
 foreach ($flag in $flags) {$result[$flag]=$false}
 return $result
}
