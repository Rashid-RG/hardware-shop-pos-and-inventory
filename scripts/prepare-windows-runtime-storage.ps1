# Prepare a verified copy of runtime files. No source deletion, junctions, or activation.
param()
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
$root=Split-Path -Parent $PSScriptRoot
$state=Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor'
$control=Join-Path $state 'desktop-control'
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
$pending=$null
function Read-MaintenanceDigest {
  $marker=Join-Path $control 'maintenance.json'
  $proof=Join-Path $control 'maintenance-shutdown.json'
  foreach ($path in @($root,$state,$control,$marker,$proof)) {
    if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected runtime or maintenance reparse point.' }
  }
  $m=Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
  $v=Get-Content -LiteralPath $proof -Raw | ConvertFrom-Json
  if ($m.schema -ne 1 -or $v.schema -ne 1 -or $m.project -ine $root -or $v.project -ine $root -or $m.pid -ne $v.pid -or $m.startedUtc -cne $v.startedUtc -or $m.requestedAt -cne $v.requestedAt -or $m.shutdownVerified -ne $false -or $v.shutdownVerified -ne $true -or $m.activationApproved -ne $false -or $v.activationApproved -ne $false) { throw 'Matching verified pre-activation maintenance required.' }
  foreach ($name in @('instance.json','activation.json')) { if (Test-Path -LiteralPath (Join-Path $control $name)) { throw 'Managed instance or activation record exists.' } }
  if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { throw 'Application listener exists.' }
  $old=Get-Process -Id ([int]$m.pid) -ErrorAction SilentlyContinue
  if ($old -and $old.StartTime.ToUniversalTime().Ticks.ToString() -ceq $m.startedUtc) { throw 'Previous application process remains active.' }
  return ((Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash+':'+(Get-FileHash -LiteralPath $proof -Algorithm SHA256).Hash)
}
function Get-RuntimeInventory([string]$Base) {
  $envFile=Get-Item -LiteralPath (Join-Path $Base '.env.local') -Force
  if ($envFile.PSIsContainer -or ($envFile.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid operational configuration file.' }
  $result=[ordered]@{configuration=(Get-FileHash -LiteralPath $envFile.FullName -Algorithm SHA256).Hash}
  foreach ($name in @('uploads','backups')) {
    $path=Join-Path $Base $name
    if (-not (Test-Path -LiteralPath $path -PathType Container)) { throw "Required runtime directory missing: $name" }
    $result[$name]=(Get-ArsPreparedFingerprint $path).digest
    # The prepared-release helper ignores its own metadata file; runtime must not.
    if (Test-Path -LiteralPath (Join-Path $path '.ars-prepared-fingerprint.json')) { throw 'Unexpected runtime fingerprint metadata.' }
  }
  return ($result | ConvertTo-Json -Compress)
}
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another startup or maintenance operation is active.' }
  $maintenanceDigest=Read-MaintenanceDigest
  $sourceBefore=Get-RuntimeInventory $root
  $target=Join-Path $state 'runtime-prepared'
  if (Test-Path -LiteralPath $target) { throw 'Runtime preparation already exists. Do not overwrite existing business files.' }
  if ((Read-Host 'Type COPY RUNTIME to prepare a retained private copy of configuration, uploads and backups') -cne 'COPY RUNTIME') { return }
  $pending=Join-Path $state ('.pending-runtime-'+[guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $pending | Out-Null
  # Restrict the new copy to the current Windows account and SYSTEM.
  $acl=Get-Acl -LiteralPath $pending
  $acl.SetAccessRuleProtection($true,$false)
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  foreach ($principal in @($sid,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
    $rule=New-Object Security.AccessControl.FileSystemAccessRule($principal,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $pending -AclObject $acl
  foreach ($name in @('.env.local','uploads','backups')) {
    Copy-Item -LiteralPath (Join-Path $root $name) -Destination (Join-Path $pending $name) -Recurse -Force
  }
  if ((Get-RuntimeInventory $pending) -cne $sourceBefore -or (Get-RuntimeInventory $root) -cne $sourceBefore) { throw 'Runtime source or copied contents changed; preparation blocked.' }
  if ((Read-MaintenanceDigest) -cne $maintenanceDigest) { throw 'Maintenance changed during runtime preparation.' }
  $receipt=[ordered]@{schema=1;previousProject=$root;createdAt=[DateTime]::UtcNow.ToString('o');maintenanceDigest=$maintenanceDigest;inventory=($sourceBefore | ConvertFrom-Json);sourcePreserved=$true;runtimeActivated=$false;activationApproved=$false}
  $receipt | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $pending 'runtime-preparation.json') -Encoding UTF8
  [IO.Directory]::Move($pending,$target)
  Write-Host "Verified private runtime copy retained at $target. Original files unchanged. Runtime activation not performed."
} finally {
  if ($pending -and (Test-Path -LiteralPath $pending)) { Write-Warning "Incomplete private runtime copy retained at $pending." }
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
