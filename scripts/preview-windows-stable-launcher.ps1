# Read-only stable launcher preflight. Never starts a server or changes a pointer.
param()
$ErrorActionPreference='Stop'
function Assert-PlainDirectory([string]$Path) {
  $cursor=[IO.Path]::GetFullPath($Path)
  while ($cursor) {
    $item=Get-Item -LiteralPath $cursor -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid launcher directory or ancestor.' }
    $cursor=Split-Path -Parent $cursor
  }
}
function Assert-PlainFile([string]$Path) {
  $item=Get-Item -LiteralPath $Path -Force
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid launcher file.' }
  return $item
}
$state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
$control=Join-Path $state 'desktop-control'
$releases=Join-Path $state 'prepared-releases'
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another startup or maintenance operation is active.' }
  foreach ($dir in @($state,$control,$releases)) { Assert-PlainDirectory $dir }
  foreach ($name in @('maintenance.json','activation.json','instance.json')) {
    if (Test-Path -LiteralPath (Join-Path $control $name)) { throw 'Existing maintenance, activation or instance evidence blocks launcher preflight.' }
  }
  # Separate proposed pointer; no live pointer is created or consumed.
  $pointer=Assert-PlainFile (Join-Path $control 'launcher-preview.json')
  if ($pointer.Length -gt 4096) { throw 'Launcher preview is too large.' }
  $p=Get-Content -LiteralPath $pointer.FullName -Raw | ConvertFrom-Json
  if ($p.schema -ne 1 -or $p.version -isnot [string] -or $p.version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$' -or $p.digest -isnot [string] -or $p.digest -cnotmatch '^[a-f0-9]{64}$' -or $p.activationApproved -isnot [bool] -or $p.activationApproved) { throw 'Invalid non-active launcher preview.' }
  $release=Join-Path $releases $p.version
  Assert-PlainDirectory $release
  # Helper ships alongside the stable launcher, not inside the selected release.
  $helper=Assert-PlainFile (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
  . $helper.FullName
  if ((Assert-ArsPreparedFingerprint $release).digest -cne $p.digest) { throw 'Selected release differs from preview digest.' }
  $dist=Join-Path $release 'dist'
  Assert-PlainDirectory $dist
  foreach ($name in @('server.cjs','index.html')) { $null=Assert-PlainFile (Join-Path $dist $name) }
  [ordered]@{schema=1;version=$p.version;release=$release;fingerprintMatched=$true;activationAllowed=$false;startupAllowed=$false;schedulingAllowed=$false} | ConvertTo-Json
} finally {
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
