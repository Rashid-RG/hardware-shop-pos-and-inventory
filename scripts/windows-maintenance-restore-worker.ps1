# Internal native-supervised isolated restoration stage. No live restore or activation.
param(
 [Parameter(Mandatory=$true)][string]$RecoveryFolder,
 [Parameter(Mandatory=$true)][ValidateSet('hardware_pos','hardware_pos_ars')][string]$SourceDatabase
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-uninstall-restore.ps1')
$project=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if (-not [IO.Path]::IsPathRooted($RecoveryFolder)) {throw 'Absolute recovery folder required.'}
$state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
$folder=[IO.Path]::GetFullPath($RecoveryFolder)
$id=Split-Path -Leaf $folder
if ($id -cnotmatch '^[a-f0-9]{32}$' -or (Split-Path -Parent $folder) -ine (Join-Path $state 'uninstall-recovery')) {throw 'Managed recovery folder required.'}
foreach ($p in @($project,$state,$folder,(Join-Path $folder 'recovery.json'))) {Assert-ArsPlainPath $p}
$metaPath=Join-Path $folder 'recovery.json'
$item=Get-Item -LiteralPath $metaPath
if ($item.PSIsContainer -or $item.Length -lt 1 -or $item.Length -gt 65536) {throw 'Invalid recovery metadata.'}
$meta=Get-Content -LiteralPath $metaPath -Raw -Encoding UTF8|ConvertFrom-Json
if ($meta.sourceDatabase -cne $SourceDatabase -or $meta.uninstallId -cne $id -or $meta.previousProject -ine $project) {throw 'Protected restore source identity mismatch.'}
Assert-ArsUninstallSourceDatabase $SourceDatabase $meta.archive
# The existing restore routine checks shutdown, hashes, isolation and table fingerprints.
# Its exclusive observation file is independently reviewed by the parent.
$result=Test-ArsUninstallRestore $project $folder
if ($result.uninstallId -cne $id -or $result.isolatedRestorePassed -isnot [bool] -or -not $result.isolatedRestorePassed) {throw 'Isolated restore observation missing.'}
foreach ($flag in @('applicationRemovalAllowed','databaseDeletionAllowed','serviceRemovalAllowed','continuousExclusionVerified','uninstalled','finalUninstallBackupVerified')) {
 if ($result[$flag] -isnot [bool] -or $result[$flag]) {throw 'Unexpected restore authorization.'}
}
