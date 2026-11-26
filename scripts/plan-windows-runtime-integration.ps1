# Read-only integration plan. The prepared copy is never selected as live runtime here.
param()
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
$root=Split-Path -Parent $PSScriptRoot
$state=Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor'
$control=Join-Path $state 'desktop-control'
$copy=Join-Path $state 'runtime-prepared'
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
function Read-PlainJson([string]$Path) {
  $item=Get-Item -LiteralPath $Path -Force
  if ($item.PSIsContainer -or $item.Length -gt 65536 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid runtime evidence.' }
  Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}
function Get-RuntimeIdentity([string]$Base) {
  $config=Get-Item -LiteralPath (Join-Path $Base '.env.local') -Force
  if ($config.PSIsContainer -or ($config.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid runtime configuration.' }
  $hash=(Get-FileHash -LiteralPath $config.FullName -Algorithm SHA256).Hash
  $u=Join-Path $Base 'uploads'
  $b=Join-Path $Base 'backups'
  foreach ($dir in @($u,$b)) {
    if (Test-Path -LiteralPath (Join-Path $dir '.ars-prepared-fingerprint.json')) { throw 'Unexpected runtime fingerprint metadata.' }
  }
  [pscustomobject]@{configuration=$hash;uploads=(Get-ArsPreparedFingerprint $u).digest;backups=(Get-ArsPreparedFingerprint $b).digest}
}
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another startup or maintenance operation is active.' }
  foreach ($dir in @($root,$state,$control,$copy)) {
    $item=Get-Item -LiteralPath $dir -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid runtime directory.' }
  }
  $marker=Join-Path $control 'maintenance.json'
  $proof=Join-Path $control 'maintenance-shutdown.json'
  $a=Read-PlainJson $marker
  $b=Read-PlainJson $proof
  $receipt=Read-PlainJson (Join-Path $copy 'runtime-preparation.json')
  if ($a.schema -ne 1 -or $b.schema -ne 1 -or $a.project -ine $root -or $b.project -ine $root -or $a.pid -ne $b.pid -or $a.startedUtc -cne $b.startedUtc -or $a.requestedAt -cne $b.requestedAt -or $a.shutdownVerified -ne $false -or $b.shutdownVerified -ne $true -or $a.activationApproved -ne $false -or $b.activationApproved -ne $false) { throw 'Verified maintenance shutdown required.' }
  $digest=(Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash+':'+(Get-FileHash -LiteralPath $proof -Algorithm SHA256).Hash
  if ($receipt.schema -ne 1 -or $receipt.previousProject -ine $root -or $receipt.maintenanceDigest -cne $digest -or $receipt.sourcePreserved -ne $true -or $receipt.runtimeActivated -ne $false -or $receipt.activationApproved -ne $false) { throw 'Runtime copy belongs to a different maintenance session or is not eligible.' }
  foreach ($name in @('instance.json','activation.json','runtime-active.json')) {
    if (Test-Path -LiteralPath (Join-Path $control $name)) { throw 'Active instance or activation evidence exists.' }
  }
  if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { throw 'Application listener remains active.' }
  $old=Get-Process -Id ([int]$a.pid) -ErrorAction SilentlyContinue
  if ($old -and $old.StartTime.ToUniversalTime().Ticks.ToString() -ceq $a.startedUtc) { throw 'Previous application process remains active.' }
  $source=Get-RuntimeIdentity $root
  $prepared=Get-RuntimeIdentity $copy
  foreach ($key in @('configuration','uploads','backups')) {
    if ($source.$key -cne $prepared.$key -or $source.$key -cne $receipt.inventory.$key) { throw "Runtime contents changed: $key. Prepare a fresh verified copy." }
  }
  # Compose project name is derived from its directory in legacy installs.
  # Do not run compose from a replacement version directory or infer volume identity.
  $compose=Join-Path $root 'docker-compose.yml'
  if (-not (Test-Path -LiteralPath $compose -PathType Leaf)) { throw 'Existing Compose definition missing.' }
  [ordered]@{schema=1;existingProject=$root;preparedRuntime=$copy;inventoryMatched=$true;runtimeActivated=$false;activationAllowed=$false;requiredConsumers=@('Server dotenv configuration','Server upload storage','Windows startup database authentication','Docker Compose project identity and environment','Backup destination and uploaded-file archive','Restore and recovery tooling','Desktop installation and update utilities');blockers=@('Stable runtime path contract not yet wired into every consumer.','Existing Docker volume identity must be verified without creating a new volume.','Native Windows runtime integration and rollback must be tested.')} | ConvertTo-Json -Depth 4
} finally {
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
