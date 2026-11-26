# Restore a retained preflight archive into a new test database; never switch the active database.
param([Parameter(Mandatory=$true)][string]$RecoveryId)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
if ($RecoveryId -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{32}$') { throw 'Invalid recovery identifier.' }
$state=Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor'
$folder=Join-Path (Join-Path $state 'update-recovery') $RecoveryId
$root=Split-Path -Parent $PSScriptRoot
$recordPath=Join-Path $folder 'recovery.json'
foreach ($path in @($folder,$recordPath)) {
  if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected recovery reparse point.' }
}
$record=Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
if ($record.schema -ne 1 -or $record.previousProject -ine $root -or $record.activationApproved -ne $false -or $record.quiesced -ne $false -or $record.version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$' -or $RecoveryId -cnotlike ($record.version+'-*')) { throw 'Invalid preflight recovery record.' }
if ($record.archive -isnot [string] -or $record.archive -cnotmatch '^ars-[a-zA-Z0-9_-]+\.dump$') { throw 'Invalid recovery archive name.' }
$archive=Join-Path $folder $record.archive
$prepared=Join-Path (Join-Path $state 'prepared-releases') $record.version
$fingerprint=Assert-ArsPreparedFingerprint $prepared
if ($fingerprint.digest -cne $record.preparedDigest) { throw 'Prepared release differs from recovery record.' }
$receipt=Join-Path $folder 'restore-rehearsal.json'
if (Test-Path -LiteralPath $receipt) { throw 'Restore rehearsal record already exists; retain it and create a new preflight if needed.' }
$answer=Read-Host 'Type RESTORE TEST to restore into a NEW test database (requires local Docker; business database is not replaced)'
if ($answer -cne 'RESTORE TEST') { return }
$target='ars_restore_test_'+[guid]::NewGuid().ToString('N')
$before=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
& (Join-Path $PSScriptRoot 'restore-local-postgres-test.ps1') -BackupFile $archive -TargetDatabase $target -Confirmation 'RESTORE TEST'
$after=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
if ($after -cne $before) { throw 'Archive changed during restore rehearsal.' }
$current=Assert-ArsPreparedFingerprint $prepared
if ($current.digest -cne $fingerprint.digest) { throw 'Prepared release changed during rehearsal.' }
# Separate evidence only. The original preflight record remains unchanged.
$evidence=[ordered]@{schema=1;recoveryId=$RecoveryId;version=$record.version;preparedDigest=$fingerprint.digest;archiveSha256=$before;testDatabase=$target;createdAt=[DateTime]::UtcNow.ToString('o');restoreTestPassed=$true;compatibilityTestPassed=$false;activationApproved=$false;note='Archive restored and core tables readable. No application compatibility or operational cutover tested.'}
$bytes=[Text.Encoding]::UTF8.GetBytes(($evidence | ConvertTo-Json))
$stream=[IO.File]::Open($receipt,[IO.FileMode]::CreateNew)
try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
Write-Host "Restore evidence recorded: $receipt"
Write-Host 'Test database retained. Activation remains blocked.'
