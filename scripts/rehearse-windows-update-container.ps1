# Offline PostgreSQL recovery rehearsal with optional candidate startup and historical row checks.
param([Parameter(Mandatory=$true)][string]$RecoveryId,[switch]$CandidateStartup,[string]$DependencyImage,[switch]$PreviousVersion,[string]$PreviousDependencyImage,[string]$RepairFolder,[switch]$RepairConfirmed)
$ErrorActionPreference='Stop'
if ($PreviousVersion -and -not $CandidateStartup) { throw 'Previous-version rehearsal requires candidate startup.' }
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
if ($RepairFolder -and (-not $RepairConfirmed -or -not $CandidateStartup -or $PreviousVersion -or $DependencyImage)) { throw 'Invalid repair rehearsal parameters.' }
& node (Join-Path $root 'scripts/verify-backup.mjs') $archive
if ($LASTEXITCODE -ne 0) { throw 'Recovery archive verification failed.' }
$before=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
$receipt=Join-Path $folder $(if ($PreviousVersion) {'rollback-compatibility-rehearsal.json'} elseif ($CandidateStartup) {'candidate-startup-rehearsal.json'} else {'offline-restore-rehearsal.json'})
if ($RepairFolder) { $receipt=Join-Path $RepairFolder 'repair-restore-test.json' }
if (Test-Path -LiteralPath $receipt) { throw 'Existing rehearsal evidence will not be overwritten.' }
if (-not $RepairFolder) {
 $answer=Read-Host 'Type OFFLINE RESTORE to test this archive in a disposable disconnected PostgreSQL container'
 if ($answer -cne 'OFFLINE RESTORE') { return }
}
function Invoke-DockerChecked([string[]]$Arguments) {
  $result=& docker @Arguments
  if ($LASTEXITCODE -ne 0) { throw 'Disposable container command failed.' }
  $result
}
# Capture existing column projections and hash sorted JSON rows inside the test container.
function Get-TestSchema([string]$Container) {
  $tables=@(Invoke-DockerChecked @('exec',$Container,'psql','-X','-U','restore_admin','-d','ars_update_test','-v','ON_ERROR_STOP=1','-Atc',"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))
  $schema=[ordered]@{}
  foreach ($table in $tables) {
    if ($table -cnotmatch '^[a-z_][a-z0-9_]*$') { throw 'Unsupported table identifier in historical baseline.' }
    $cols=@(Invoke-DockerChecked @('exec',$Container,'psql','-X','-U','restore_admin','-d','ars_update_test','-v','ON_ERROR_STOP=1','-Atc',("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='"+$table+"' ORDER BY ordinal_position")))
    if (-not $cols.Count) { throw 'Missing historical columns.' }
    foreach ($col in $cols) { if ($col -cnotmatch '^[a-z_][a-z0-9_]*$') { throw 'Unsupported historical column identifier.' } }
    $schema[$table]=$cols
  }
  if (-not $schema.Count) { throw 'No historical tables found.' }
  return $schema
}
function Get-TestRowFingerprints([string]$Container,$Schema) {
  $result=[ordered]@{}
  foreach ($table in $Schema.Keys) {
    $projection=($Schema[$table] | ForEach-Object { '"'+$_+'"' }) -join ','
    $sql='SELECT row_to_json(q)::text FROM (SELECT '+$projection+' FROM public."'+$table+'") q ORDER BY row_to_json(q)::text COLLATE "C"'
    # Write query to a uniquely named container-local file to avoid Windows native argument quoting.
    $local=Join-Path ([IO.Path]::GetTempPath()) ('ars-history-'+[guid]::NewGuid().ToString('N')+'.sql')
    $remote='/tmp/'+[IO.Path]::GetFileName($local)
    try {
      [IO.File]::WriteAllText($local,$sql,[Text.UTF8Encoding]::new($false))
      $null=Invoke-DockerChecked @('cp',$local,($Container+':'+$remote))
      # pipefail prevents an unsuccessful query from appearing as a successful hash.
      $command='set -o pipefail; psql -X -U restore_admin -d ars_update_test -v ON_ERROR_STOP=1 -At -f '+$remote+' | sha256sum'
      $hash=@(Invoke-DockerChecked @('exec',$Container,'sh','-c',$command))
      if ($hash.Count -ne 1 -or $hash[0] -notmatch '^[a-f0-9]{64}\s+') { throw 'Historical row fingerprint failed.' }
      $result[$table]=($hash[0] -split '\s+')[0]
    } finally {
      if (Test-Path -LiteralPath $local) { Remove-Item -LiteralPath $local -Force }
      $null=Invoke-DockerChecked @('exec',$Container,'rm','-f',$remote)
    }
  }
  return $result
}
$name='ars-windows-rehearsal-'+[guid]::NewGuid().ToString('N')
$image='postgres:16-alpine'
$password=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
$created=$false
$appCreated=$false
$appName=$name+'-app'
$startupPassed=$false
$authenticatedReadsPassed=$false
$authenticatedWritesPassed=$false
$historicalRowsCompared=$false
$historicalTableCount=0
$imageId=$null
$copyRoot=$null
$oldCopy=$null
$previousBuildDigest=$null
$backwardStartupPassed=$false
$backwardReadsPassed=$false
$backwardWritesPassed=$false
$repairBuildRoot=$null
$repairImage=$null
try {
  if ($RepairFolder) {
    . (Join-Path $PSScriptRoot 'windows-repair-backup-review.ps1')
    foreach ($key in @('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH')) {
      if ([Environment]::GetEnvironmentVariable($key,'Process')) { throw 'Custom Docker connection is unsupported.' }
    }
    $endpoint=(& docker context inspect --format '{{.Endpoints.docker.Host}}')
    if ($LASTEXITCODE -ne 0 -or $endpoint -notin @('npipe:////./pipe/docker_engine','npipe:////./pipe/dockerDesktopLinuxEngine')) { throw 'Local Docker engine required.' }
    $repairBinding=Get-ArsRepairReviewBinding $root $state $RepairFolder
    $backupPath=Join-Path $RepairFolder 'backup-observation.json'
    $backupHash=Get-ArsRepairMetadataHash $RepairFolder 'backup-observation.json'
    $backup=Get-Content -LiteralPath $backupPath -Raw | ConvertFrom-Json
    if ($backup.kind -cne 'windows-repair-backup-observation' -or $backup.recoveryId -cne $RecoveryId -or $backup.backupEvidenceMatched -ne $true -or ($backup.binding|ConvertTo-Json -Compress) -cne ($repairBinding|ConvertTo-Json -Compress)) { throw 'Matching repair backup evidence required.' }
    foreach ($flag in @('repairCandidateRestoreTested','activationAllowed','startupAllowed','repairApplied','continuousExclusionVerified')) { if ($backup.$flag -isnot [bool] -or $backup.$flag) { throw 'Unexpected repair authorization.' } }
    foreach ($n in @('recovery.json','rollback-compatibility-rehearsal.json')) { if ((Get-ArsRepairMetadataHash $folder $n) -cne $backup.evidence.$n) { throw 'Protected evidence changed.' } }
    $prior=Get-Content -LiteralPath (Join-Path $folder 'rollback-compatibility-rehearsal.json') -Raw | ConvertFrom-Json
    if ($prior.schema -ne 1 -or $prior.recoveryId -cne $RecoveryId -or $prior.archiveSha256 -cne $before -or $prior.activationApproved -isnot [bool] -or $prior.activationApproved -or $prior.previousDependencyImageId -cnotmatch '^sha256:[a-f0-9]{64}$' -or $prior.previousBuildDigest -cnotmatch '^[a-f0-9]{64}$') { throw 'Previous rollback evidence mismatch.' }
    foreach ($flag in @('offlineRestorePassed','candidateStartupPassed','authenticatedReadsPassed','authenticatedWritesPassed','historicalRowsCompared','backwardStartupPassed','backwardReadsPassed','backwardWritesPassed')) { if ($prior.$flag -isnot [bool] -or -not $prior.$flag) { throw 'Previous rehearsal incomplete.' } }
    $PreviousDependencyImage=$prior.previousDependencyImageId
    $repairBuildRoot=Join-Path ([IO.Path]::GetTempPath()) ('ars-repair-build-'+[guid]::NewGuid().ToString('N'))
    Copy-ArsPilotRelease (Join-Path $RepairFolder 'candidate') $repairBuildRoot
    $lockHash=(Get-FileHash -LiteralPath (Join-Path $repairBuildRoot 'package-lock.json')).Hash.ToLowerInvariant()
    $dockerfile=Join-Path $repairBuildRoot 'RepairRehearsal.Dockerfile'
    $iid=Join-Path $repairBuildRoot 'repair-image-id'
    $definition=@('FROM node:22-bookworm-slim','WORKDIR /app','COPY . .','RUN npm ci --include=dev && npm run build',('LABEL com.rsnextward.ars-lock-sha256='+$lockHash)) -join [Environment]::NewLine
    [IO.File]::WriteAllText($dockerfile,$definition)
    $null=Invoke-DockerChecked @('build','--iidfile',$iid,'-f',$dockerfile,$repairBuildRoot)
    $repairImage=(Get-Content -LiteralPath $iid -Raw).Trim()
    if ($repairImage -cnotmatch '^sha256:[a-f0-9]{64}$') { throw 'Repair image identity unavailable.' }
    $DependencyImage=$repairImage
  }
  if ($CandidateStartup) {
    # A Windows npm installation is not a Linux dependency tree. Require a separately
    # provisioned trusted Linux image with /app/node_modules matching the release lock.
    if ($DependencyImage -cnotmatch '^sha256:[a-f0-9]{64}$') { throw 'Provide the exact trusted Linux dependency image ID, not a mutable tag.' }
    $imageId=@(Invoke-DockerChecked @('image','inspect','--format','{{.Id}}',$DependencyImage))
    if ($imageId.Count -ne 1 -or $imageId[0] -cne $DependencyImage) { throw 'Dependency image identity mismatch.' }
    $copyRoot=Join-Path ([IO.Path]::GetTempPath()) ('ars-candidate-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $copyRoot | Out-Null
    if (-not $RepairFolder) { Copy-Item -LiteralPath (Join-Path $prepared 'dist') -Destination (Join-Path $copyRoot 'dist') -Recurse }
    if (-not $RepairFolder) { $lockHash=(Get-FileHash -LiteralPath (Join-Path $prepared 'package-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant() }
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
  if ($CandidateStartup) {
    # Create a synthetic administrator exclusively in the disconnected database.
    $testId='update-test-'+[guid]::NewGuid().ToString('N')
    $testEmail=$testId+'@example.invalid'
    $testPassword=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
    $hashCode="console.log(require('bcryptjs').hashSync(process.argv[1],10))"
    $passwordHash=@(Invoke-DockerChecked @('run','--rm','--pull=never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','-w','/app','--entrypoint','node',$DependencyImage,'-e',$hashCode,$testPassword))
    if ($passwordHash.Count -ne 1 -or $passwordHash[0] -cnotmatch '^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$') { throw 'Synthetic password hashing failed.' }
    $sql="INSERT INTO users(id,email,name,role,password_hash) VALUES ('$testId','$testEmail','Update Test Admin','Super Admin','"+$passwordHash[0]+"')"
    $null=Invoke-DockerChecked @('exec',$name,'psql','-X','-U','restore_admin','-d','ars_update_test','-v','ON_ERROR_STOP=1','-c',$sql)
    $schema=Get-TestSchema $name
    $historicalBefore=Get-TestRowFingerprints $name $schema
    $jwt=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
    $mountArgs=@()
    if (-not $RepairFolder) { $mountArgs=@('--mount',('type=bind,source='+(Join-Path $copyRoot 'dist')+',target=/app/dist,readonly')) }
    $null=Invoke-DockerChecked (@('run','-d','--pull=never','--name',$appName,'--network',('container:'+$name),'--read-only','--tmpfs','/tmp','--tmpfs','/app/uploads','--cap-drop','ALL','--security-opt','no-new-privileges')+$mountArgs+@('-w','/app','-e','NODE_ENV=production','-e','ARS_LISTEN_HOST=127.0.0.1','-e','PORT=3000','-e',('JWT_SECRET='+$jwt),'-e',('DATABASE_URL=postgresql://restore_admin:'+$password+'@127.0.0.1:5432/ars_update_test'),'--entrypoint','node',$DependencyImage,'dist/server.cjs'))
    $appCreated=$true
    $probe="fetch('http://127.0.0.1:3000/api/ready',{signal:AbortSignal.timeout(3000)}).then(r=>r.json()).then(d=>process.exit(d.ok===true&&d.status==='ready'&&d.database==='reachable'&&d.sourceOfTruth==='normalized'?0:1)).catch(()=>process.exit(1))"
    for ($i=0;$i -lt 90;$i++) {
      & docker exec $appName node -e $probe | Out-Null
      if ($LASTEXITCODE -eq 0) { $startupPassed=$true;break }
      Start-Sleep -Seconds 2
    }
    if (-not $startupPassed) { throw 'Candidate failed disconnected readiness check.' }
    # Send trusted probe source as a single base64 argument to avoid PowerShell native quoting.
    $probePath=Join-Path $PSScriptRoot 'mint/compatibility-api-probe.mjs'
    $encoded=[Convert]::ToBase64String([IO.File]::ReadAllBytes($probePath))
    $runner="import('data:text/javascript;base64,'+process.argv[1]).catch(()=>process.exit(1))"
    $null=Invoke-DockerChecked @('exec','-e',('ARS_TEST_EMAIL='+$testEmail),'-e',('ARS_TEST_PASSWORD='+$testPassword),'-e','ARS_TEST_SHOP=shop-main',$appName,'node','-e',$runner,$encoded)
    # Delete only synthetic user's sessions before historical comparison.
    $null=Invoke-DockerChecked @('exec',$name,'psql','-X','-U','restore_admin','-d','ars_update_test','-v','ON_ERROR_STOP=1','-c',("DELETE FROM auth_sessions WHERE user_id='"+$testId+"'"))
    $authenticatedReadsPassed=$true

    $null=Invoke-DockerChecked @('stop','-t','15',$appName)
    $historicalAfter=Get-TestRowFingerprints $name $schema
    foreach ($table in $schema.Keys) {
      if ($historicalBefore[$table] -cne $historicalAfter[$table]) { throw "Historical records changed during startup: $table" }
    }
    $historicalRowsCompared=$true
    $historicalTableCount=$schema.Count
    # Write probes must follow the historical comparison, never contaminate its baseline.
    $null=Invoke-DockerChecked @('start',$appName)
    $writeReady=$false
    for ($i=0;$i -lt 90;$i++) {
      & docker exec $appName node -e $probe | Out-Null
      if ($LASTEXITCODE -eq 0) { $writeReady=$true;break }
      Start-Sleep -Seconds 2
    }
    if (-not $writeReady) { throw 'Candidate failed readiness before transaction tests.' }
    $writePath=Join-Path $PSScriptRoot 'mint/compatibility-write-probe.mjs'
    $writeEncoded=[Convert]::ToBase64String([IO.File]::ReadAllBytes($writePath))
    $null=Invoke-DockerChecked @('exec','-e',('ARS_TEST_EMAIL='+$testEmail),'-e',('ARS_TEST_PASSWORD='+$testPassword),'-e','ARS_TEST_SHOP=shop-main','-e','ARS_TEST_ALLOW_WRITES=isolated-disposable',$appName,'node','-e',$runner,$writeEncoded)
    $null=Invoke-DockerChecked @('exec',$name,'psql','-X','-U','restore_admin','-d','ars_update_test','-v','ON_ERROR_STOP=1','-c',("DELETE FROM auth_sessions WHERE user_id='"+$testId+"'"))
    $null=Invoke-DockerChecked @('stop','-t','15',$appName)
    $authenticatedWritesPassed=$true
    if ($PreviousVersion -or $RepairFolder) {
      if ($PreviousDependencyImage -cnotmatch '^sha256:[a-f0-9]{64}$') { throw 'Previous version requires its own pinned trusted dependency image.' }
      $oldImage=@(Invoke-DockerChecked @('image','inspect','--format','{{.Id}}',$PreviousDependencyImage))
      if ($oldImage.Count -ne 1 -or $oldImage[0] -cne $PreviousDependencyImage) { throw 'Previous dependency image mismatch.' }
      $oldLock=(Get-FileHash -LiteralPath (Join-Path $root 'package-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
      $oldLabel=@(Invoke-DockerChecked @('image','inspect','--format','{{index .Config.Labels "com.rsnextward.ars-lock-sha256"}}',$PreviousDependencyImage))
      if ($oldLabel.Count -ne 1 -or $oldLabel[0] -cne $oldLock) { throw 'Previous dependency lockfile mismatch.' }
      # Only executable dist output is copied; never mount the operational project.
      $oldDist=Join-Path $root 'dist'
      $previousBuildDigest=(Get-ArsPreparedFingerprint $oldDist).digest
      if ($RepairFolder -and $previousBuildDigest -cne $prior.previousBuildDigest) { throw 'Previous executable differs from protected rollback evidence.' }
      $oldCopy=Join-Path ([IO.Path]::GetTempPath()) ('ars-previous-'+[guid]::NewGuid().ToString('N'))
      Copy-Item -LiteralPath $oldDist -Destination $oldCopy -Recurse
      if ((Get-ArsPreparedFingerprint $oldCopy).digest -cne $previousBuildDigest) { throw 'Previous build copy differs.' }
      # Include the candidate's newly created transactions in the rollback baseline.
      $rollbackSchema=Get-TestSchema $name
      $rollbackBefore=Get-TestRowFingerprints $name $rollbackSchema
      $null=Invoke-DockerChecked @('rm','-f','-v',$appName)
      $appCreated=$false
      $jwt=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
      $null=Invoke-DockerChecked @('run','-d','--pull=never','--name',$appName,'--network',('container:'+$name),'--read-only','--tmpfs','/tmp','--tmpfs','/app/uploads','--cap-drop','ALL','--security-opt','no-new-privileges','--mount',('type=bind,source='+$oldCopy+',target=/app/dist,readonly'),'-w','/app','-e','NODE_ENV=production','-e','ARS_LISTEN_HOST=127.0.0.1','-e','PORT=3000','-e',('JWT_SECRET='+$jwt),'-e',('DATABASE_URL=postgresql://restore_admin:'+$password+'@127.0.0.1:5432/ars_update_test'),'--entrypoint','node',$PreviousDependencyImage,'dist/server.cjs')
      $appCreated=$true
      for ($i=0;$i -lt 90;$i++) {
        & docker exec $appName node -e $probe | Out-Null
        if ($LASTEXITCODE -eq 0) { $backwardStartupPassed=$true;break }
        Start-Sleep -Seconds 2
      }
      if (-not $backwardStartupPassed) { throw 'Previous version failed startup on candidate-updated test database.' }
      $null=Invoke-DockerChecked @('exec','-e',('ARS_TEST_EMAIL='+$testEmail),'-e',('ARS_TEST_PASSWORD='+$testPassword),'-e','ARS_TEST_SHOP=shop-main',$appName,'node','-e',$runner,$encoded)
      $null=Invoke-DockerChecked @('exec',$name,'psql','-X','-U','restore_admin','-d','ars_update_test','-v','ON_ERROR_STOP=1','-c',("DELETE FROM auth_sessions WHERE user_id='"+$testId+"'"))
      $null=Invoke-DockerChecked @('stop','-t','15',$appName)
      $rollbackAfter=Get-TestRowFingerprints $name $rollbackSchema
      foreach ($table in $rollbackSchema.Keys) {
        if ($rollbackBefore[$table] -cne $rollbackAfter[$table]) { throw "Previous version changed historical records: $table" }
      }
      $backwardReadsPassed=$true
      $null=Invoke-DockerChecked @('start',$appName)
      $oldReady=$false
      for ($i=0;$i -lt 90;$i++) {
        & docker exec $appName node -e $probe | Out-Null
        if ($LASTEXITCODE -eq 0) { $oldReady=$true;break }
        Start-Sleep -Seconds 2
      }
      if (-not $oldReady) { throw 'Previous version failed readiness before write test.' }
      $null=Invoke-DockerChecked @('exec','-e',('ARS_TEST_EMAIL='+$testEmail),'-e',('ARS_TEST_PASSWORD='+$testPassword),'-e','ARS_TEST_SHOP=shop-main','-e','ARS_TEST_ALLOW_WRITES=isolated-disposable',$appName,'node','-e',$runner,$writeEncoded)
      $null=Invoke-DockerChecked @('stop','-t','15',$appName)
      if ((Get-ArsPreparedFingerprint $oldCopy).digest -cne $previousBuildDigest -or (Get-ArsPreparedFingerprint $oldDist).digest -cne $previousBuildDigest) { throw 'Previous build changed during rehearsal.' }
      $backwardWritesPassed=$true
    }


  }
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -cne $before) { throw 'Recovery archive changed during test.' }
  if ((Assert-ArsPreparedFingerprint $prepared).digest -cne $fingerprint.digest) { throw 'Prepared release changed during test.' }
  if ($RepairFolder) {
    if ((Get-ArsRepairMetadataHash $RepairFolder 'backup-observation.json') -cne $backupHash -or ((Get-ArsRepairReviewBinding $root $state $RepairFolder)|ConvertTo-Json -Compress) -cne ($repairBinding|ConvertTo-Json -Compress)) { throw 'Repair evidence changed during rehearsal.' }
    foreach ($n in @('recovery.json','rollback-compatibility-rehearsal.json')) { if ((Get-ArsRepairMetadataHash $folder $n) -cne $backup.evidence.$n) { throw 'Protected evidence changed during rehearsal.' } }
  }
} finally {
  try {
    if ($appCreated) { $null=Invoke-DockerChecked @('rm','-f','-v',$appName) }
  } finally {
    try {
      if ($copyRoot -and (Test-Path -LiteralPath $copyRoot)) { Remove-Item -LiteralPath $copyRoot -Recurse -Force }
      if ($oldCopy -and (Test-Path -LiteralPath $oldCopy)) { Remove-Item -LiteralPath $oldCopy -Recurse -Force }
    } finally {
      if ($created) { $null=Invoke-DockerChecked @('rm','-f','-v',$name) }
      if ($repairBuildRoot -and (Test-Path -LiteralPath $repairBuildRoot)) { Remove-Item -LiteralPath $repairBuildRoot -Recurse -Force }
      # Retain the immutable repair image for support review.
    }
  }
}
$evidence=[ordered]@{schema=1;recoveryId=$RecoveryId;version=$record.version;preparedDigest=$fingerprint.digest;archiveSha256=$before;createdAt=[DateTime]::UtcNow.ToString('o');restoredRowCounts=$counts;offlineRestorePassed=$true;candidateStartupPassed=$startupPassed;authenticatedReadsPassed=$authenticatedReadsPassed;authenticatedWritesPassed=$authenticatedWritesPassed;dependencyImageId=$DependencyImage;compatibilityTestPassed=$false;previousBuildDigest=$previousBuildDigest;previousDependencyImageId=$PreviousDependencyImage;backwardStartupPassed=$backwardStartupPassed;backwardReadsPassed=$backwardReadsPassed;backwardWritesPassed=$backwardWritesPassed;historicalRowsCompared=$historicalRowsCompared;historicalTableCount=$historicalTableCount;activationApproved=$false}
if ($RepairFolder) {
 $evidence.kind='windows-isolated-repair-restore-test'
 $evidence.repairSpecificBackwardTested=($backwardStartupPassed -and $backwardReadsPassed -and $backwardWritesPassed)
 $evidence.repairBinding=$repairBinding
 $evidence.repairApplied=$false
 $evidence.startupAllowed=$false
 $evidence.activationAllowed=$false
 $evidence.continuousExclusionVerified=$false
}
$bytes=[Text.Encoding]::UTF8.GetBytes(($evidence | ConvertTo-Json -Depth 5))
$stream=[IO.File]::Open($receipt,[IO.FileMode]::CreateNew)
try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
Write-Host "Offline restoration evidence: $receipt"
Write-Host 'No application compatibility approval or activation was performed.'
