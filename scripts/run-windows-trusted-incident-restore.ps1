# Run from a known-good tools installation with its independently configured release key.
param(
  [Parameter(Mandatory=$true)][string]$Project,
  [Parameter(Mandatory=$true)][string]$Runtime,
  [Parameter(Mandatory=$true)][string]$Confirmation
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-publisher-source.ps1')
$state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
Invoke-ArsTrustedIncidentRestore $Project $Runtime (Join-Path $state 'release-signing-public.pem') $Confirmation
