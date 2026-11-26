# Combined read-only preflight. No activation, pointer writes or server startup.
param([Parameter(Mandatory=$true)][string]$RecoveryId)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
$state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
$control=Join-Path $state 'desktop-control'
$runtime=Join-Path $state 'runtime-prepared'
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
$previous=[Environment]::GetEnvironmentVariable('ARS_RUNTIME_ROOT','Process')
function Assert-DirectoryChain([string]$Path) {
  $cursor=$Path
  while ($cursor) {
    $item=Get-Item -LiteralPath $cursor -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid preflight directory or ancestor.' }
    $cursor=Split-Path -Parent $cursor
  }
}
function Invoke-Plan([string]$Name,[string[]]$Arguments=@()) {
  $file=Get-Item -LiteralPath (Join-Path $PSScriptRoot $Name) -Force
  if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid preflight helper.' }
  (@(& $file.FullName @Arguments) -join [Environment]::NewLine) | ConvertFrom-Json
}
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another startup or maintenance operation is active.' }
  if ($null -ne $previous) { throw 'Preflight requires the original installation environment.' }
  foreach ($dir in @($control,$runtime,$PSScriptRoot)) { Assert-DirectoryChain $dir }
  $plan=Invoke-Plan 'plan-windows-runtime-integration.ps1'
  if ($plan.schema -ne 1 -or $plan.inventoryMatched -ne $true -or $plan.runtimeActivated -ne $false -or $plan.activationAllowed -ne $false -or $plan.preparedRuntime -ine $runtime) { throw 'Runtime inventory preflight failed.' }
  # Invoke the parameterized script directly to preserve named parameter binding.
  $switchHelper=Get-Item -LiteralPath (Join-Path $PSScriptRoot 'plan-windows-update-switch.ps1') -Force
  if ($switchHelper.PSIsContainer -or ($switchHelper.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid update preflight helper.' }
  $switch=(@(& $switchHelper.FullName -RecoveryId $RecoveryId) -join [Environment]::NewLine) | ConvertFrom-Json
  if ($switch.schema -ne 1 -or $switch.evidenceMatched -ne $true -or $switch.activationAllowed -ne $false -or $switch.rollbackAllowed -ne $false -or $switch.currentProject -ine $plan.existingProject -or $switch.recoveryId -cne $RecoveryId) { throw 'Recovery compatibility preflight failed.' }
  $binding=Invoke-Plan 'windows-database-binding.ps1'
  if ($binding.schema -ne 1 -or $binding.bindingMatched -ne $true -or $binding.activationAllowed -ne $false) { throw 'Original database binding failed.' }
  # Temporarily select the prepared runtime only for read-only database identity inspection.
  [Environment]::SetEnvironmentVariable('ARS_RUNTIME_ROOT',$runtime,'Process')
  try {
    $copyBinding=Invoke-Plan 'windows-database-binding.ps1'
    if ($copyBinding.schema -ne 1 -or $copyBinding.bindingMatched -ne $true -or $copyBinding.activationAllowed -ne $false) { throw 'Prepared runtime database binding failed.' }
  } finally { [Environment]::SetEnvironmentVariable('ARS_RUNTIME_ROOT',$previous,'Process') }
  $again=Invoke-Plan 'plan-windows-runtime-integration.ps1'
  if (($again | ConvertTo-Json -Depth 8 -Compress) -cne ($plan | ConvertTo-Json -Depth 8 -Compress)) { throw 'Runtime preflight changed.' }
  $locks=@(Get-ChildItem -LiteralPath (Join-Path $runtime 'backups') -Force | Where-Object { $_.Name -in @('.ars-drive-backup.lock','.ars-local-backup.lock','.ars-drive-recovery.lock') })
  if ($locks.Count -gt 0) { throw 'Prepared runtime contains unresolved backup evidence.' }
  [ordered]@{schema=1;recoveryId=$RecoveryId;candidateVersion=$switch.candidateVersion;runtimeInventoryMatched=$true;recoveryEvidenceMatched=$true;originalDatabaseBindingMatched=$true;preparedDatabaseBindingMatched=$true;runtimeActivated=$false;activationAllowed=$false;blockers=@('Continuous writer protection across live switching is unverified.','Native runtime activation and rollback acceptance required.')} | ConvertTo-Json -Depth 4
} finally {
  [Environment]::SetEnvironmentVariable('ARS_RUNTIME_ROOT',$previous,'Process')
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
