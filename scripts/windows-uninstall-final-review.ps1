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

function Get-ArsFinalUninstallEvidenceReview([string]$project,[string]$folder) {
 $ErrorActionPreference='Stop'
 $state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
 $control=Join-Path $state 'desktop-control'
 $id=Split-Path -Leaf $folder
 if ($id -cnotmatch '^[a-f0-9]{32}$' -or (Split-Path -Parent $folder) -ine (Join-Path $state 'uninstall-recovery') -or [IO.Path]::GetFullPath($folder) -ine $folder -or [IO.Path]::GetFullPath($project) -ine $project) {throw 'Managed recovery directory required.'}
 $mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
 $owned=$false
 try {
  try {$owned=$mutex.WaitOne(0)} catch [System.Threading.AbandonedMutexException] {$owned=$true;throw 'Interrupted maintenance requires review.'}
  if (-not $owned) {throw 'Maintenance active.'}
  foreach ($key in @('ARS_RUNTIME_ROOT','DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH')) {
   if ([Environment]::GetEnvironmentVariable($key,'Process')) {throw 'Unsupported runtime override.'}
  }
  $markers=@('instance.json','repair-interrupted.json','runtime-switch-intent.json','runtime-switch-journal.json','runtime-active.json','activation.json','handoff-pending.json','runtime-activation-interrupted.json','runtime-migration-interrupted.json','switch-journal.json')
  $paths=[ordered]@{hold=(Join-Path $control 'maintenance.json');proof=(Join-Path $control 'maintenance-shutdown.json');meta=(Join-Path $folder 'recovery.json');restore=(Join-Path $folder 'uninstall-restore-test.json')}
  function Read-ReviewSnapshot {
   foreach ($p in @($project,$state,$control,$folder)) {Assert-ArsPlainPath $p}
   if (@(Get-ChildItem -LiteralPath $control -Force|Where-Object Name -in $markers).Count -or (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {throw 'Application or incident active.'}
   $raw=[ordered]@{};$digests=[ordered]@{}
   foreach ($key in $paths.Keys) {
    $p=$paths[$key];Assert-ArsPlainPath $p
    $item=Get-Item -LiteralPath $p
    if ($item.PSIsContainer -or $item.Length -lt 1 -or $item.Length -gt 65536) {throw 'Invalid evidence file.'}
    $before=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash
    $raw[$key]=Get-Content -LiteralPath $p -Raw -Encoding UTF8|ConvertFrom-Json
    if ((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash -cne $before) {throw 'Evidence changed.'}
    $digests[$key]=$before
   }
   Assert-ArsUninstallHold $raw.hold $raw.proof $project
   foreach ($record in @($raw.hold,$raw.proof)) {
    foreach ($flag in @('activationApproved','databaseDeletionAllowed')) {if ($record.$flag -isnot [bool] -or $record.$flag) {throw 'Unexpected authorization.'}}
   }
   if ($raw.hold.pid -lt 1 -or $raw.hold.startedUtc -cnotmatch '^[0-9]{1,19}$') {throw 'Invalid process evidence.'}
   $old=Get-Process -Id ([int]$raw.hold.pid) -ErrorAction SilentlyContinue
   if ($old -and $old.StartTime.ToUniversalTime().Ticks.ToString() -ceq $raw.hold.startedUtc) {throw 'Original application remains active.'}
   $meta=$raw.meta
   if ($meta.schema -ne 1 -or $meta.kind -cne 'windows-final-uninstall-backup' -or $meta.uninstallId -cne $id -or $raw.hold.uninstallId -cne $id -or $meta.previousProject -ine $project -or $meta.holdDigest -cne $digests.hold -or $meta.shutdownDigest -cne $digests.proof) {throw 'Recovery identity mismatch.'}
   foreach ($flag in @('restoreTestPassed','finalUninstallBackupVerified','applicationRemovalAllowed','databaseDeletionAllowed','continuousExclusionVerified')) {if ($meta.$flag -isnot [bool] -or $meta.$flag) {throw 'Unexpected authorization.'}}
   if ($meta.archive -cnotmatch '^ars-hardware_pos(?:_ars)?-[0-9]{8}-[0-9]{6}-[0-9]{3}-[a-f0-9]{32}-with-uploads\.dump$') {throw 'Invalid archive name.'}
   $archive=Join-Path $folder $meta.archive
   $manifestPath=Join-Path $folder 'uninstall-table-manifest.json'
   $hashes=[ordered]@{}
   foreach ($p in (@(Get-ArsUninstallArchiveMembers $archive)+@($manifestPath))) {
    Assert-ArsPlainPath $p
    if ((Get-Item -LiteralPath $p).PSIsContainer) {throw 'Invalid archive member.'}
    $name=[IO.Path]::GetFileName($p)
    $hashes[$name]=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hashes[$name] -cne $meta.archiveDigests.$name) {throw 'Archive member changed.'}
   }
   if ((Get-Item -LiteralPath $manifestPath).Length -gt 16777216) {throw 'Manifest too large.'}
   $manifest=Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8|ConvertFrom-Json
   Assert-ArsUninstallManifestBinding $manifest $id $digests.hold $digests.proof
   if ($manifest.schema -ne 1 -or $manifest.kind -cne 'windows-uninstall-table-manifest' -or $manifest.archive -cne $meta.archive -or $manifest.dumpSha256 -cne $hashes[$meta.archive] -or $manifest.locksObserved -isnot [bool] -or -not $manifest.locksObserved -or $manifest.applicationRemovalAllowed -isnot [bool] -or $manifest.applicationRemovalAllowed) {throw 'Invalid protected manifest.'}
   $evidence=[ordered]@{hold=$digests.hold;proof=$digests.proof;meta=$digests.meta}
   $plan=New-ArsFinalUninstallEvidenceReview $raw.restore $id $meta.archive $evidence $hashes
   $plan['restoreObservationDigest']=$digests.restore
   return $plan
  }
  $first=Read-ReviewSnapshot
  $second=Read-ReviewSnapshot
  if (($first|ConvertTo-Json -Depth 8 -Compress) -cne ($second|ConvertTo-Json -Depth 8 -Compress)) {throw 'Recovery evidence changed during review.'}
  return $first
 } finally {
  if ($owned) {$mutex.ReleaseMutex()}
  $mutex.Dispose()
 }
}
