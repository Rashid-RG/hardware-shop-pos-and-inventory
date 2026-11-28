param(
 [Parameter(Mandatory=$true)][string]$FixtureHome,
 [Parameter(Mandatory=$true)][string]$RepairName,
 [Parameter(Mandatory=$true)][ValidateSet('begin','review')][string]$Action,
 [Parameter(Mandatory=$true)][string]$Digest
)
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:LOCALAPPDATA -cne $FixtureHome -or (Split-Path -Leaf $FixtureHome) -cnotmatch '^ars-repair-ci-[A-Za-z0-9]+$' -or $RepairName -cnotmatch '^repair-preparation-[a-f0-9]{32}$') { throw 'Disposable Windows fixture required.' }
. (Join-Path $PSScriptRoot 'windows-repair-interruption.ps1')
Assert-ArsPlainPath $FixtureHome
$state=Join-Path $FixtureHome 'RS Nextward\ARS Distributor'
$control=Join-Path $state 'desktop-control'
if ($Action -eq 'begin') {
 $record=New-ArsRepairInterruptionRecord $RepairName $Digest
 Write-ArsRepairInterruption $control $record
}
$review=Read-ArsRepairInterruptionReview $state
if ($review.markerRetained -ne $true -or $review.rollbackReceiptMatched -ne $true -or $review.startupAllowed -ne $false -or $review.recoveryAllowed -ne $false) { throw 'Unsafe interruption review.' }
