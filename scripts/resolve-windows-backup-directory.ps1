# Emit only the validated directory, never configuration contents.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-runtime-paths.ps1')
$root=Split-Path -Parent $PSScriptRoot
$runtime=Get-ArsWindowsRuntimeRoot $root
Write-Output ('ARS_BACKUP_DIRECTORY='+(Join-Path $runtime 'backups'))
