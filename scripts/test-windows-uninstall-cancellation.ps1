$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-uninstall-shutdown.ps1')
. (Join-Path $PSScriptRoot 'windows-uninstall-cancellation.ps1')
$instance=[pscustomobject]@{schema=1;project='C:\fixture';pid=123;startedUtc='123456'}
$hold=New-ArsUninstallShutdownHold 'C:\fixture' $instance 'STOP POS FOR UNINSTALL BACKUP'
$proof=[ordered]@{}
foreach ($key in $hold.Keys) {$proof[$key]=$hold[$key]}
$proof.shutdownVerified=$true
Assert-ArsUninstallCancellation ([pscustomobject]$hold) ([pscustomobject]$proof) 'C:\fixture' 'CANCEL UNINSTALL AND KEEP POS'
foreach ($flag in @('applicationRemovalAllowed','databaseDeletionAllowed','activationApproved')) {
 $proof[$flag]=$true
 $blocked=$false
 try {Assert-ArsUninstallCancellation ([pscustomobject]$hold) ([pscustomobject]$proof) 'C:\fixture' 'CANCEL UNINSTALL AND KEEP POS'} catch {$blocked=$true}
 if (-not $blocked) {throw 'Unexpected authorization accepted.'}
 $proof[$flag]=$false
}
$path=Join-Path ([IO.Path]::GetTempPath()) ('ars-cancel-ci-'+[guid]::NewGuid().ToString('N'))
try {
 Write-ArsCancellationBytes $path ([byte[]]@(1,2,3))
 $blocked=$false
 try {Write-ArsCancellationBytes $path ([byte[]]@(4))} catch {$blocked=$true}
 if (-not $blocked -or ([IO.File]::ReadAllBytes($path) -join ',') -cne '1,2,3') {throw 'Existing cancellation evidence not preserved.'}
} finally {if ([IO.File]::Exists($path)) {[IO.File]::Delete($path)}}
