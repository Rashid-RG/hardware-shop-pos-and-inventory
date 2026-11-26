# Revalidate staged source against the independently trusted original signed ZIP.
param([Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'expand-windows-release.ps1')
if ($Version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid release version.' }
$state = Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor'
$source = Join-Path (Join-Path $state 'staged-releases') $Version
$trust = Join-Path $state 'release-signing-public.pem'
$openssl = Get-Command openssl.exe -ErrorAction Stop
$work = Join-Path ([IO.Path]::GetTempPath()) ('ars-reverify-' + [guid]::NewGuid().ToString('N'))
function Get-RegularTree([string]$Root) {
  $rootItem = Get-Item -LiteralPath $Root -Force
  if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point in release tree.' }
  $queue = New-Object 'System.Collections.Generic.Queue[string]'
  $queue.Enqueue($Root)
  while ($queue.Count) {
    $folder = $queue.Dequeue()
    foreach ($item in Get-ChildItem -LiteralPath $folder -Force) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point in release tree.' }
      if ($item.PSIsContainer) { $queue.Enqueue($item.FullName) }
      else { $item }
    }
  }
}
try {
  $files = @(Get-RegularTree $source)
  New-Item -ItemType Directory -Path $work | Out-Null
  foreach ($name in @('.ars-release-manifest.json','.ars-release-manifest.sig','.ars-release.zip')) {
    $file = Join-Path $source $name
    $limit = switch ($name) { '.ars-release-manifest.json' {65536} '.ars-release-manifest.sig' {16384} default {536870912} }
    if ((Get-Item -LiteralPath $file).Length -gt $limit) { throw 'Oversized release evidence.' }
    Copy-Item -LiteralPath $file -Destination (Join-Path $work $name)
  }
  $manifest = Join-Path $work '.ars-release-manifest.json'
  $signature = Join-Path $work '.ars-release-manifest.sig'
  $archive = Join-Path $work '.ars-release.zip'
  & $openssl.Source dgst -sha256 -verify $trust -signature $signature $manifest
  if ($LASTEXITCODE -ne 0) { throw 'Release signature verification failed.' }
  $data = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
  if ($data.product -cne 'ARS Distributor' -or $data.platform -cne 'windows' -or $data.version -cne $Version -or $data.sha256 -isnot [string] -or $data.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Release manifest mismatch.' }
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $data.sha256) { throw 'Archive checksum mismatch.' }
  $clean = Join-Path $work 'clean'
  Expand-ArsRelease $archive $clean
  $expected = @(Get-RegularTree $clean)
  $reserved = @('.ars-release-manifest.json','.ars-release-manifest.sig','.ars-release.zip')
  $actual = @($files | Where-Object { $_.FullName.Substring($source.Length+1) -notin $reserved })
  if ($actual.Count -ne $expected.Count) { throw 'Staged source file count mismatch.' }
  foreach ($item in $expected) {
    $relative = $item.FullName.Substring($clean.Length+1)
    if ($relative -in $reserved) { throw 'Reserved release evidence path.' }
    $candidate = Join-Path $source $relative
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf) -or (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash) { throw "Staged source mismatch: $relative" }
  }
  Write-Host 'Staged source matches signed archive. Inspection only; no build or activation performed.'
} finally {
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
