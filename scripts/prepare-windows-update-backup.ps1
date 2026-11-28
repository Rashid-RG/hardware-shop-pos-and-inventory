# Retain a preflight recovery snapshot. Does not authorize activation.
param([Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
if ($Version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid release version.' }
$state=Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor'
$prepared=Join-Path (Join-Path $state 'prepared-releases') $Version
$fingerprint=Assert-ArsPreparedFingerprint $prepared
$root=Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $root '.env.local') -PathType Leaf)) { throw 'Operational configuration missing.' }
$answer=Read-Host 'Type BACKUP to create a retained preflight recovery archive'
if ($answer -cne 'BACKUP') { return }
$recovery=Join-Path $state 'update-recovery'
New-Item -ItemType Directory -Path $recovery -Force | Out-Null
$id=[guid]::NewGuid().ToString('N')
$pending=Join-Path $recovery ('.pending-'+$id)
$target=Join-Path $recovery ($Version+'-'+$id)
New-Item -ItemType Directory -Path $pending | Out-Null
try {
  $result=@(& (Join-Path $PSScriptRoot 'backup-local-postgres.ps1') -Destination $pending -OutputArchive)
  $paths=@($result | Where-Object { $_ -is [string] -and $_.StartsWith('ARS_ARCHIVE=') })
  if ($paths.Count -ne 1) { throw 'Backup did not return exactly one archive.' }
  $archive=$paths[0].Substring(12)
  if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($archive)) -ine [IO.Path]::GetFullPath($pending) -or [IO.Path]::GetExtension($archive) -cne '.dump') { throw 'Unexpected backup location.' }
  & node (Join-Path $root 'scripts/verify-backup.mjs') $archive
  if ($LASTEXITCODE -ne 0) { throw 'Backup verification failed.' }
  $current=Assert-ArsPreparedFingerprint $prepared
  if ($current.digest -cne $fingerprint.digest) { throw 'Prepared release changed during backup.' }
  $metadata=[ordered]@{schema=1;version=$Version;previousProject=$root;preparedDigest=$fingerprint.digest;archive=[IO.Path]::GetFileName($archive);createdAt=[DateTime]::UtcNow.ToString('o');activationApproved=$false;restoreTestPassed=$false;quiesced=$false;note='Online preflight only. Fresh quiesced backup and compatibility rehearsal required.'}
  $metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $pending 'recovery.json') -Encoding UTF8
  [IO.Directory]::Move($pending,$target)
  Write-Host "Retained preflight backup: $target"
  Write-Host 'No activation or restore was performed. Protect this unencrypted recovery archive.'
} finally {
  # Preserve any successful dump if subsequent checks fail; never publish it as approved.
  if (Test-Path -LiteralPath $pending) { Write-Warning "Incomplete preparation retained at $pending; not valid for activation." }
}
