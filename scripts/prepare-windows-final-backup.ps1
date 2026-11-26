# Retain a maintenance-gated snapshot. Never authorize release activation.
param([Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
if ($Version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid release version.' }
$state=Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor'
$control=Join-Path $state 'desktop-control'
$root=Split-Path -Parent $PSScriptRoot
$prepared=Join-Path (Join-Path $state 'prepared-releases') $Version
$marker=Join-Path $control 'maintenance.json'
$proof=Join-Path $control 'maintenance-shutdown.json'
function Assert-Maintenance {
  foreach ($path in @($control,$marker,$proof)) {
    $item=Get-Item -LiteralPath $path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected maintenance reparse point.' }
  }
  $m=Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
  $v=Get-Content -LiteralPath $proof -Raw | ConvertFrom-Json
  if ($m.schema -ne 1 -or $v.schema -ne 1 -or $m.project -ine $root -or $v.project -ine $root -or $m.pid -ne $v.pid -or $m.startedUtc -cne $v.startedUtc -or $m.requestedAt -cne $v.requestedAt -or $m.shutdownVerified -ne $false -or $v.shutdownVerified -ne $true -or $m.activationApproved -ne $false -or $v.activationApproved -ne $false) { throw 'Matching verified maintenance shutdown evidence required.' }
  if (Test-Path -LiteralPath (Join-Path $control 'instance.json')) { throw 'Managed application instance record remains.' }
  if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { throw 'Application listener exists; final backup blocked.' }
  $old=Get-Process -Id ([int]$m.pid) -ErrorAction SilentlyContinue
  if ($old -and $old.StartTime.ToUniversalTime().Ticks.ToString() -ceq $m.startedUtc) { throw 'Previous application process remains active.' }
  return ((Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash+':'+(Get-FileHash -LiteralPath $proof -Algorithm SHA256).Hash)
}
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
$pending=$null
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another startup or maintenance operation is active.' }
  $maintenanceDigest=Assert-Maintenance
  $fingerprint=Assert-ArsPreparedFingerprint $prepared
  $envPath=Join-Path $root '.env.local'
  $envHash=(Get-FileHash -LiteralPath $envPath -Algorithm SHA256).Hash
  if ((Read-Host 'Type FINAL BACKUP after confirming no other database clients are writing') -cne 'FINAL BACKUP') { return }
  $recovery=Join-Path $state 'update-recovery'
  New-Item -ItemType Directory -Path $recovery -Force | Out-Null
  $id=[guid]::NewGuid().ToString('N')
  $pending=Join-Path $recovery ('.pending-final-'+$id)
  $target=Join-Path $recovery ($Version+'-'+$id)
  New-Item -ItemType Directory -Path $pending | Out-Null
  $result=@(& (Join-Path $PSScriptRoot 'backup-local-postgres.ps1') -Destination $pending -OutputArchive)
  $paths=@($result | Where-Object { $_ -is [string] -and $_.StartsWith('ARS_ARCHIVE=') })
  if ($paths.Count -ne 1) { throw 'Backup did not return exactly one archive.' }
  $archive=$paths[0].Substring(12)
  if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($archive)) -ine [IO.Path]::GetFullPath($pending) -or [IO.Path]::GetExtension($archive) -cne '.dump') { throw 'Unexpected archive location.' }
  & node (Join-Path $root 'scripts/verify-backup.mjs') $archive
  if ($LASTEXITCODE -ne 0) { throw 'Archive verification failed.' }
  if ((Assert-Maintenance) -cne $maintenanceDigest) { throw 'Maintenance evidence changed during backup.' }
  if ((Assert-ArsPreparedFingerprint $prepared).digest -cne $fingerprint.digest) { throw 'Prepared release changed during backup.' }
  if ((Get-FileHash -LiteralPath $envPath -Algorithm SHA256).Hash -cne $envHash) { throw 'Operational configuration changed during backup.' }
  $meta=[ordered]@{schema=1;version=$Version;previousProject=$root;preparedDigest=$fingerprint.digest;archive=[IO.Path]::GetFileName($archive);archiveSha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash;createdAt=[DateTime]::UtcNow.ToString('o');maintenanceDigest=$maintenanceDigest;managedShutdownVerified=$true;externalWritersExcluded=$false;quiesced=$false;activationApproved=$false;restoreTestPassed=$false;note='Managed launcher shutdown verified. Other database clients are not independently excluded. Restore and compatibility evidence required.'}
  $meta | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $pending 'recovery.json') -Encoding UTF8
  [IO.Directory]::Move($pending,$target)
  Write-Host "Retained maintenance backup: $target"
  Write-Host 'Maintenance remains active. No release activation approved.'
} finally {
  if ($pending -and (Test-Path -LiteralPath $pending)) { Write-Warning "Incomplete final backup retained at $pending." }
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
