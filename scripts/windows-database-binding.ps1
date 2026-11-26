# Register or verify a local database identity. Never activates a release or writes to PostgreSQL.
param([switch]$Register)
$ErrorActionPreference='Stop'
$state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
$control=Join-Path $state 'desktop-control'
$path=Join-Path $control 'database-binding.json'
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
$keys=@('context','endpoint','project','volume','database','port','systemIdentifier','databaseOid')
function Get-VerifiedIdentity {
  $raw=@(& (Join-Path $PSScriptRoot 'preview-windows-docker-binding.ps1'))
  $p=($raw -join "\`n") | ConvertFrom-Json
  if ($p.schema -ne 1 -or $p.databaseIdentityVerified -ne $true -or $p.activationAllowed -ne $false -or $p.systemIdentifier -cnotmatch '^[0-9]{1,20}$' -or $p.databaseOid -cnotmatch '^[0-9]{1,10}$') { throw 'No verified database identity returned.' }
  $p
}
function Assert-SameIdentity($a,$b) {
  foreach ($key in $keys) {
    if ($null -eq $a.$key -or $null -eq $b.$key -or [string]$a.$key -cne [string]$b.$key) { throw "Database binding mismatch: $key. No startup authorized." }
  }
}
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another startup or maintenance operation is active.' }
  $cursor=$control
  while ($cursor) {
    $item=Get-Item -LiteralPath $cursor -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid binding directory or ancestor.' }
    $cursor=Split-Path -Parent $cursor
  }
  if ($Register -and (Test-Path -LiteralPath $path)) { throw 'Database binding already exists. Overwrite is not supported.' }
  if (-not $Register) {
    $item=Get-Item -LiteralPath $path -Force
    if ($item.PSIsContainer -or $item.Length -gt 8192 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid binding record.' }
    $saved=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($saved.schema -ne 1 -or $saved.activationAllowed -ne $false) { throw 'Invalid binding schema.' }
    Assert-SameIdentity $saved (Get-VerifiedIdentity)
    [ordered]@{schema=1;bindingMatched=$true;activationAllowed=$false} | ConvertTo-Json
    return
  }
  foreach ($name in @('activation.json','runtime-active.json')) {
    if (Test-Path -LiteralPath (Join-Path $control $name)) { throw 'Existing activation evidence blocks registration.' }
  }
  $first=Get-VerifiedIdentity
  Write-Host "Existing database: $($first.database); volume: $($first.volume); cluster: $($first.systemIdentifier)"
  if ((Read-Host 'Type REGISTER DATABASE to retain this identity without activating any release') -cne 'REGISTER DATABASE') { return }
  $current=Get-VerifiedIdentity
  Assert-SameIdentity $first $current
  $record=[ordered]@{schema=1;createdAt=[DateTime]::UtcNow.ToString('o');activationAllowed=$false}
  foreach ($key in $keys) { $record[$key]=$current.$key }
  $bytes=[Text.Encoding]::UTF8.GetBytes(($record | ConvertTo-Json))
  $stream=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
  Write-Host 'Database identity retained. No release activation authorized.'
} finally {
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
