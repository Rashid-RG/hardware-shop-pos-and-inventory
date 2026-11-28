$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-uninstall-backup-preparation.ps1')
$hold=[pscustomobject]@{schema=1;purpose='pre-uninstall backup';project='C:\fixture';uninstallId=('a'*32);applicationRemovalAllowed=$false;shutdownVerified=$false;pid=123;startedUtc='123';requestedAt='fixture'}
$proof=$hold.PSObject.Copy()
$proof.shutdownVerified=$true
Assert-ArsUninstallHold $hold $proof 'C:\fixture'
$proof.applicationRemovalAllowed=$true
$blocked=$false
try {Assert-ArsUninstallHold $hold $proof 'C:\fixture'} catch {$blocked=$true}
if (-not $blocked) {throw 'Unsafe hold accepted.'}
$archive='C:\fixture\ars-hardware_pos-20261127-120000-123-'+('a'*32)+'-with-uploads.dump'
if (@(Get-ArsUninstallArchiveMembers $archive).Count -ne 4) {throw 'Incomplete archive members.'}
$blocked=$false
try {Get-ArsUninstallArchiveMembers ($archive.Replace('with-uploads','database-only'))|Out-Null} catch {$blocked=$true}
if (-not $blocked) {throw 'Database-only archive accepted.'}

$manifest=[pscustomobject]@{uninstallId=('a'*32);holdDigest=('B'*64);shutdownDigest=('C'*64);continuousExclusionVerified=$false}
Assert-ArsUninstallManifestBinding $manifest ('a'*32) ('B'*64) ('C'*64)
foreach ($key in @('uninstallId','holdDigest','shutdownDigest','continuousExclusionVerified')) {
 $old=$manifest.$key
 $manifest.$key=$null
 $blocked=$false
 try {Assert-ArsUninstallManifestBinding $manifest ('a'*32) ('B'*64) ('C'*64)} catch {$blocked=$true}
 if (-not $blocked) {throw "Missing manifest binding accepted: $key"}
 $manifest.$key=$old
}
$manifest.shutdownDigest=('D'*64)
$blocked=$false
try {Assert-ArsUninstallManifestBinding $manifest ('a'*32) ('B'*64) ('C'*64)} catch {$blocked=$true}
if (-not $blocked) {throw 'Different shutdown evidence accepted.'}
