# Revalidate staged source against the independently trusted original signed ZIP.
param([Parameter(Mandatory=$true)][string]$Version,[switch]$PrepareBuild)
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
  if ($PrepareBuild) {
    $package = Get-Content -LiteralPath (Join-Path $clean 'package.json') -Raw | ConvertFrom-Json
    if ($package.version -cne $Version) { throw 'Package version differs from signed release version.' }
    foreach ($required in @('package-lock.json','server.ts','scripts/start-local.ps1')) {
      if (-not (Test-Path -LiteralPath (Join-Path $clean $required) -PathType Leaf)) { throw 'Required release file missing.' }
    }
    $npm = Get-Command npm.cmd -ErrorAction Stop
    $node = Get-Command node.exe -ErrorAction Stop
    & $node.Source -e 'if (+process.versions.node.split(".")[0] < 22) process.exit(1)'
    if ($LASTEXITCODE -ne 0) { throw 'Node.js 22 or newer required.' }
    $prepared = Join-Path $state 'prepared-releases'
    New-Item -ItemType Directory -Path $prepared -Force | Out-Null
    $target = Join-Path $prepared $Version
    if (Test-Path -LiteralPath $target) { throw 'Prepared release already exists.' }
    $answer = Read-Host 'Type PREPARE to compile this signed release (does not activate it)'
    if ($answer -cne 'PREPARE') { return }
    $pending = Join-Path $prepared ('.pending-' + [guid]::NewGuid().ToString('N'))
    try {
      Copy-Item -LiteralPath $clean -Destination $pending -Recurse
      # Explicit environment allowlist. This is process hygiene, not an OS sandbox.
      $buildHome = Join-Path $work 'build-home'
      New-Item -ItemType Directory -Path $buildHome | Out-Null
      $emptyConfig = Join-Path $buildHome 'npmrc'
      [IO.File]::WriteAllText($emptyConfig,'')
      $allowed = @('SystemRoot','WINDIR','ComSpec','PATHEXT','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS','OS')
      $saved = @{}
      foreach ($entry in Get-ChildItem Env:) { $saved[$entry.Name] = $entry.Value }
      try {
        foreach ($key in @($saved.Keys)) { if ($key -notin $allowed) { [Environment]::SetEnvironmentVariable($key,$null,'Process') } }
        $env:Path = (Split-Path -Parent $node.Source) + ';' + (Split-Path -Parent $npm.Source) + ';' + (Join-Path $env:SystemRoot 'System32') + ';' + $env:SystemRoot
        $env:HOME = $buildHome
        $env:USERPROFILE = $buildHome
        $env:APPDATA = $buildHome
        $env:LOCALAPPDATA = $buildHome
        $env:TEMP = $buildHome
        $env:TMP = $buildHome
        $env:NPM_CONFIG_USERCONFIG = $emptyConfig
        $env:NPM_CONFIG_GLOBALCONFIG = $emptyConfig
        $env:NPM_CONFIG_CACHE = Join-Path $buildHome 'npm-cache'
        Push-Location -LiteralPath $pending
        try {
          & $npm.Source ci --include=dev --ignore-scripts --no-audit --no-fund
          if ($LASTEXITCODE -ne 0) { throw 'Release dependency preparation failed.' }
          & $npm.Source --ignore-scripts run build
          if ($LASTEXITCODE -ne 0) { throw 'Release build failed.' }
          & $node.Source --check dist/server.cjs
          if ($LASTEXITCODE -ne 0) { throw 'Prepared server syntax check failed.' }
        } finally { Pop-Location }
      } finally {
        foreach ($entry in Get-ChildItem Env:) { [Environment]::SetEnvironmentVariable($entry.Name,$null,'Process') }
        foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key,$saved[$key],'Process') }
      }
      foreach ($required in @('dist/server.cjs','dist/index.html')) {
        if (-not (Test-Path -LiteralPath (Join-Path $pending $required) -PathType Leaf)) { throw 'Production output missing.' }
      }
      Copy-Item -LiteralPath $manifest -Destination (Join-Path $pending '.ars-release-manifest.json')
      Copy-Item -LiteralPath $signature -Destination (Join-Path $pending '.ars-release-manifest.sig')
      Copy-Item -LiteralPath $archive -Destination (Join-Path $pending '.ars-release.zip')
      [IO.Directory]::Move($pending,$target)
      Write-Host "Prepared release: $target. Not activated. No database startup requested."
    } finally {
      if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending -Recurse -Force }
    }
  }
} finally {
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
