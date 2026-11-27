# Read-only Windows uninstall planning. Never removes files, services or database volumes.
. (Join-Path $PSScriptRoot 'windows-setup-destination.ps1')
function Get-ArsUninstallPreview([string]$project,[string]$state) {
 foreach ($dir in @($project,$state,(Join-Path $state 'desktop-control'))) {
  Assert-ArsPlainPath $dir
  if (-not (Get-Item -LiteralPath $dir -Force).PSIsContainer) { throw 'Invalid installation directory.' }
 }
 $project=[IO.Path]::GetFullPath($project).TrimEnd('\')
 $state=[IO.Path]::GetFullPath($state).TrimEnd('\')
 if ($project -ieq $state -or $project.StartsWith($state+'\',[StringComparison]::OrdinalIgnoreCase) -or $state.StartsWith($project+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Application and permanent state must be independent.' }
 foreach ($name in @('dist/server.cjs','dist/index.html','.env.local')) {
  $path=Join-Path $project $name
  Assert-ArsPlainPath $path
  if ((Get-Item -LiteralPath $path -Force).PSIsContainer) { throw 'Invalid installation file.' }
 }
 foreach ($name in @('uploads','backups')) {
  $path=Join-Path $project $name
  Assert-ArsPlainPath $path
  if (-not (Get-Item -LiteralPath $path -Force).PSIsContainer) { throw 'Invalid business storage directory.' }
 }
 $markers=@('maintenance.json','maintenance-shutdown.json','activation.json','runtime-active.json','runtime-switch-intent.json','runtime-switch-journal.json','runtime-activation-interrupted.json','runtime-migration-interrupted.json','handoff-pending.json','switch-journal.json','repair-interrupted.json')
 if (@(Get-ChildItem -LiteralPath (Join-Path $state 'desktop-control') -Force -ErrorAction Stop | Where-Object Name -in $markers).Count) { throw 'Resolve maintenance evidence before removal planning.' }
 # Current Windows builds retain operational files within the application.
 # A prepared copy is not an active permanent storage mapping.
 [ordered]@{schema=1;kind='windows-uninstall-preview';installation=$project;retainedState=$state;businessStorageInsideApplication=$true;permanentStorageSeparationVerified=$false;installationOwnershipCertified=$false;backupVerified=$false;applicationRemovalAllowed=$false;serviceRemovalAllowed=$false;databaseDeletionAllowed=$false;uninstalled=$false}
}
function Show-ArsUninstallPreview([string]$project) {
 if (-not (Show-ArsSetupPage 'Welcome to the Uninstall Wizard' 'Thank you for choosing RS Nextward. This wizard reviews application removal while preserving your business records. Nothing will be removed during this preview.' 'Review installation')) { return }
 try {
  $state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
  $mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
  $owned=$false
  try {
   try { $owned=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned=$true;throw 'Interrupted maintenance requires review.' }
   if (-not $owned) { throw 'Maintenance is active.' }
   $plan=Get-ArsUninstallPreview $project $state
  } finally {
   if ($owned) { $mutex.ReleaseMutex() }
   $mutex.Dispose()
  }
 } catch {
  $null=Show-ArsSetupPage 'Removal planning blocked' 'Installation or business storage could not be verified. All files remain unchanged. Contact RS Nextward support.' 'Close'
  return
 }
 $message="Application: "+$plan.installation+[Environment]::NewLine+[Environment]::NewLine+"Business configuration, uploads and backups are still inside the installation. These must be preserved, together with the PostgreSQL database, invoices, inventory and accounts. PostgreSQL and shared prerequisites will not be removed."
 if (-not (Show-ArsSetupPage 'Preserve your business' $message 'Review requirements')) { return }
 $null=Show-ArsSetupPage 'Removal is not yet enabled' 'Permanent storage separation, verified final backup, installation ownership and service shutdown are required. Permanent business data deletion is disabled. No application, service, file or database was removed.' 'Finish'
}
