$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-repair-rollback-preparation.ps1')
$digest='a'*64
$archive='b'*64
$id='1.0.0-'+('c'*32)
$r=[pscustomobject]@{schema=1;recoveryId=$id;archiveSha256=$archive;previousBuildDigest=$digest;previousDependencyImageId=('sha256:'+('d'*64));offlineRestorePassed=$true;candidateStartupPassed=$true;authenticatedReadsPassed=$true;authenticatedWritesPassed=$true;historicalRowsCompared=$true;backwardStartupPassed=$true;backwardReadsPassed=$true;backwardWritesPassed=$true;activationApproved=$false}
Assert-ArsPreviousRepairBuild $r $digest $archive $id
foreach ($key in @('backwardWritesPassed','activationApproved','previousBuildDigest','archiveSha256')) {
 $old=$r.$key
 if ($old -is [bool]) {$r.$key=-not $old} else {$r.$key='e'*64}
 $blocked=$false
 try { Assert-ArsPreviousRepairBuild $r $digest $archive $id } catch {$blocked=$true}
 if (-not $blocked) { throw "Invalid rollback receipt accepted: $key" }
 $r.$key=$old
}
