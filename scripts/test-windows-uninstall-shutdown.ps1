$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-uninstall-shutdown.ps1')
. (Join-Path $PSScriptRoot 'windows-uninstall-backup-preparation.ps1')
$instance=[pscustomobject]@{schema=1;project='C:\fixture';pid=123;startedUtc='123456'}
$hold=New-ArsUninstallShutdownHold 'C:\fixture' $instance 'STOP POS FOR UNINSTALL BACKUP'
$proof=[ordered]@{}
foreach ($key in $hold.Keys) {$proof[$key]=$hold[$key]}
$proof.shutdownVerified=$true
Assert-ArsUninstallHold ([pscustomobject]$hold) ([pscustomobject]$proof) 'C:\fixture'
foreach ($flag in @('activationApproved','applicationRemovalAllowed','databaseDeletionAllowed')) {
 if ($hold[$flag] -isnot [bool] -or $hold[$flag]) {throw 'Unexpected authorization.'}
}
$blocked=$false
try {New-ArsUninstallShutdownHold 'C:\fixture' $instance 'SHUTDOWN'|Out-Null} catch {$blocked=$true}
if (-not $blocked) {throw 'Missing explicit approval accepted.'}
