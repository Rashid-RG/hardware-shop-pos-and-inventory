# Offline PostgreSQL recovery rehearsal; candidate application execution remains disabled.
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
if ($record.schema -ne 1 -or $record.previousProject -ine $root -or $record.activationApproved -ne $false -or $record.version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$' -or $RecoveryId -cnotlike ($record.version+'-*')) { throw 'Invalid recovery metadata.' }
if ($record.archive -isnot [string] -or $record.archive -cnotmatch '^ars-[a-zA-Z0-9_-]+\.dump$') { throw 'Invalid archive reference.' }
$archive=Join-Path $folder $record.archive
$prepared=Join-Path (Join-Path $state 'prepared-releases') $record.version
$fingerprint=Assert-ArsPreparedFingerprint $prepared
if ($fingerprint.digest -cne $record.preparedDigest) { throw 'Prepared release mismatch.' }
& node (Join-Path $root 'scripts/verify-backup.mjs') $archive
if ($LASTEXITCODE -ne 0) { throw 'Recovery archive verification failed.' }
$before=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
$receipt=Join-Path $folder 'offline-restore-rehearsal.json'
if (Test-Path -LiteralPath $receipt) { throw 'Existing rehearsal evidence will not be overwritten.' }
$answer=Read-Host 'Type OFFLINE RESTORE to test this archive in a disposable disconnected PostgreSQL container'
if ($answer -cne 'OFFLINE RESTORE') { return }
function Invoke-DockerChecked([string[]]$Arguments) {
  $result=& docker @Arguments
  if ($LASTEXITCODE -ne 0) { throw 'Disposable container command failed.' }
  $result
}
$name='ars-windows-rehearsal-'+[guid]::NewGuid().ToString('N')
$image='postgres:16-alpine'
$password=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
$created=$false
try {
  $null=Invoke-DockerChecked @('image','inspect',$image)
  $null=Invoke-DockerChecked @('run','-d','--pull=never','--network','none','--name',$name,'--label','com.rsnextward.ars-purpose=windows-update-rehearsal','--tmpfs','/var/lib/postgresql/data:rw,mode=0700','-e','POSTGRES_USER=restore_admin','-e','POSTGRES_DB=ars_update_test','-e',('POSTGRES_PASSWORD='+$password),$image)
  $created=$true
  $ready=$false
  for ($i=0;$i -lt 90;$i++) {
    & docker exec $name pg_isready -h 127.0.0.1 -U restore_admin -d ars_update_test | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready=$true;break }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { throw 'Offline PostgreSQL did not become ready.' }
  $null=Invoke-DockerChecked @('cp',$archive,($name+':/tmp/recovery.dump'))
  $hash=@(Invoke-DockerChecked @('exec',$name,'sha256sum','/tmp/recovery.dump'))
  if ($hash.Count -ne 1 -or ($hash[0].Trim() -split '\s+')[0] -ine $before) { throw 'Copied archive checksum mismatch.' }
  $null=Invoke-DockerChecked @('exec',$name,'pg_restore','-U','restore_admin','-d','ars_update_test','--single-transaction','--exit-on-error','--no-owner','--no-acl','/tmp/recovery.dump')
  $counts=[ordered]@{}
  foreach ($table in @('products','customers','sales_transactions','sales_transaction_items','purchase_orders','purchase_order_items','supplier_payments','customer_credit_payments')) {
    $rows=@(Invoke-DockerChecked @('exec',$name,'psql','-X','-U','restore_admin','-d','ars_update_test','-v','ON_ERROR_STOP=1','-Atc',('SELECT count(*) FROM public.'+$table)))
    if ($rows.Count -ne 1 -or $rows[0] -notmatch '^\d+$') { throw 'Invalid restored table count.' }
    $counts[$table]=[long]$rows[0]
  }
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -cne $before) { throw 'Recovery archive changed during test.' }
  if ((Assert-ArsPreparedFingerprint $prepared).digest -cne $fingerprint.digest) { throw 'Prepared release changed during test.' }
} finally {
  if ($created) {
    # Remove only the uniquely named disposable container created by this invocation.
    $null=Invoke-DockerChecked @('rm','-f','-v',$name)
  }
}
$evidence=[ordered]@{schema=1;recoveryId=$RecoveryId;version=$record.version;preparedDigest=$fingerprint.digest;archiveSha256=$before;createdAt=[DateTime]::UtcNow.ToString('o');restoredRowCounts=$counts;offlineRestorePassed=$true;compatibilityTestPassed=$false;historicalRowsCompared=$false;activationApproved=$false}
$bytes=[Text.Encoding]::UTF8.GetBytes(($evidence | ConvertTo-Json -Depth 5))
$stream=[IO.File]::Open($receipt,[IO.FileMode]::CreateNew)
try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
Write-Host "Offline restoration evidence: $receipt"
Write-Host 'No application compatibility approval or activation was performed.'
