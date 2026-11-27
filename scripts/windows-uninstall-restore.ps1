# Dedicated disconnected restore review. No live database or application startup.
. (Join-Path $PSScriptRoot 'windows-uninstall-backup-preparation.ps1')
function Assert-ArsUninstallRestoredTables($expected,$actual) {
 $names=@($expected.PSObject.Properties.Name)
 $restored=@($actual.PSObject.Properties.Name)
 if (-not $names.Count -or $names.Count -ne $restored.Count) {throw 'Restored table set differs.'}
 foreach ($required in @('products','customers','sales_transactions','sales_transaction_items','customer_credit_payments')) {
  if ($required -cnotin $names) {throw 'Required business table missing.'}
 }
 foreach ($table in $names) {
  if ($table -cnotmatch '^[a-z_][a-z0-9_]*$' -or $table -cnotin $restored) {throw 'Invalid or missing table.'}
  $a=$expected.$table;$b=$actual.$table
  if (($a.rows -isnot [int] -and $a.rows -isnot [long]) -or $a.rows -lt 0 -or $a.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $a.rows -ne $b.rows -or $a.sha256 -cne $b.sha256) {throw 'Restored table fingerprint differs.'}
 }
}
function Invoke-ArsUninstallDocker([string[]]$Arguments) {
 $output=& docker @Arguments
 if ($LASTEXITCODE -ne 0) {throw 'Disposable restoration command failed.'}
 $output
}
function Get-ArsUninstallUploadCount([string]$archive) {
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $zip=[IO.Compression.ZipFile]::OpenRead($archive)
 try {
  $seen=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  $buffer=New-Object byte[] 65536
  foreach ($entry in $zip.Entries) {
   $path=$entry.FullName.TrimEnd('/')
   if ($path -notmatch '^uploads(?:/|$)' -or $path -match '\\|:|(^|/)\.{1,2}(/|$)|//|[<>*?"|\x00-\x1f]|[. ](/|$)' -or -not $seen.Add($path)) {throw 'Unsafe or duplicate upload archive member.'}
   $stream=$entry.Open()
   try {
    [long]$length=0
    while (($n=$stream.Read($buffer,0,$buffer.Length)) -gt 0) {$length+=$n}
    if ($length -ne $entry.Length) {throw 'Incomplete upload archive member.'}
   } finally {$stream.Dispose()}
  }
  return $seen.Count
 } finally {$zip.Dispose()}
}
function Get-ArsRestoredUninstallTables([string]$container) {
 $names=@(Invoke-ArsUninstallDocker @('exec',$container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','restore_admin','-d','ars_uninstall_test','-c',"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))
 $result=[ordered]@{}
 foreach ($table in $names) {
  if ($table -cnotmatch '^[a-z_][a-z0-9_]*$') {throw 'Unsupported restored table identifier.'}
  $sql="SET TIME ZONE 'UTC'; SET DateStyle='ISO, YMD'; SET extra_float_digits=3; SET bytea_output='hex'; "+'SELECT row_to_json(t)::text FROM public."'+$table+'" t ORDER BY row_to_json(t)::text COLLATE "C";'
  $local=Join-Path ([IO.Path]::GetTempPath()) ('ars-uninstall-query-'+[guid]::NewGuid().ToString('N')+'.sql')
  $remote='/tmp/'+[IO.Path]::GetFileName($local)
  try {
   [IO.File]::WriteAllText($local,$sql,[Text.UTF8Encoding]::new($false))
   $null=Invoke-ArsUninstallDocker @('cp',$local,($container+':'+$remote))
   $command='set -o pipefail; psql -XqAt -v ON_ERROR_STOP=1 -U restore_admin -d ars_uninstall_test -f '+$remote+' | sha256sum'
   $hash=@(Invoke-ArsUninstallDocker @('exec',$container,'sh','-c',$command))
   $count=@(Invoke-ArsUninstallDocker @('exec',$container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','restore_admin','-d','ars_uninstall_test','-c',('SELECT count(*) FROM public.'+$table)))
   if ($hash.Count -ne 1 -or $hash[0] -cnotmatch '^[a-f0-9]{64}\s+' -or $count.Count -ne 1 -or $count[0] -notmatch '^\d+$') {throw 'Invalid restored fingerprint.'}
   $result[$table]=[ordered]@{rows=[long]$count[0];sha256=($hash[0] -split '\s+')[0]}
  } finally {
   if ([IO.File]::Exists($local)) {[IO.File]::Delete($local)}
   $null=Invoke-ArsUninstallDocker @('exec',$container,'rm','-f',$remote)
  }
 }
 return [pscustomobject]$result
}
function Test-ArsUninstallRestore([string]$project,[string]$folder) {
 $state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
 $control=Join-Path $state 'desktop-control'
 $id=Split-Path -Leaf $folder
 if ($id -cnotmatch '^[a-f0-9]{32}$' -or (Split-Path -Parent $folder) -ine (Join-Path $state 'uninstall-recovery')) {throw 'Managed uninstall recovery folder required.'}
 $mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
 $owned=$false
 try {
  try {$owned=$mutex.WaitOne(0)} catch [System.Threading.AbandonedMutexException] {$owned=$true;throw 'Interrupted maintenance requires review.'}
  if (-not $owned) {throw 'Maintenance active.'}
  foreach ($p in @($project,$state,$control,$folder)) {Assert-ArsPlainPath $p}
  foreach ($key in @('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','ARS_RUNTIME_ROOT')) {
   if ([Environment]::GetEnvironmentVariable($key,'Process')) {throw 'Unsupported runtime override.'}
  }
  $endpoint=@(Invoke-ArsUninstallDocker @('context','inspect','--format','{{.Endpoints.docker.Host}}'))
  if ($endpoint.Count -ne 1 -or $endpoint[0] -notin @('npipe:////./pipe/docker_engine','npipe:////./pipe/dockerDesktopLinuxEngine')) {throw 'Local Docker required.'}
  $markers=@('instance.json','repair-interrupted.json','runtime-switch-intent.json','runtime-switch-journal.json','runtime-active.json','activation.json','handoff-pending.json','runtime-activation-interrupted.json','runtime-migration-interrupted.json','switch-journal.json')
  if (@(Get-ChildItem -LiteralPath $control -Force|Where-Object Name -in $markers).Count -or (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {throw 'Application or maintenance incident active.'}
  $target=Join-Path $folder 'uninstall-restore-test.json'
  if (@(Get-ChildItem -LiteralPath $folder -Force|Where-Object Name -eq 'uninstall-restore-test.json').Count) {throw 'Existing restore evidence must be retained.'}
  $paths=[ordered]@{hold=(Join-Path $control 'maintenance.json');proof=(Join-Path $control 'maintenance-shutdown.json');meta=(Join-Path $folder 'recovery.json')}
  $raw=[ordered]@{};$digests=[ordered]@{}
  foreach ($key in $paths.Keys) {
   $p=$paths[$key];Assert-ArsPlainPath $p
   if ((Get-Item -LiteralPath $p).Length -gt 65536) {throw 'Invalid recovery evidence size.'}
   $digests[$key]=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash
   $raw[$key]=Get-Content -LiteralPath $p -Raw|ConvertFrom-Json
  }
  Assert-ArsUninstallHold $raw.hold $raw.proof $project
  $meta=$raw.meta
  if ($meta.schema -ne 1 -or $meta.kind -cne 'windows-final-uninstall-backup' -or $meta.uninstallId -cne $id -or $raw.hold.uninstallId -cne $id -or $meta.previousProject -ine $project -or $meta.holdDigest -cne $digests.hold -or $meta.shutdownDigest -cne $digests.proof) {throw 'Recovery identity mismatch.'}
  foreach ($flag in @('restoreTestPassed','finalUninstallBackupVerified','applicationRemovalAllowed','databaseDeletionAllowed','continuousExclusionVerified')) {if ($meta.$flag -isnot [bool] -or $meta.$flag) {throw 'Unexpected authorization.'}}
  if ($meta.archive -cnotmatch '^ars-hardware_pos-[0-9]{8}-[0-9]{6}-[0-9]{3}-[a-f0-9]{32}-with-uploads\.dump$') {throw 'Invalid archive name.'}
  $archive=Join-Path $folder $meta.archive
  $manifestPath=Join-Path $folder 'uninstall-table-manifest.json'
  $members=@(Get-ArsUninstallArchiveMembers $archive)+@($manifestPath)
  $hashes=[ordered]@{}
  foreach ($p in $members) {
   Assert-ArsPlainPath $p
   $key=[IO.Path]::GetFileName($p)
   $hashes[$key]=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
   if ($hashes[$key] -cne $meta.archiveDigests.$key) {throw 'Archive member changed.'}
  }
  if ((Get-Item -LiteralPath $manifestPath).Length -gt 16777216) {throw 'Manifest too large.'}
  $manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
  if ($manifest.schema -ne 1 -or $manifest.kind -cne 'windows-uninstall-table-manifest' -or $manifest.archive -cne $meta.archive -or $manifest.dumpSha256 -cne $hashes[$meta.archive] -or $manifest.locksObserved -isnot [bool] -or -not $manifest.locksObserved -or $manifest.applicationRemovalAllowed -isnot [bool] -or $manifest.applicationRemovalAllowed -or $manifest.continuousExclusionVerified -isnot [bool] -or $manifest.continuousExclusionVerified) {throw 'Invalid protected manifest.'}
  Assert-ArsUninstallRestoredTables $manifest.tables $manifest.tables
  & node (Join-Path $project 'scripts/verify-backup.mjs') $archive|Out-Null
  if ($LASTEXITCODE -ne 0) {throw 'Archive verification failed.'}
  $uploadCount=Get-ArsUninstallUploadCount ($archive.Substring(0,$archive.Length-5)+'-uploads.zip')
  $name='ars-uninstall-test-'+[guid]::NewGuid().ToString('N')
  $password=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
  $created=$false
  try {
   $null=Invoke-ArsUninstallDocker @('image','inspect','postgres:16-alpine')
   $null=Invoke-ArsUninstallDocker @('run','-d','--pull=never','--network','none','--name',$name,'--label','com.rsnextward.ars-purpose=uninstall-restore-test','--tmpfs','/var/lib/postgresql/data:rw,mode=0700','-e','POSTGRES_USER=restore_admin','-e','POSTGRES_DB=ars_uninstall_test','-e',('POSTGRES_PASSWORD='+$password),'postgres:16-alpine')
   $created=$true
   $ready=$false
   for ($i=0;$i -lt 90;$i++) {
    & docker exec $name pg_isready -h 127.0.0.1 -U restore_admin -d ars_uninstall_test|Out-Null
    if ($LASTEXITCODE -eq 0) {$ready=$true;break}
    Start-Sleep -Seconds 2
   }
   if (-not $ready) {throw 'Disposable database unavailable.'}
   $null=Invoke-ArsUninstallDocker @('cp',$archive,($name+':/tmp/recovery.dump'))
   $hash=@(Invoke-ArsUninstallDocker @('exec',$name,'sha256sum','/tmp/recovery.dump'))
   if ($hash.Count -ne 1 -or ($hash[0] -split '\s+')[0] -cne $hashes[$meta.archive]) {throw 'Copied archive changed.'}
   $null=Invoke-ArsUninstallDocker @('exec',$name,'pg_restore','-U','restore_admin','-d','ars_uninstall_test','--single-transaction','--exit-on-error','--no-owner','--no-acl','/tmp/recovery.dump')
   $actual=Get-ArsRestoredUninstallTables $name
   Assert-ArsUninstallRestoredTables $manifest.tables $actual
  } finally {
   if ($created) {$null=Invoke-ArsUninstallDocker @('rm','-f','-v',$name)}
  }
  foreach ($key in $paths.Keys) {if ((Get-FileHash -LiteralPath $paths[$key] -Algorithm SHA256).Hash -cne $digests[$key]) {throw 'Maintenance evidence changed.'}}
  foreach ($p in $members) {if ((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() -cne $hashes[[IO.Path]::GetFileName($p)]) {throw 'Archive evidence changed.'}}
  if (@(Get-ChildItem -LiteralPath $control -Force|Where-Object Name -in $markers).Count -or (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {throw 'Maintenance evidence changed.'}
  $record=[ordered]@{schema=1;kind='windows-uninstall-restore-observation';uninstallId=$id;archiveSha256=$hashes[$meta.archive];isolatedRestorePassed=$true;allPublicTableFingerprintsMatched=$true;restoredTableCount=@($actual.PSObject.Properties.Name).Count;uploadArchiveReadable=$true;uploadMemberCount=$uploadCount;evidenceDigests=$digests;archiveMemberDigests=$hashes;finalUninstallBackupVerified=$false;applicationRemovalAllowed=$false;serviceRemovalAllowed=$false;databaseDeletionAllowed=$false;continuousExclusionVerified=$false;uninstalled=$false}
  $stream=[IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {$bytes=[Text.Encoding]::UTF8.GetBytes(($record|ConvertTo-Json -Depth 6));$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)} finally {$stream.Dispose()}
  return $record
 } finally {
  if ($owned) {$mutex.ReleaseMutex()}
  $mutex.Dispose()
 }
}
