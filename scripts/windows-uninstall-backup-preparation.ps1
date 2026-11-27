# Internal final-backup preparation; requires an existing dedicated shutdown hold.
# Not exposed in the wizard; no uninstall or service action.
. (Join-Path $PSScriptRoot 'windows-setup-destination.ps1')
. (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
function Assert-ArsUninstallHold($hold,$proof,[string]$project) {
 if ($hold.schema -ne 1 -or $proof.schema -ne 1 -or $hold.purpose -cne 'pre-uninstall backup' -or $proof.purpose -cne $hold.purpose -or $hold.project -ine $project -or $proof.project -ine $project -or $hold.uninstallId -cnotmatch '^[a-f0-9]{32}$' -or $proof.uninstallId -cne $hold.uninstallId) { throw 'Matching uninstall hold required.' }
 foreach ($r in @($hold,$proof)) {
  if ($r.applicationRemovalAllowed -isnot [bool] -or $r.applicationRemovalAllowed) { throw 'Unexpected removal authorization.' }
 }
 if ($hold.shutdownVerified -isnot [bool] -or $hold.shutdownVerified -or $proof.shutdownVerified -isnot [bool] -or -not $proof.shutdownVerified -or $hold.pid -ne $proof.pid -or $hold.startedUtc -cne $proof.startedUtc -or $hold.requestedAt -cne $proof.requestedAt) { throw 'Matching shutdown evidence required.' }
}
function Get-ArsUninstallArchiveMembers([string]$archive) {
 if ([IO.Path]::GetFileName($archive) -cnotmatch '^ars-hardware_pos-[0-9]{8}-[0-9]{6}-[0-9]{3}-[a-f0-9]{32}-with-uploads\.dump$') { throw 'Complete database and upload archive required.' }
 $zip=$archive.Substring(0,$archive.Length-5)+'-uploads.zip'
 @($archive,($archive+'.sha256'),$zip,($zip+'.sha256'))
}
function Prepare-ArsUninstallBackup([string]$project) {
 $state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
 $control=Join-Path $state 'desktop-control'
 $mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
 $owned=$false
 try {
  try {$owned=$mutex.WaitOne(0)} catch [System.Threading.AbandonedMutexException] {$owned=$true;throw 'Interrupted maintenance requires review.'}
  if (-not $owned) {throw 'Maintenance active.'}
  foreach ($p in @($project,$state,$control,(Join-Path $project 'uploads'))) {Assert-ArsPlainPath $p}
  foreach ($key in @('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','ARS_RUNTIME_ROOT')) {
   if ([Environment]::GetEnvironmentVariable($key,'Process')) {throw 'Unsupported runtime override.'}
  }
  $endpoint=@(& docker context inspect --format '{{.Endpoints.docker.Host}}')
  if ($LASTEXITCODE -ne 0 -or $endpoint.Count -ne 1 -or $endpoint[0] -notin @('npipe:////./pipe/docker_engine','npipe:////./pipe/dockerDesktopLinuxEngine')) {throw 'Local Docker required.'}
  $holdPath=Join-Path $control 'maintenance.json'
  $proofPath=Join-Path $control 'maintenance-shutdown.json'
  foreach ($p in @($holdPath,$proofPath)) {Assert-ArsPlainPath $p;if ((Get-Item -LiteralPath $p).Length -gt 65536) {throw 'Invalid evidence size.'}}
  $holdHash=(Get-FileHash -LiteralPath $holdPath -Algorithm SHA256).Hash
  $proofHash=(Get-FileHash -LiteralPath $proofPath -Algorithm SHA256).Hash
  $hold=Get-Content -LiteralPath $holdPath -Raw|ConvertFrom-Json
  $proof=Get-Content -LiteralPath $proofPath -Raw|ConvertFrom-Json
  Assert-ArsUninstallHold $hold $proof $project
  $markers=@('instance.json','repair-interrupted.json','runtime-switch-intent.json','runtime-switch-journal.json','runtime-active.json','activation.json','handoff-pending.json','runtime-activation-interrupted.json','runtime-migration-interrupted.json','switch-journal.json')
  if (@(Get-ChildItem -LiteralPath $control -Force|Where-Object Name -in $markers).Count -or (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {throw 'Application or incident remains active.'}
  $old=Get-Process -Id ([int]$hold.pid) -ErrorAction SilentlyContinue
  if ($old -and $old.StartTime.ToUniversalTime().Ticks.ToString() -ceq $hold.startedUtc) {throw 'Original application remains active.'}
  $recovery=Join-Path $state 'uninstall-recovery'
  [void][IO.Directory]::CreateDirectory($recovery)
  Assert-ArsPlainPath $recovery
  $folder=Join-Path $recovery $hold.uninstallId
  if (Test-Path -LiteralPath $folder) {throw 'Existing recovery retained.'}
  New-Item -ItemType Directory -Path $folder -ErrorAction Stop|Out-Null
  $acl=Get-Acl -LiteralPath $folder
  $acl.SetAccessRuleProtection($true,$false)
  foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
   $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
  }
  Set-Acl -LiteralPath $folder -AclObject $acl
  $uploads=Get-ArsPreparedFingerprint (Join-Path $project 'uploads')
  $result=@(& node (Join-Path $project 'scripts/windows-locked-maintenance-backup.mjs') $folder)
  if ($LASTEXITCODE -ne 0) {throw 'Protected backup failed.'}
  $lines=@($result|Where-Object {$_ -is [string] -and $_.StartsWith('ARS_ARCHIVE=')})
  if ($lines.Count -ne 1) {throw 'Unique backup required.'}
  $archive=$lines[0].Substring(12)
  if ((Split-Path -Parent $archive) -ine $folder) {throw 'Unexpected archive location.'}
  $hashes=[ordered]@{}
  foreach ($member in (Get-ArsUninstallArchiveMembers $archive)) {
   Assert-ArsPlainPath $member
   $hashes[[IO.Path]::GetFileName($member)]=(Get-FileHash -LiteralPath $member -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  & node (Join-Path $project 'scripts/verify-backup.mjs') $archive|Out-Null
  if ($LASTEXITCODE -ne 0 -or (Get-ArsPreparedFingerprint (Join-Path $project 'uploads')).digest -cne $uploads.digest -or (Get-FileHash -LiteralPath $holdPath -Algorithm SHA256).Hash -cne $holdHash -or (Get-FileHash -LiteralPath $proofPath -Algorithm SHA256).Hash -cne $proofHash -or (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {throw 'Backup or maintenance evidence changed.'}
  $meta=[ordered]@{schema=1;kind='windows-final-uninstall-backup';uninstallId=$hold.uninstallId;previousProject=$project;archive=[IO.Path]::GetFileName($archive);archiveDigests=$hashes;holdDigest=$holdHash;shutdownDigest=$proofHash;restoreTestPassed=$false;finalUninstallBackupVerified=$false;applicationRemovalAllowed=$false;databaseDeletionAllowed=$false;continuousExclusionVerified=$false}
  $stream=[IO.File]::Open((Join-Path $folder 'recovery.json'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {$bytes=[Text.Encoding]::UTF8.GetBytes(($meta|ConvertTo-Json -Depth 5));$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)} finally {$stream.Dispose()}
  return $folder
 } finally {
  if ($owned) {$mutex.ReleaseMutex()}
  $mutex.Dispose()
 }
}
