# Offline PostgreSQL recovery rehearsal; candidate application execution remains disabled.
param([Parameter(Mandatory=$true)][string]$RecoveryId,[switch]$CandidateStartup,[string]$DependencyImage)
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
$receipt=Join-Path $folder $(if ($CandidateStartup) {'candidate-startup-rehearsal.json'} else {'offline-restore-rehearsal.json'})
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
$appCreated=$false
$appName=$name+'-app'
$startupPassed=$false
$imageId=$null
$copyRoot=$null
try {
  if ($CandidateStartup) {
    # A Windows npm installation is not a Linux dependency tree. Require a separately
    # provisioned trusted Linux image with /app/node_modules matching the release lock.
    if ($DependencyImage -cnotmatch '^sha256:[a-f0-9]{64}
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
  if ($CandidateStartup) {
    # Mount only executable build output, never the active project or its credentials.
    $jwt=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
    $null=Invoke-DockerChecked @('run','-d','--pull=never','--name',$appName,'--network',('container:'+$name),'--read-only','--tmpfs','/tmp','--tmpfs','/app/uploads','--cap-drop','ALL','--security-opt','no-new-privileges','--mount',('type=bind,source='+(Join-Path $copyRoot 'dist')+',target=/app/dist,readonly'),'-w','/app','-e','NODE_ENV=production','-e','ARS_LISTEN_HOST=127.0.0.1','-e','PORT=3000','-e',('JWT_SECRET='+$jwt),'-e',('DATABASE_URL=postgresql://restore_admin:'+$password+'@127.0.0.1:5432/ars_update_test'),'--entrypoint','node',$DependencyImage,'dist/server.cjs')
    $appCreated=$true
    $probe="fetch('http://127.0.0.1:3000/api/ready',{signal:AbortSignal.timeout(3000)}).then(r=>r.json()).then(d=>process.exit(d.ok===true&&d.status==='ready'&&d.database==='reachable'&&d.sourceOfTruth==='normalized'?0:1)).catch(()=>process.exit(1))"
    for ($i=0;$i -lt 90;$i++) {
      & docker exec $appName node -e $probe | Out-Null
      if ($LASTEXITCODE -eq 0) { $startupPassed=$true;break }
      Start-Sleep -Seconds 2
    }
    if (-not $startupPassed) { throw 'Candidate failed disconnected readiness check.' }
    $null=Invoke-DockerChecked @('stop','-t','15',$appName)
  }
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -cne $before) { throw 'Recovery archive changed during test.' }
  if ((Assert-ArsPreparedFingerprint $prepared).digest -cne $fingerprint.digest) { throw 'Prepared release changed during test.' }
} finally {
  if ($appCreated) { $null=Invoke-DockerChecked @('rm','-f','-v',$appName) }
  if ($copyRoot -and (Test-Path -LiteralPath $copyRoot)) { Remove-Item -LiteralPath $copyRoot -Recurse -Force }
  if ($created) {
    # Remove only the uniquely named disposable container created by this invocation.
    $null=Invoke-DockerChecked @('rm','-f','-v',$name)
  }
}
$evidence=[ordered]@{schema=1;recoveryId=$RecoveryId;version=$record.version;preparedDigest=$fingerprint.digest;archiveSha256=$before;createdAt=[DateTime]::UtcNow.ToString('o');restoredRowCounts=$counts;offlineRestorePassed=$true;candidateStartupPassed=$startupPassed;dependencyImageId=$DependencyImage;compatibilityTestPassed=$false;historicalRowsCompared=$false;activationApproved=$false}
$bytes=[Text.Encoding]::UTF8.GetBytes(($evidence | ConvertTo-Json -Depth 5))
$stream=[IO.File]::Open($receipt,[IO.FileMode]::CreateNew)
try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
Write-Host "Offline restoration evidence: $receipt"
Write-Host 'No application compatibility approval or activation was performed.'
) { throw 'Provide the exact trusted Linux dependency image ID, not a mutable tag.' }
    $imageId=@(Invoke-DockerChecked @('image','inspect','--format','{{.Id}}',$DependencyImage))
    if ($imageId.Count -ne 1 -or $imageId[0] -cne $DependencyImage) { throw 'Dependency image identity mismatch.' }
    $copyRoot=Join-Path ([IO.Path]::GetTempPath()) ('ars-candidate-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $copyRoot | Out-Null
    Copy-Item -LiteralPath (Join-Path $prepared 'dist') -Destination (Join-Path $copyRoot 'dist') -Recurse
    $lockHash=(Get-FileHash -LiteralPath (Join-Path $prepared 'package-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
    $label=@(Invoke-DockerChecked @('image','inspect','--format','{{index .Config.Labels "com.rsnextward.ars-lock-sha256"}}',$DependencyImage))
    if ($label.Count -ne 1 -or $label[0] -cne $lockHash) { throw 'Trusted dependency image lockfile identity mismatch.' }
  }
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
