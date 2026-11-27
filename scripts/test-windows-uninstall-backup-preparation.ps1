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
