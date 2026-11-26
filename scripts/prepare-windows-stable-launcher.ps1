# Prepare an independent launcher package from a verified local prepared release.
# No shortcut registration, runtime activation, database access or server startup.
param([Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
if ($Version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$') { throw 'Invalid prepared release version.' }
$state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
$source=Join-Path (Join-Path $state 'prepared-releases') $Version
$target=Join-Path $state 'launcher-prepared'
$control=Join-Path $state 'desktop-control'
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
$pending=$null
function Assert-DirectoryChain([string]$Path) {
  $cursor=$Path
  while ($cursor) {
    $item=Get-Item -LiteralPath $cursor -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid launcher preparation directory.' }
    $cursor=Split-Path -Parent $cursor
  }
}
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another startup or maintenance operation is active.' }
  Assert-DirectoryChain $source
  Assert-DirectoryChain $control
  if (Test-Path -LiteralPath $target) { throw 'A prepared launcher already exists. No existing package will be replaced.' }
  foreach ($name in @('activation.json','runtime-active.json')) {
    if (Test-Path -LiteralPath (Join-Path $control $name)) { throw 'Existing activation evidence blocks launcher preparation.' }
  }
  $digest=(Assert-ArsPreparedFingerprint $source).digest
  $files=@('preview-windows-stable-launcher.ps1','windows-prepared-fingerprint.ps1','windows-database-binding.ps1','preview-windows-docker-binding.ps1','windows-runtime-paths.ps1','show-windows-launcher-preview.ps1')
  foreach ($name in ($files+@('probe-postgres-identity.mjs'))) {
    $item=Get-Item -LiteralPath (Join-Path (Join-Path $source 'scripts') $name) -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid launcher source file.' }
  }
  if ((Read-Host 'Type PREPARE LAUNCHER to retain an inactive independent launcher package') -cne 'PREPARE LAUNCHER') { return }
  $pending=Join-Path $state ('.pending-launcher-'+[guid]::NewGuid().ToString('N'))
  $scripts=Join-Path $pending 'scripts'
  New-Item -ItemType Directory -Path $scripts -Force | Out-Null
  foreach ($name in $files) {
    $from=Join-Path (Join-Path $source 'scripts') $name
    $to=Join-Path $scripts $name
    Copy-Item -LiteralPath $from -Destination $to
    if ((Get-FileHash -LiteralPath $from -Algorithm SHA256).Hash -cne (Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash) { throw 'Launcher copy checksum mismatch.' }
  }
  $bundle=Join-Path $scripts 'probe-postgres-identity.cjs'
  # Build with the trusted installation's helper and fingerprinted release dependencies.
  . (Join-Path $PSScriptRoot 'windows-identity-probe-bundle.ps1')
  New-ArsIdentityProbeBundle $source $bundle
  if ((Assert-ArsPreparedFingerprint $source).digest -cne $digest) { throw 'Prepared release changed during launcher preparation.' }
  $record=[ordered]@{schema=1;sourceVersion=$Version;sourceDigest=$digest;createdAt=[DateTime]::UtcNow.ToString('o');activationAllowed=$false;shortcutInstalled=$false;startupAllowed=$false;schedulingAllowed=$false}
  $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $pending 'launcher-preparation.json') -Encoding UTF8
  Get-ArsPreparedFingerprint $pending | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $pending '.ars-prepared-fingerprint.json') -Encoding UTF8
  $null=Assert-ArsPreparedFingerprint $pending
  [IO.Directory]::Move($pending,$target)
  Write-Host "Independent inactive launcher package retained at $target. Existing shortcuts unchanged."
} finally {
  if ($pending -and (Test-Path -LiteralPath $pending)) { Write-Warning "Incomplete launcher package retained at $pending." }
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
