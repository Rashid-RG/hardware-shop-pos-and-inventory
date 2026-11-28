# Internal preparation for the continuous recovery lifecycle.
# Releases the launcher mutex before a native restore worker needs to acquire it.
# Does not stop, start, uninstall or alter the database.
. (Join-Path $PSScriptRoot 'windows-uninstall-backup-preparation.ps1')
function Initialize-ArsContinuousRecovery([string]$project) {
 $ErrorActionPreference='Stop'
 $root=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
 if ($project -ine $root -or $env:LOCALAPPDATA -ine ([Environment]::GetFolderPath('LocalApplicationData'))) {throw 'Managed installation required.'}
 $state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
 $control=Join-Path $state 'desktop-control'
 $mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
 $owned=$false
 try {
  try {$owned=$mutex.WaitOne(0)} catch [System.Threading.AbandonedMutexException] {$owned=$true;throw 'Interrupted maintenance requires review.'}
  if (-not $owned) {throw 'Maintenance active.'}
  foreach ($p in @($root,$state,$control,(Join-Path $root 'uploads'))) {Assert-ArsPlainPath $p}
  foreach ($key in @('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','ARS_RUNTIME_ROOT')) {
   if ($null -ne [Environment]::GetEnvironmentVariable($key,'Process')) {throw 'Unsupported runtime override.'}
  }
  $endpoint=@(& docker context inspect --format '{{.Endpoints.docker.Host}}')
  if ($LASTEXITCODE -ne 0 -or $endpoint.Count -ne 1 -or $endpoint[0] -cnotin @('npipe:////./pipe/docker_engine','npipe:////./pipe/dockerDesktopLinuxEngine')) {throw 'Local Docker required.'}
  $holdPath=Join-Path $control 'maintenance.json'
  $proofPath=Join-Path $control 'maintenance-shutdown.json'
  foreach ($p in @($holdPath,$proofPath)) {
   Assert-ArsPlainPath $p
   $item=Get-Item -LiteralPath $p
   if ($item.PSIsContainer -or $item.Length -lt 1 -or $item.Length -gt 65536) {throw 'Invalid shutdown evidence.'}
  }
  $holdDigest=(Get-FileHash -LiteralPath $holdPath -Algorithm SHA256).Hash
  $proofDigest=(Get-FileHash -LiteralPath $proofPath -Algorithm SHA256).Hash
  $hold=Get-Content -LiteralPath $holdPath -Raw -Encoding UTF8|ConvertFrom-Json
  $proof=Get-Content -LiteralPath $proofPath -Raw -Encoding UTF8|ConvertFrom-Json
  Assert-ArsUninstallHold $hold $proof $root
  foreach ($r in @($hold,$proof)) {
   foreach ($flag in @('activationApproved','databaseDeletionAllowed')) {if ($r.$flag -isnot [bool] -or $r.$flag) {throw 'Unexpected authorization.'}}
  }
  if ($hold.pid -lt 1 -or $hold.startedUtc -cnotmatch '^[0-9]{1,19}$') {throw 'Invalid process evidence.'}
  $markers=@('instance.json','repair-interrupted.json','runtime-switch-intent.json','runtime-switch-journal.json','runtime-active.json','activation.json','handoff-pending.json','runtime-activation-interrupted.json','runtime-migration-interrupted.json','switch-journal.json')
  function Assert-ContinuousShutdown {
   foreach ($p in @($holdPath,$proofPath)) {Assert-ArsPlainPath $p}
   if ((Get-FileHash -LiteralPath $holdPath -Algorithm SHA256).Hash -cne $holdDigest -or (Get-FileHash -LiteralPath $proofPath -Algorithm SHA256).Hash -cne $proofDigest -or @(Get-ChildItem -LiteralPath $control -Force|Where-Object Name -in $markers).Count -or (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {throw 'Shutdown evidence changed or application active.'}
   $old=Get-Process -Id ([int]$hold.pid) -ErrorAction SilentlyContinue
   if ($old -and $old.StartTime.ToUniversalTime().Ticks.ToString() -ceq $hold.startedUtc) {throw 'Original application remains active.'}
  }
  Assert-ContinuousShutdown
  $folder=New-ArsPrivateUninstallRecoveryDirectory $state $hold.uninstallId
  $uploads=Get-ArsPreparedFingerprint (Join-Path $root 'uploads')
  Assert-ContinuousShutdown
  return [ordered]@{schema=1;kind='windows-continuous-recovery-preparation';uninstallId=$hold.uninstallId;destination=$folder;holdDigest=$holdDigest;shutdownDigest=$proofDigest;uploadsDigest=$uploads.digest;applicationRemovalAllowed=$false;databaseDeletionAllowed=$false;activationAllowed=$false;continuousExclusionVerified=$false}
 } finally {
  if ($owned) {$mutex.ReleaseMutex()}
  $mutex.Dispose()
 }
}
