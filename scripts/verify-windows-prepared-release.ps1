param([Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
if ($Version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid release version.' }
$root = Join-Path (Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor\prepared-releases') $Version
$result = Assert-ArsPreparedFingerprint $root
Write-Host "Local prepared fingerprint matches ($($result.files) files). This does not authorize activation."
